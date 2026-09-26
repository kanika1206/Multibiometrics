import UserModel from "../model/User.model.js";
import jwt from "jsonwebtoken";
import ENV from "../config.js";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { takeCaptcha, normalizeCaptcha } from "../captchaStore.js";
import { fuse } from "../decisionRule.js";
import { decryptToFile } from "../secureStore.js";
import {
  decryptTemplate,
  runExtractTemplate,
  hasTemplate,
  deleteTemplate,
} from "../templateStore.js";
import { deleteUserKey } from "../keyVault.js";
import { issueEnrollToken, REENROLL_PURPOSE } from "../enrollToken.js";
import { sealFields, openFields, emailIndex } from "../piiStore.js";
import {
  startTimer,
  recordBenchmark,
  clientMs,
  deviceInfo,
  readBenchmarks,
  summarizeBenchmarks,
  BENCHMARK_FILE,
} from "../benchmarkStore.js";

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
    // Same shape as login()'s failures (reason code + human sentence), because
    // this middleware guards /api/login: a login for an unknown username is
    // rejected here, and the client must be able to show WHY without special
    // -casing the middleware's reply.
    if (!exist)
      return res
        .status(404)
        .send({ reason: "USER_NOT_FOUND", error: "No account exists for that username." });
    next();
  } catch (error) {
    return res
      .status(404)
      .send({ reason: "SERVER_ERROR", error: "Could not verify that username. Please try again." });
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
  // Registration spans two requests, so its end-to-end time is assembled from
  // both halves: this handler measures the account-creation stage, and
  // /upload-video (server.js) writes the completed record once enrolment
  // finishes. A registration that dies HERE never reaches that point, so the
  // failure is recorded on the spot — otherwise the log would only ever contain
  // registrations that got as far as uploading.
  const timer = startTimer();
  const failRegistration = (reason, status, body) => {
    recordBenchmark({
      operation: "registration",
      success: false,
      reason,
      username: typeof req.body?.username === "string" ? req.body.username : null,
      serverMs: timer.stop(),
      phases: { stage: "account_creation" },
    });
    return res.status(status).send(body);
  };
  try {
    const { username, profile, email } = req.body;

    // The username is signed into the enrollment token and becomes a template
    // filename, so it is constrained at the point of account creation.
    if (typeof username !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(username)) {
      return failRegistration("INVALID_USERNAME", 400, { error: "Invalid username" });
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
      return failRegistration("INVALID_EMAIL", 400, { error: "Invalid email" });
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
          // PENDING until a biometric template is actually stored. Registration
          // is not complete when this row is written — it is complete when
          // /upload-video has enrolled the templates — and an account that never
          // gets there is swept by enrollmentJanitor.js rather than left behind
          // as an account that can never log in.
          enrollmentPending: true,
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
              // Not "registered" yet, and the wording says so: the biometric
              // enrollment that follows is what completes registration.
              msg: "Account created - biometric enrollment required",
              enrollToken: issueEnrollToken(username),
              // Handed back so the client can add this server-measured stage to
              // its own timing without guessing at network latency.
              accountCreationMs: timer.stop(),
            })
          );
      })
      .catch((error) => {
        return failRegistration("ACCOUNT_CREATION_FAILED", 500, { error });
      });
  } catch (error) {
    return failRegistration("ACCOUNT_CREATION_FAILED", 500, error);
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

// Usernames with a login attempt currently running. An attempt consumes the
// single-use CAPTCHA and deletes the uploaded recording when it finishes, so a
// second concurrent attempt for the same user cannot succeed and, worse, tears
// down the first one's inputs mid-flight (decrypt failure => spurious 401).
// Serializing per username makes a double submit a no-op instead of a fail loop.
const loginsInFlight = new Set();

// Why a failed login now says WHICH factor failed.
//
// The response used to be a single opaque "Login UnSuccessful...!" for every
// cause, on the classic argument that naming the failed factor tells an attacker
// which one to work on. That argument is weak here and the cost was high: a user
// whose CAPTCHA had merely expired, or whose recording contained no detectable
// face, was told exactly the same thing as an impostor, so the only available
// remedy was to record again and hope. The system is passwordless — there is no
// secret to disclose by saying "your voice did not match" — and an attacker
// holding a video can already isolate each factor by submitting deliberately
// broken inputs. So the factor is named.
//
// What is still withheld is everything a tuner would want: no similarity scores,
// no thresholds, no distances, no CAPTCHA text, no transcript, and no statement
// about which factors PASSED beyond what the failure list implies. The messages
// below are the complete set the client can ever see.
const LOGIN_FAILURE_MESSAGES = {
  USER_NOT_FOUND: "No account exists for that username.",
  INVALID_USERNAME: "That username is not valid.",
  LOGIN_IN_PROGRESS: "A login attempt for this account is already running. Please wait for it to finish.",
  NO_ENROLLMENT:
    "This account has no biometric enrollment, so there is nothing to check your face and voice against. " +
    "Your registration did not finish. Register again with the same username and e-mail to complete enrollment " +
    "— the unfinished account is released automatically, so nothing is lost.",
  RECORDING_MISSING: "No login recording was received. Please record your video and try again.",
  RECORDING_UNREADABLE: "Your login recording could not be read. Please record it again.",
  BIOMETRIC_EXTRACTION_FAILED:
    "No usable face or voice could be found in your recording. Make sure your face is clearly visible and lit, and that you speak aloud.",
  FACE_MISMATCH: "Your face did not match the face enrolled for this account.",
  VOICE_MISMATCH: "Your voice did not match the voice enrolled for this account.",
  SPEECH_NOT_RECOGNIZED:
    "Your speech could not be transcribed. Please read the CAPTCHA aloud, clearly and close to the microphone.",
  CAPTCHA_MISMATCH: "The CAPTCHA you read aloud did not match the one shown.",
  CAPTCHA_EXPIRED: "Your CAPTCHA expired or was already used. A new one has been issued — record yourself reading it.",
  SERVER_ERROR: "The biometric check could not be completed. Please try again.",
};

/** Builds the client-visible failure body from one or more failure codes. */
function failureBody(codes) {
  const reason = codes.join("+");
  const message = codes
    .map((c) => LOGIN_FAILURE_MESSAGES[c] || LOGIN_FAILURE_MESSAGES.SERVER_ERROR)
    .join(" ");
  return {
    msg: "Login UnSuccessful...!",
    // Tells the client that the remedy is re-registration rather than another
    // recording, so it can offer the right control instead of inviting the user
    // to record again into an account that can never match anything.
    recovery: codes.includes("NO_ENROLLMENT") ? "REGISTER_AGAIN" : null,
    // `reason` is the stable machine code (logs, benchmarks, tests); `error` is
    // the sentence shown to the user. Both stay free of scores and thresholds.
    reason,
    error: message,
    failedFactors: codes,
  };
}

/**
 * The three-factor verification both /api/login and /api/reenroll-request run.
 *
 * It is one function rather than two because re-enrolment must be gated on
 * exactly the authentication it replaces: nothing weaker than a complete,
 * successful face + voice + challenge check may authorize overwriting a stored
 * template. Sharing the code makes that structural instead of a promise — there
 * is no second, laxer verification path to drift out of step.
 *
 * `onSuccess(user)` builds the success body, which is the only difference
 * between the two callers: a session JWT for login, a short-lived `reenroll`
 * grant for re-enrolment. `operation` names the flow in the benchmark log.
 */
async function threeFactorAttempt(req, res, { operation, onSuccess }) {
  const { username, clientPreMs } = req.body;
  // Capture settings of the recording being verified (see benchmarkStore).
  const device = deviceInfo(req.body.device);

  // Wall-clock for the server half of the login flow: it starts on the first
  // line of the handler and stops in the finally below, whatever the outcome.
  // The browser half (blob preparation + recording upload) arrives as
  // clientPreMs, and benchmarkStore adds the two into the end-to-end total.
  const timer = startTimer();
  const clientPre = clientMs(clientPreMs);
  let outcome = { success: false, reason: "SERVER_ERROR" };

  // Every failure exit goes through here, so the benchmark record and the
  // response can never disagree about why the attempt failed.
  const fail = (codes, status = 401) => {
    const body = failureBody(Array.isArray(codes) ? codes : [codes]);
    outcome = { success: false, reason: body.reason };
    return res.status(status).send(body);
  };

  if (typeof username === "string" && loginsInFlight.has(username)) {
    // 429, not 401: nothing failed, the caller simply asked twice.
    recordBenchmark({
      operation,
      success: false,
      reason: "LOGIN_IN_PROGRESS",
      username,
      clientPreMs: clientPre,
      serverMs: timer.stop(),
      device,
    });
    return res.status(429).send(failureBody(["LOGIN_IN_PROGRESS"]));
  }
  if (typeof username === "string") loginsInFlight.add(username);

  try {
    const user = await UserModel.findOne({ username });
    if (!user) {
      return fail("USER_NOT_FOUND", 404);
    }
    // username is interpolated into spawn() paths below.
    if (!/^[A-Za-z0-9_-]+$/.test(user.username)) {
      return fail("INVALID_USERNAME", 400);
    }

    // Two conditions that are not authentication failures at all, and that the
    // opaque 401 used to hide behind a decrypt error: the account never enrolled
    // any biometrics, or no login recording was uploaded for this attempt.
    // Distinguished BEFORE the CAPTCHA is consumed, so a user who simply has no
    // recording does not also lose their challenge.
    const loginVideoEnc = LOGIN_UPLOAD_DIR + user.username + "_l.mp4.enc";
    if (!hasTemplate(user.username)) {
      return fail("NO_ENROLLMENT", 401);
    }
    if (!fs.existsSync(loginVideoEnc)) {
      return fail("RECORDING_MISSING", 400);
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
      // Vault lookup by userIndex -> unwrap under the master key -> decrypt only
      // this user's template. Any failure (no key, tampered blob, tampered
      // template) throws into the catch below and fails closed.
      await decryptTemplate(user.username, regTemplate);
      decryptToFile(loginVideoEnc, loginVideo);
    } catch (e) {
      // Deliberately coarse: the user is told their recording could not be read,
      // never whether it was the template or the recording, nor that an
      // authentication tag failed. That detail stays in the server log.
      console.error(`login ${user.username}: decrypt failed: ${e.message}`);
      return fail("RECORDING_UNREADABLE", 401);
    }
    timer.lap("decryptMs");

    // The three factors are verified concurrently (the paper's Algorithm 1
    // cascades them; running them in parallel and AND-ing at the end is the
    // documented enhancement). The biometric branch reduces the login recording
    // to a template once, then matches face and voice against the stored template
    // in parallel. The CAPTCHA branch is independent — it only needs the login
    // audio — so it runs alongside rather than waiting on the face verdict.
    const branchTimings = {};
    const biometricBranch = (async () => {
      const t0 = Date.now();
      const { code, stderr } = await runExtractTemplate(loginVideo, loginTemplate);
      branchTimings.templateExtractionMs = Date.now() - t0;
      if (code !== 0) {
        console.error(`[login-template] exit ${code}: ${stderr.trim()}`);
        // No template could be built from the recording at all — no face
        // detected, or no audio. That is not a mismatch and is reported as its
        // own reason, because the remedy is different (record again, properly).
        return { extracted: false, faceOk: false, voiceOk: false };
      }
      const t1 = Date.now();
      const [face, voice] = await Promise.all([
        runPy(["./matchFaceTemplate.py", regTemplate, loginTemplate], "face"),
        runPy(["./matchVoiceTemplate.py", regTemplate, loginTemplate], "voice"),
      ]);
      branchTimings.faceVoiceMatchMs = Date.now() - t1;
      return { extracted: true, faceOk: face.code === 0, voiceOk: voice.code === 0 };
    })();

    const captchaBranch = (async () => {
      const t0 = Date.now();
      const exLog = await runPy(["./extractAudio_login.py", loginVideo], "extract-audio-login");
      if (exLog.code !== 0) {
        branchTimings.speechMs = Date.now() - t0;
        return [];
      }
      const speech = await runPy(["./speechToTexty.py", loginAudio], "speech");
      branchTimings.speechMs = Date.now() - t0;
      // speechToTexty.py prints one "Captcha:" line per STT alternative.
      return speech.code === 0
        ? [...speech.stdout.matchAll(/Captcha:\s*(.*)/g)].map((m) => m[1].trim())
        : [];
    })();

    const [{ extracted, faceOk, voiceOk }, transcripts] = await Promise.all([
      biometricBranch,
      captchaBranch,
    ]);
    timer.lap("verifyMs");
    timer.set("templateExtractionMs", branchTimings.templateExtractionMs);
    timer.set("faceVoiceMatchMs", branchTimings.faceVoiceMatchMs);
    timer.set("speechMs", branchTimings.speechMs);
    // Any STT alternative may carry the correct reading; each candidate must
    // still exactly match the single-use server-side code after normalization.
    const captchaOk =
      expectedCaptcha !== null &&
      transcripts.some(
        (t) => normalizeCaptcha(t) === normalizeCaptcha(expectedCaptcha)
      );

    // AND logic across all three factors. The log keeps the full detail; the
    // response names the failed factors but nothing quantitative.
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

    // Equation (5), via the shared rule the attack harness also scores with, so
    // a reported attack success rate is a statement about this exact decision.
    if (!fuse({ faceOk, voiceOk, captchaOk })) {
      const codes = [];
      if (!extracted) {
        // One cause, one message: with no template there is nothing to compare,
        // so reporting "face mismatch" as well would be untrue.
        codes.push("BIOMETRIC_EXTRACTION_FAILED");
      } else {
        if (!faceOk) codes.push("FACE_MISMATCH");
        if (!voiceOk) codes.push("VOICE_MISMATCH");
      }
      if (!captchaOk) {
        if (expectedCaptcha === null) codes.push("CAPTCHA_EXPIRED");
        else if (transcripts.length === 0) codes.push("SPEECH_NOT_RECOGNIZED");
        else codes.push("CAPTCHA_MISMATCH");
      }
      return fail(codes, 401);
    }

    outcome = { success: true, reason: null };
    return res.status(200).send(onSuccess(user));
  } catch (error) {
    console.error(`login error: ${error}`);
    outcome = { success: false, reason: "SERVER_ERROR" };
    return res.status(500).send(failureBody(["SERVER_ERROR"]));
  } finally {
    // One benchmark record per attempt, success or failure, written before the
    // cleanup below so a slow rmSync does not inflate the measured time.
    recordBenchmark({
      operation,
      success: outcome.success,
      reason: outcome.reason,
      username,
      clientPreMs: clientPre,
      serverMs: timer.stop(),
      device,
      phases: timer.phases,
    });
    if (typeof username === "string") loginsInFlight.delete(username);
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

/** POST: http://localhost:8080/api/login */
export async function login(req, res) {
  return threeFactorAttempt(req, res, {
    operation: "login",
    onSuccess: (user) => ({
      msg: "Login Successful...!",
      username: user.username,
      token: jwt.sign(
        { userId: user._id, username: user.username },
        ENV.JWT_SECRET,
        { expiresIn: "24h" }
      ),
    }),
  });
}

/** POST: http://localhost:8080/api/reenroll-request
 * @param: { "username": "example123" }
 *
 * Issues the grant that lets a user REPLACE their biometric template.
 *
 * Why this endpoint exists. Enrolment used to be permanent: /upload-video
 * refuses to overwrite a stored template, and the scheme is passwordless, so
 * there was no reset of any kind. A user whose biometrics stopped matching —
 * injury, illness, a permanently changed voice — was locked out for good, and
 * the enrolled template had no erasure route either.
 *
 * Why it is safe. The request is answered only after the SAME three-factor
 * check /api/login performs succeeds against the template being replaced, so
 * the only party who can re-enrol an account is one who can already
 * authenticate as its owner — never a stolen session token, which
 * enrollToken.js rejects outright. The grant carries purpose "reenroll" and the
 * same ten-minute TTL as first enrolment, and it authorizes exactly one thing:
 * replacing the template of the account named in it.
 *
 * What it does NOT cover: a user who cannot authenticate at all. Recovering
 * that case requires out-of-band identity verification by an operator, who
 * deletes the template (DELETE /api/account, or an equivalent administrative
 * action) so the user can register and enrol again. That is a deliberate,
 * documented trust anchor of the scheme, not something this endpoint can do.
 */
export async function reenrollRequest(req, res) {
  return threeFactorAttempt(req, res, {
    operation: "reenroll_request",
    onSuccess: (user) => ({
      msg: "Re-enrollment authorized - upload a new recording",
      // Same token format and lifetime as first enrolment; only the purpose
      // differs, and that is what /upload-video checks against the account's
      // state (enroll may not replace, reenroll may only replace).
      enrollToken: issueEnrollToken(user.username, REENROLL_PURPOSE),
    }),
  });
}

/** DELETE: http://localhost:8080/api/account
 * @param: { "header": "<token>" }
 *
 * Erases the account and everything biometric attached to it: the account row,
 * the encrypted template, and the per-user vault key. These are the same three
 * deletions the enrolment janitor performs on an abandoned registration.
 *
 * A biometric system with no erasure route keeps a face and a voice template
 * for a user who has asked to leave, and offers no remedy to one whose template
 * no longer matches them. Behind Auth, so a user can only delete their own
 * account: the identity comes from the session token, never from the request
 * body.
 *
 * The vault key is removed last and its failure is not fatal — an orphaned
 * wrapped key whose template is already gone decrypts nothing — but it is
 * logged, because the row should not be there.
 */
export async function deleteAccount(req, res) {
  try {
    const { userId } = req.user;
    if (!userId) return res.status(401).send({ error: "User Not Found...!" });

    const user = await UserModel.findOne({ _id: userId });
    if (!user) return res.status(404).send({ error: "User Not Found...!" });
    const username = user.username;

    await UserModel.deleteOne({ _id: userId });
    // The template is the biometric data; the row was only the name on it.
    deleteTemplate(username);
    try {
      await deleteUserKey(username);
    } catch (e) {
      console.error(`deleteAccount ${username}: vault cleanup failed: ${e.message}`);
    }
    // Any login recording still on disk belongs to the account that just went.
    if (/^[A-Za-z0-9_-]+$/.test(username)) {
      fs.rmSync(LOGIN_UPLOAD_DIR + username + "_l.mp4.enc", { force: true });
    }
    console.log(`[account] deleted ${username}: account, template and vault key removed`);
    return res.status(200).send({ msg: "Account deleted" });
  } catch (error) {
    console.error(`deleteAccount error: ${error}`);
    return res.status(500).send({ error: "Could not delete the account" });
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

/** GET: http://localhost:8080/api/benchmarks?limit=100
 *
 * The performance log, for analysis. Behind Auth: the records name no user and
 * carry no biometrics, but attempt counts, failure reasons and timings are
 * operational data about the deployment, not something to hand to anonymous
 * callers. The file itself (backend/benchmarks/benchmarks.jsonl) remains the
 * primary artefact — this endpoint exists so the numbers can be read without
 * shell access to the server.
 */
export async function getBenchmarks(req, res) {
  try {
    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), 1000)
      : 100;
    // Summary over the WHOLE log, records over the requested window: a caller
    // asking for the last 20 attempts still gets aggregate numbers that mean
    // something.
    const all = readBenchmarks(Infinity);
    return res.status(200).send({
      file: BENCHMARK_FILE,
      summary: summarizeBenchmarks(all),
      records: all.slice(0, limit),
    });
  } catch (error) {
    console.error(`getBenchmarks: ${error}`);
    return res.status(500).send({ error: "Could not read benchmark log" });
  }
}
