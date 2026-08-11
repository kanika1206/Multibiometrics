import UserModel from "../model/User.model.js";
import jwt from "jsonwebtoken";
import ENV from "../config.js";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { takeCaptcha, normalizeCaptcha } from "../captchaStore.js";
import { decryptToFile } from "../secureStore.js";
import { decryptTemplate, runExtractTemplate, hasTemplate } from "../templateStore.js";
import { issueEnrollToken } from "../enrollToken.js";
import { sealFields, openFields, emailIndex } from "../piiStore.js";

const PYTHON = ENV.PYTHON;

// Owned by the server (must match multer's destination in server.js). Never take
// this from the request: the client used to send the directory itself, which
// lands straight in a spawn() argument. Registration videos no longer have a
// directory at all — they are never written to disk.
const LOGIN_UPLOAD_DIR = "./uploadsl/login_videos/";

//middleware for verify user
export async function verifyUser(req, res, next) {
  try {
    const { username } = req.method == "GET" ? req.query : req.body;

    // check the user existance
    let exist = await UserModel.findOne({ username });
    if (!exist) return res.status(404).send({ error: "Can't find User!" });
    next();
  } catch (error) {
    return res.status(404).send({ error: "Authentication Error" });
  }
}

/** POST: http://localhost:8080/api/register 
 * @param : {
  "username" : "example123",
  "password" : "admin123",
  "email": "example@gmail.com",
  "profile": "",
  "url": "helloooooooo"
}
*/
export async function register(req, res) {
  try {
    const { username, profile, email } = req.body;

    // The username is signed into the enrollment token and becomes a template
    // filename, so it is constrained at the point of account creation.
    if (typeof username !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(username)) {
      return res.status(400).send({ error: "Invalid username" });
    }

    // Registration is two requests — the account is created here, the templates
    // are enrolled by /upload-video — so it can stop half-way: the user closes
    // the tab, the camera fails, the recording has no usable face. That leaves an
    // account holding no template. Such an account is inert: login needs a
    // template to match against, so it can never authenticate, and its
    // enrollment token expires after ten minutes, so it can never enroll either.
    // It nonetheless held its username and email forever, locking the legitimate
    // owner out of their own identifier with no way back.
    //
    // An abandoned account is therefore released rather than treated as a
    // conflict. This concedes nothing: an account with no template was never
    // bound to anybody's biometrics, so taking it over is indistinguishable from
    // registering a never-used name. What must not happen is releasing an
    // ENROLLED account, which would be account takeover — hence hasTemplate()
    // gates every deletion, and /upload-video independently refuses to overwrite
    // an existing template even when presented with a valid enrollment token.
    // Both conflicts are resolved before anything is deleted, so a request that
    // is going to be rejected for one field does not destroy an account on
    // account of the other.
    const checkAvailable = async (query, conflict) => {
      const found = await UserModel.findOne(query);
      if (found && hasTemplate(found.username)) throw { error: conflict };
      return found;
    };

    // The address is matched through its keyed index, never by comparing stored
    // addresses: the server does not need to read anyone's email to know that
    // this one is taken.
    const emailIdx = emailIndex(email);
    if (!emailIdx) {
      return res.status(400).send({ error: "Invalid email" });
    }

    const clearance = Promise.all([
      checkAvailable({ username }, "Please use unique username"),
      checkAvailable({ emailIdx }, "Please use unique Email"),
    ]).then(async (holders) => {
      const seen = new Set();
      for (const held of holders) {
        if (!held || seen.has(String(held._id))) continue;
        seen.add(String(held._id));
        await UserModel.deleteOne({ _id: held._id });
        console.log(
          `[register] released abandoned account ${held.username} (no template enrolled)`
        );
      }
    });

    clearance
      .then(() => {
        // Only the username is written in the clear; the address is written
        // sealed, alongside the index that makes it findable.
        const user = new UserModel({
          username,
          emailIdx,
          ...sealFields({ profile: profile || "", email }),
        });

        // return save result as a response
        return user
          .save()
          .then(() =>
            // The enrollment token authorizes exactly one identity — the account
            // just created — to store biometric templates. It is the only way to
            // write a template, and it can never be minted for an account that is
            // already ENROLLED (the check above rejects those, and /upload-video
            // refuses to overwrite a stored template in any case), so no client
            // can overwrite another user's templates.
            res.status(201).send({
              msg: "User Register Successfully",
              enrollToken: issueEnrollToken(username),
            })
          );
      })
      .catch((error) => {
        return res.status(500).send({ error });
      });
  } catch (error) {
    return res.status(500).send(error);
  }
}

/** POST: http://localhost:8080/api/login
 * @param: {
  "username" : "example123"
}
 * Passwordless: the only credentials are the three biometric factors carried by
 * the login video (face, voice, spoken CAPTCHA).
*/
// Runs a Python pipeline stage. Resolves with the exit code and captured
// stdout; a stage that overruns its timeout is killed and reported as failed
// (code null). Exit codes are the authoritative pass/fail signal — libraries
// print banners to stdout (insightface announces its providers), so stdout is
// never used for gating, only for data (the speech transcript).
function runPy(args, label, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, args);
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      console.error(`[${label}] timed out after ${timeoutMs}ms, killing`);
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => console.error(`[${label}] ${d}`));
    child.on("error", (err) => {
      // spawn failure (e.g. missing interpreter) — fail closed
      console.error(`[${label}] spawn error: ${err}`);
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code: null, stdout });
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        console.log(`[${label}] exited ${code}`);
        resolve({ code, stdout });
      }
    });
  });
}

export async function login(req, res) {
  const { username } = req.body;

  try {
    const user = await UserModel.findOne({ username });
    if (!user) {
      return res.status(404).send({ error: "Username not Found" });
    }
    // username is interpolated into spawn() paths below.
    if (!/^[A-Za-z0-9_-]+$/.test(user.username)) {
      return res.status(400).send({ error: "Invalid username" });
    }

    // Consume the issued CAPTCHA up front: single-use, whether or not the
    // attempt succeeds. No issued CAPTCHA (or expired) => the third factor
    // cannot pass => fail closed.
    const expectedCaptcha = takeCaptcha(user.username);

    // The enrolled reference is now a TEMPLATE, not a video: no recording of the
    // user is stored (reviewer comment 2). Decrypt it, and the fresh login
    // recording, into a private temp dir. A missing or tampered file throws on
    // the GCM auth tag => 401, fail closed.
    var workDir = fs.mkdtempSync(path.join(os.tmpdir(), "bio-"));
    const regTemplate = path.join(workDir, user.username + ".json");
    const loginTemplate = path.join(workDir, user.username + "_l.json");
    const loginVideo = path.join(workDir, user.username + "_l.mp4");
    const loginAudio = path.join(workDir, user.username + "_l.mp3");
    try {
      decryptTemplate(user.username, regTemplate);
      decryptToFile(LOGIN_UPLOAD_DIR + user.username + "_l.mp4.enc", loginVideo);
    } catch (e) {
      console.error(`login ${user.username}: decrypt failed: ${e.message}`);
      return res.status(401).send({ msg: "Login UnSuccessful...!" });
    }

    // The three factors are verified concurrently (the paper's Algorithm 1
    // cascades them; running them in parallel and AND-ing at the end is the
    // documented enhancement). The biometric branch reduces the login recording
    // to a template once, then matches face and voice against the stored template
    // in parallel. The CAPTCHA branch is independent — it only needs the login
    // audio — so it runs alongside rather than waiting on the face verdict.
    const biometricBranch = (async () => {
      const { code, stderr } = await runExtractTemplate(loginVideo, loginTemplate);
      if (code !== 0) {
        console.error(`[login-template] exit ${code}: ${stderr.trim()}`);
        return { faceOk: false, voiceOk: false };
      }
      const [face, voice] = await Promise.all([
        runPy(["./matchFaceTemplate.py", regTemplate, loginTemplate], "face"),
        runPy(["./matchVoiceTemplate.py", regTemplate, loginTemplate], "voice"),
      ]);
      return { faceOk: face.code === 0, voiceOk: voice.code === 0 };
    })();

    const captchaBranch = (async () => {
      const exLog = await runPy(["./extractAudio_login.py", loginVideo], "extract-audio-login");
      if (exLog.code !== 0) return [];
      const speech = await runPy(["./speechToTexty.py", loginAudio], "speech");
      // speechToTexty.py prints one "Captcha:" line per STT alternative.
      return speech.code === 0
        ? [...speech.stdout.matchAll(/Captcha:\s*(.*)/g)].map((m) => m[1].trim())
        : [];
    })();

    const [{ faceOk, voiceOk }, transcripts] = await Promise.all([
      biometricBranch,
      captchaBranch,
    ]);
    // Any STT alternative may carry the correct reading; each candidate must
    // still exactly match the single-use server-side code after normalization.
    const captchaOk =
      expectedCaptcha !== null &&
      transcripts.some(
        (t) => normalizeCaptcha(t) === normalizeCaptcha(expectedCaptcha)
      );

    // AND logic across all three factors. The response never reveals which
    // factor failed; the server log carries the detail.
    console.log(
      `login ${user.username}: face=${faceOk} voice=${voiceOk} captcha=${captchaOk}` +
        (expectedCaptcha === null ? " (no captcha issued/expired)" : "")
    );
    // Server-log only, and deliberately VALUE-FREE: the expected CAPTCHA and the
    // spoken transcripts are not written to the log. A CAPTCHA is low-entropy
    // (five digits) and short-lived, and logs outlive it and are read by more
    // people than should see a live challenge/response; printing them was a
    // needless disclosure. The count below keeps a mismatch diagnosable (was any
    // speech transcribed at all?) without leaking the values.
    if (!captchaOk && expectedCaptcha !== null) {
      console.log(
        `login ${user.username}: captcha mismatch (${transcripts.length} transcript alternative(s))`
      );
    }

    if (!(faceOk && voiceOk && captchaOk)) {
      return res.status(401).send({ msg: "Login UnSuccessful...!" });
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      ENV.JWT_SECRET,
      { expiresIn: "24h" }
    );
    return res.status(200).send({
      msg: "Login Successful...!",
      username: user.username,
      token,
    });
  } catch (error) {
    console.error(`login error: ${error}`);
    return res.status(500).send({ error: "Biometric check failed" });
  } finally {
    // Remove the decrypted plaintext copies whatever the outcome.
    if (typeof workDir !== "undefined" && workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    // The login recording is consumed by this attempt and never retained: the
    // next login uploads a fresh one. Deleting it here means a breach finds no
    // video at all, only templates.
    if (username && /^[A-Za-z0-9_-]+$/.test(username)) {
      fs.rmSync(LOGIN_UPLOAD_DIR + username + "_l.mp4.enc", { force: true });
    }
  }
}
/** GET: http://localhost:8080/api/user/example123 */
export async function getUser(req, res) {
  const { username } = req.params;

  try {
    if (!username) return res.status(501).send({ error: "Invalid Username" });

    UserModel.findOne({ username }, function (err, user) {
      if (err) return res.status(500).send({ err });
      if (!user)
        return res.status(501).send({ error: "Couldn't Find the User" });

      /** remove password from user */
      // mongoose return unnecessary data with object so convert it into json
      const { password, emailIdx, ...rest } = Object.assign({}, user.toJSON());

      // The stored fields are ciphertext; the profile page expects the values.
      // emailIdx is dropped above: it is an internal lookup key, and shipping it
      // to the client would hand out a stable, correlatable identifier for the
      // address it stands in for.
      let plain;
      try {
        plain = openFields(rest);
      } catch (e) {
        // A sealed field that fails its authentication tag means tampering or a
        // wrong key. Fail closed rather than serving half a record.
        console.error(`getUser ${username}: could not decrypt account data: ${e.message}`);
        return res.status(500).send({ error: "Could not read user data" });
      }

      return res.status(201).send(plain);
    });
  } catch (error) {
    return res.status(404).send({ error: "Cannot Find User Data" });
  }
}

// pehle register //phir get data se saara data lena hai // then we will match data id
/** PUT: http://localhost:8080/api/updateuser 
 * @param: {
  "header" : "<token>"
}
body: {
    firstName: '',
    address : '',
    profile : ''
}
*/
export async function updateUser(req, res) {
  try {
    // const id = req.query.id;
    const { userId } = req.user;

    if (userId) {
      // Seal whatever contact fields this update carries, so an edited profile
      // does not write plaintext back over an encrypted record. Fields the
      // request does not mention are left untouched.
      const body = sealFields(req.body);
      // An address change moves its index with it, or the account becomes
      // unfindable by email and its old address stays reserved.
      if ("email" in req.body) {
        const idx = emailIndex(req.body.email);
        if (!idx) return res.status(400).send({ error: "Invalid email" });
        const taken = await UserModel.findOne({ emailIdx: idx });
        if (taken && String(taken._id) !== String(userId)) {
          return res.status(409).send({ error: "Please use unique Email" });
        }
        body.emailIdx = idx;
      }

      // update the data
      UserModel.updateOne({ _id: userId }, body, function (err, data) {
        if (err) throw err;

        return res.status(201).send({ msg: "Record Updated...!" });
      });
    } else {
      return res.status(401).send({ error: "User Not Found...!" });
    }
  } catch (error) {
    return res.status(401).send({ error });
  }
}

// The paper's scheme is passwordless, so the OTP / reset-password flow was
// removed: it operated on a `password` field that no longer exists in the
// schema.
