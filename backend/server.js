// Load backend/.env before anything imports config.js (ES imports evaluate in
// order, so this must stay the first import).
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
// for all the http request
import Video from "./model/User.model.js";
import morgan from 'morgan';
import router from './router/route.js';
import connect from './database/conn.js';
// import {output} from './controllers/appController.js';
import svgCaptcha from "svg-captcha"
import { issueCaptcha, hasLiveCaptcha, peekCaptcha } from "./captchaStore.js"
import { encryptToFile } from "./secureStore.js"
import { enrollFromBuffer, reenrollFromBuffer, hasTemplate } from "./templateStore.js"
import { connectVault, deleteUserKey } from "./keyVault.js"
import { enrollGrantFrom, REENROLL_PURPOSE } from "./enrollToken.js"
import { captureIfEnabled } from "./evalCapture.js"
import { startTimer, recordBenchmark, clientMs, deviceInfo } from "./benchmarkStore.js"
import { startEnrollmentJanitor } from "./enrollmentJanitor.js"
import ENV from "./config.js"
import multer from "multer"
import fs from "fs"

const app = express();

// middlewares
// JSON bodies carry only account data (username/email, optionally a base64
// profile image on update) — videos go through multer, not JSON. 10mb is ample.
app.use(express.json({limit:'10mb'}));

app.use(cors());
app.use(morgan('tiny'));
app.disable('x-powered-by');

// port number on which I will be handling my backend
const port = process.env.PORT || 8080;

// http get request
app.get('/', (req,res) => {
    res.status(201).json("Home GET Request");
})


// API routes 
// api is a endpoint for all other routes
app.use('/api', router)


// Lets the client know whether evaluation capture is active, so it can show the
// retention notice and consent control. Exposes only the boolean, nothing else.
app.get('/eval-status', function (req, res) {
  res.json({ evalCapture: ENV.EVAL_CAPTURE });
});

app.get('/captcha', function(req, res) {
    // The CAPTCHA text stays server-side (captchaStore) so the spoken
    // transcript can be verified at login. Never send the text to the client:
    // a client that knows the text can defeat the liveness check.
    const username = req.query.username;
    if (!username || !/^[A-Za-z0-9_-]+$/.test(username)) {
      return res.status(400).json({ error: "username required" });
    }
    // Digits only: the spoken CAPTCHA is transcribed by Google STT, which
    // handles digit sequences reliably but rejects random letter strings as
    // unintelligible (measured on live logins). 5 digits, single-use, 5-min
    // TTL, and the speaker must still pass face + voice.
    const captcha = svgCaptcha.create({ charPreset: "0123456789", size: 5, noise: 2 });
    issueCaptcha(username, captcha.text);
    res.json({ svg: captcha.data });
  });
  
  // Uploads are held in memory. The filename is validated against a strict
  // pattern: it becomes a filesystem path, and the old code took
  // client-controlled originalname verbatim (path traversal).
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 },
  });

  const REG_NAME = /^[A-Za-z0-9_-]{1,64}\.mp4$/;
  const LOGIN_NAME = /^[A-Za-z0-9_-]{1,64}_l\.mp4$/;

  // Registration: the video is reduced to encrypted biometric templates and then
  // discarded. Nothing playable is retained (reviewer comment 2) — the recording
  // exists only in memory and in a temp file enrollFromBuffer deletes. Route,
  // request shape and success body are unchanged, so the frontend is untouched.
  app.post('/upload-video', upload.single('video'), async function (req, res) {
    // Second and final stage of the registration flow. The stopwatch below
    // covers everything the SERVER does with the recording — template
    // extraction (face + voice), per-user key generation, AES-256-GCM
    // encryption, the template write, and any rollback — while clientPreMs
    // carries the browser half (form validation, /api/register, blob
    // preparation). benchmarkStore sums the two into the end-to-end total, so
    // exactly one registration record is written per attempt, here.
    const timer = startTimer();
    const clientPre = clientMs(req.body?.clientPreMs);
    // Capture settings of the device that produced this recording (resolution,
    // frame rate, platform). Self-reported by the browser and recorded as
    // context, never trusted for any decision — see benchmarkStore.deviceInfo.
    const device = deviceInfo(req.body?.device);
    // Which grant this upload carries: a first enrolment, or an authorized
    // replacement of an existing one. Read once — every branch below needs it.
    const grant = enrollGrantFrom(req);
    const isReenroll = grant?.purpose === REENROLL_PURPOSE;
    // Enrollment takes ~30 seconds, and a client that walks away during it used
    // to leave an account behind that could never authenticate. Note the abort
    // so the outcome is recorded honestly (and, below, so the half-made account
    // is cleaned up) instead of being silently lost.
    let aborted = false;
    req.on('aborted', () => {
      aborted = true;
      console.warn('[upload] enrollment request aborted by the client');
    });
    const finishRegistration = (success, reason, status, body) => {
      recordBenchmark({
        // A replacement is not a registration: no account is created, and
        // counting the two together would inflate the registration sample with
        // attempts that skipped half the flow.
        operation: isReenroll ? "reenrollment" : "registration",
        success,
        reason,
        // Taken from the server-signed enrolment token where available (never
        // from the request body): the benchmark's subject pseudonym must name
        // the identity that was actually enrolled.
        username: grant?.username ?? null,
        clientPreMs: clientPre,
        serverMs: timer.stop(),
        device,
        phases: { ...timer.phases, stage: "enrollment" },
      });
      return status ? res.status(status).send(body) : res.send(body);
    };
    // The enrolled identity comes from the server-signed enrollment token issued
    // by /api/register — NEVER from the filename. Taking it from the filename let
    // any unauthenticated client overwrite any user's stored templates (account
    // takeover); see enrollToken.js.
    const username = grant?.username ?? null;
    if (!username) {
      return finishRegistration(false, 'ENROLLMENT_NOT_AUTHORIZED', 401, { error: 'Enrollment not authorized' });
    }
    const file = req.file;
    if (!file) {
      return finishRegistration(false, 'NO_VIDEO_UPLOADED', 400, { error: 'Please upload a video file' });
    }
    if (!REG_NAME.test(file.originalname)) {
      return finishRegistration(false, 'INVALID_FILE_NAME', 400, { error: 'Invalid file name' });
    }
    // The token outlives the account it names: a failed extraction rolls the
    // account back (below), and the client still holds a signed, unexpired token
    // for it. Enrolling on that token would write a template for an account that
    // no longer exists — a template nothing can ever match against, and one that
    // would silently pre-empt whoever registers that username next. The account
    // must still be there.
    const account = await Video.findOne({ username });
    if (!account) {
      return finishRegistration(false, 'NO_ACCOUNT', 409, { error: 'No account to enroll; please register again' });
    }
    // An enrolled account is final. The token alone used to be the whole story,
    // which was sound only because a token cannot be minted for an existing
    // account — but registration now releases abandoned (template-less)
    // accounts, so "the account exists" no longer implies "no token exists".
    // Check the invariant that actually matters instead: a stored template is
    // never replaced, whoever asks.
    // A `reenroll` grant is the single authorized exception, and it inverts the
    // check rather than skipping it: it may ONLY replace a template that exists,
    // because it is minted solely by a successful three-factor login against
    // that very template. It can therefore never create an enrolment, and an
    // `enroll` grant can never replace one.
    if (isReenroll) {
      if (!hasTemplate(username)) {
        return finishRegistration(false, 'NOT_ENROLLED', 409, { error: 'This account has no enrollment to replace' });
      }
    } else if (hasTemplate(username)) {
      return finishRegistration(false, 'ALREADY_ENROLLED', 409, { error: 'This account is already enrolled' });
    }
    // Evaluation capture (registration = session 1). No-op unless EVAL_CAPTURE
    // is set AND the participant consented to retention on this page. Multer puts
    // non-file form fields on req.body. Registration has no spoken challenge,
    // so the clip is labelled "enroll".
    captureIfEnabled(file.buffer, username, req.body.evalConsent === 'true', 'enroll');
    try {
      // The replacement path extracts to a temp file, rotates the per-user vault
      // key and swaps the ciphertext atomically, so a failed re-enrolment leaves
      // the existing template — and the account's ability to log in — intact.
      const { ok, reason } = isReenroll
        ? await reenrollFromBuffer(file.buffer, username)
        : await enrollFromBuffer(file.buffer, username);
      if (!ok) {
        // Fail closed: no template was stored. The account record, however, was
        // already written by /api/register, so without this rollback the failure
        // leaves an account that holds no biometrics, can never authenticate,
        // and — once its 10-minute enrollment token expires — can never enroll
        // either, while still occupying its username and email. Registration is
        // meant to be all-or-nothing, so undo the half of it that succeeded.
        //
        // Guarded on hasTemplate: only an unenrolled account is ever deleted, so
        // a later failed upload can never remove an account that is already
        // enrolled (the check above rejects those before reaching here anyway).
        // Never on the re-enrolment path: that account IS enrolled, and the
        // whole point of the staged swap above is that a failure costs it
        // nothing. (hasTemplate would be false for it only if the template had
        // just been lost, which is not a reason to delete the account too.)
        if (!isReenroll && !hasTemplate(username)) {
          try {
            await Video.deleteOne({ username });
            console.log(`[enroll ${username}] extraction failed; account rolled back`);
          } catch (e) {
            console.error(`[enroll ${username}] rollback failed: ${e}`);
          }
          // The vault must not keep a key for an enrollment that never
          // happened. enrollFromBuffer already removes the record on its own
          // failure paths; this covers any remaining case so a failed
          // registration leaves no orphaned BiometricKeys row.
          try {
            await deleteUserKey(username);
          } catch (e) {
            console.error(`[enroll ${username}] vault rollback failed: ${e}`);
          }
        }
        return finishRegistration(false, 'EXTRACTION_FAILED', 400, { error: reason });
      }
    } catch (e) {
      console.error(`[upload] enrollment failed: ${e}`);
      return finishRegistration(false, 'STORAGE_FAILED', 500, { error: 'Could not store video' });
    }
    // Registration is complete: the account exists and its encrypted templates
    // are stored. Only NOW is the account taken out of the pending state — the
    // flag is cleared after the template write, never before, so a crash between
    // the two leaves the account sweepable rather than falsely confirmed.
    try {
      await Video.updateOne(
        { username },
        { $set: { enrollmentPending: false, enrolledAt: new Date() } }
      );
    } catch (e) {
      // The template is stored and the account can log in, so this is not fatal:
      // the janitor re-checks hasTemplate() before deleting anything and will
      // correct the flag rather than remove an enrolled account.
      console.error(`[enroll ${username}] could not clear pending flag: ${e}`);
    }
    if (aborted) {
      // The client hung up mid-enrollment but the enrollment SUCCEEDED. Keep it:
      // the templates are stored and the account is usable, and deleting a
      // complete enrollment because the browser gave up would be worse than the
      // problem being fixed here. It is recorded as an abort so the benchmark
      // log shows what the user actually experienced.
      console.warn(`[enroll ${username}] completed after the client aborted; enrollment kept`);
      return finishRegistration(true, 'CLIENT_ABORTED_AFTER_ENROLLMENT', null, 'Video uploaded successfully');
    }
    return finishRegistration(true, null, null, 'Video uploaded successfully');
  });

  // Login: the fresh recording is still encrypted to disk, because login needs it
  // twice (template extraction and speech-to-text) and those run in parallel. It
  // is transient — login() deletes it once the attempt resolves — so no login
  // recording is retained either.
  app.post('/upload-video-login', upload.single('video'), function (req, res) {
    const file = req.file;
    if (!file) {
      return res.status(400).send({ error: 'Please upload a video file' });
    }
    if (!LOGIN_NAME.test(file.originalname)) {
      return res.status(400).send({ error: 'Invalid file name' });
    }
    // This endpoint cannot require a session token — logging in is exactly what
    // the caller has not done yet. It is instead bound to a live login attempt:
    // the client must have fetched a CAPTCHA for this username (GET /captcha)
    // and it must not have expired. Without this, any unauthenticated client
    // could overwrite the recording a victim is about to submit. The challenge
    // is only checked here, never consumed — /api/login spends it.
    const username = file.originalname.slice(0, -'_l.mp4'.length);
    if (!hasLiveCaptcha(username)) {
      return res.status(401).send({ error: 'No active login challenge for this user' });
    }
    // Evaluation capture (each login = the next session for this user). No-op
    // unless EVAL_CAPTURE is set AND the participant consented to retention. The
    // login recording is otherwise deleted by login() once the attempt resolves,
    // so this is the only point it survives. The clip is labelled with the live
    // challenge (peeked, not consumed — /api/login still spends it).
    captureIfEnabled(file.buffer, username, req.body.evalConsent === 'true', peekCaptcha(username));
    try {
      encryptToFile(file.buffer, 'uploadsl/login_videos/' + file.originalname + '.enc');
    } catch (e) {
      console.error(`[upload] encrypt failed: ${e}`);
      return res.status(500).send({ error: 'Could not store video' });
    }
    res.send('Video uploaded successfully');
  });
  

// start server only when we have valid db connection
//connect fn. will return a promise so we will use 'then' here
//inside then we will call a callback function with try and catch
if (ENV.EVAL_CAPTURE) {
    console.warn(
        `[eval-capture] ENABLED — plaintext recordings will be written to ` +
        `${ENV.EVAL_CORPUS_DIR} (session ${ENV.EVAL_SESSION ?? "auto"}). This suspends template-only storage and is for ` +
        `consented evaluation ONLY. Do not run this way in production.`
    );
}

// Both databases must be up before requests are accepted: the application DB
// (accounts) and the SEPARATE biometric key vault (wrapped per-user keys).
// Failing either fails startup — a server that cannot reach the vault could
// accept enrollments whose keys it cannot store.
Promise.all([connect(), connectVault()]).then( () => {
    try{
        // Sweeps registrations that never completed their biometric enrollment
        // (enrollmentJanitor.js). Started with the server so an abandoned
        // registration cannot outlive its enrollment window.
        startEnrollmentJanitor();
        app.listen(port, () => {
            console.log(`Server connected to http://localhost:${port}`)
        })
    }catch(error){
        console.log('Cannot connect to the Server')
    }
}).catch(error => {
    console.log("Invalid database Connection !!!", error.message)
})



