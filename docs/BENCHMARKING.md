# Benchmarking registration and login

Two things changed together, because they answer the same question from
different sides: *what happened, and how long did it take?*

1. A failed login now says **which factor failed**, instead of a single opaque
   "Login UnSuccessful...!".
2. Every registration and every login attempt writes one **timed record** to a
   benchmark log, success or failure.

`backend/scripts/measure_performance.mjs` remains the controlled bench rig
(N repeated runs of one clip, sequential-vs-parallel comparison). What is
described here is the complementary half: the live system, measured as it is
actually used.

---

## 1. What is timed

Neither flow lives entirely on the server, so a server-only stopwatch would
report roughly half of what a user experiences. Each record therefore holds two
measured components and their sum.

### Registration — `totalMs = clientPreMs + serverMs`

| Component | Measured by | Covers |
|---|---|---|
| `clientPreMs` | `frontend/src/components/Register.js` | form validation → `POST /api/register` (account row, PII sealing under `PII_KEY`, e-mail index, enrolment token, notification mail) → recording blob prepared → immediately before `POST /upload-video` |
| `serverMs` | `backend/server.js`, `/upload-video` | template extraction (InsightFace face + ECAPA-TDNN voice), per-user key generation in the vault, AES-256-GCM encryption, template write, and the rollback path when enrolment fails |

The record is written by `/upload-video`, the last step of registration, so
there is exactly **one** record per attempt.

A registration that dies before that point — invalid username, invalid e-mail,
account creation failure — is recorded by `/api/register` instead, with
`phases.stage = "account_creation"`, `serverMs` only and `totalMs: null`.

### Login — `totalMs = clientPreMs + serverMs`

| Component | Measured by | Covers |
|---|---|---|
| `clientPreMs` | `frontend/src/components/Password.js` | submit → recording blob prepared → `POST /upload-video-login` completes (upload + AES-256-GCM encryption to disk) → immediately before `POST /api/login` |
| `serverMs` | `backend/controllers/appController.js`, `login()` | template decryption (vault lookup → unwrap → decrypt) + login-recording decryption, template extraction from the login recording, face match, voice match, audio extraction, speech-to-text, CAPTCHA comparison, JWT issue, response |

`serverMs` is broken down further in `phases`:

| Phase | Meaning |
|---|---|
| `decryptMs` | enrolled template + login recording decrypted to a private temp dir |
| `verifyMs` | wall-clock of the whole three-factor stage (the branches run **concurrently**, so this is *not* the sum of the phases below) |
| `templateExtractionMs` | building the login template from the recording |
| `faceVoiceMatchMs` | face and voice matched in parallel against the stored template |
| `speechMs` | audio extraction + speech-to-text for the spoken CAPTCHA |

### Deliberately excluded

* **The time the user spends recording.** That is human pace, not system
  latency; including it would make the benchmark a measurement of how slowly
  people read five digits.
* **The final response leg back to the browser** (a few milliseconds).
* Anything before the user presses Register / Log in.

When one half is missing — an older client, or a failure that aborted before the
browser could report anything — `totalMs` is `null` rather than a half-measure.
`serverMs` is still recorded, and the aggregate timings are computed over
complete measurements only, so a partial run is counted in `attempts` but never
silently distorts a mean.

---

## 2. Where the results go

**File** (the primary artefact): `backend/benchmarks/benchmarks.jsonl`, one JSON
object per line, appended.

```json
{"timestamp":"2026-08-22T07:28:30.400Z","operation":"login","status":"failure",
 "reason":"FACE_MISMATCH+CAPTCHA_MISMATCH","subject":"5975c848214c7d42",
 "totalMs":10200,"clientPreMs":1200,"serverMs":9000,
 "device":{"width":1280,"height":720,"frameRate":30,"platform":"Win32"},
 "phases":{"decryptMs":41.2,"verifyMs":8940.1,"templateExtractionMs":5210,
           "faceVoiceMatchMs":3480,"speechMs":4120}}
```

Every field asked for is present: operation type, success/failure status, total
time, and timestamp — plus the failure reason and the stage breakdown.

`operation` is `registration`, `login`, `reenrollment` (an authorised template
replacement, `/upload-video` under a `reenroll` grant) or `reenroll_request`
(the three-factor check that authorises one).

### Capture settings (`device`)

Each record also carries the video capture settings the browser actually
negotiated for that attempt — `width`, `height`, `frameRate` — and a short
`platform` string, or `null` when the client reported none. Without them the log
describes hardware it does not name, and cannot answer the one question a
capture-driven system most needs answered: does this work across devices? With
them, a per-device and cross-device breakdown is possible from the existing log,
with no new instrumentation.

The values are read from the live `MediaStream` track
(`frontend/src/components/Register.js`, `Password.js`), so they are what was
negotiated, not what was requested — the recorders ask with `ideal` constraints
(720p30, mono audio), which a device may meet only partially. They are
self-reported and therefore bounded and whitelisted on arrival
(`benchmarkStore.deviceInfo`), used for analysis only, and never an input to any
decision. `platform` is deliberately not the full user-agent: the record names
no user and must not carry a fingerprint either.

**Report script:**

```bash
cd backend
node scripts/benchmark_report.mjs          # human-readable summary
node scripts/benchmark_report.mjs --json   # summary + records as JSON
node scripts/benchmark_report.mjs --csv    # one row per attempt, for a spreadsheet
```

**HTTP:** `GET /api/benchmarks?limit=100` (requires a session token, i.e. a
logged-in user) returns `{ file, summary, records }`. The summary aggregates the
whole log: attempts, success/failure counts, failure-reason histogram, and
mean / min / max / p95 for both end-to-end and server-side time.

**Off switch:** `BENCHMARK_LOG=0` disables writing entirely.
`BENCHMARK_DIR` relocates the log.

### Privacy

A benchmark log must not become a second, unprotected user directory. **The
username is never written.** Each record carries a keyed pseudonym —
`HMAC(BIOMETRIC_INDEX_KEY, "benchmark-subject:" + username)`, truncated — which
groups one user's attempts together without naming them, the same reasoning as
the template filenames (see `docs/TEMPLATE_STORAGE.md`). No biometrics, no
CAPTCHA values, no transcripts, no e-mail. The log file is git-ignored.

Writing a record can never fail a login or a registration: a full disk or a
read-only mount is logged and swallowed.

---

## 3. Login failure reasons

### Why the response now names the factor

The response used to be one opaque sentence for every cause, on the argument
that naming the failed factor helps an attacker. That argument is weak here and
the cost was high: a user whose CAPTCHA had merely expired, or whose recording
contained no detectable face, was told exactly the same thing as an impostor —
so the only available remedy was to record again and hope. The scheme is
passwordless, so there is no secret disclosed by saying "your voice did not
match", and an attacker holding a video can already isolate each factor by
submitting deliberately broken inputs.

**What is still withheld:** similarity scores, thresholds, distances, the
CAPTCHA text, the transcript, and any statement about which factors *passed*
beyond what the failure list implies. The messages below are the complete set a
client can ever see.

### The reasons

| `reason` code | HTTP | Shown to the user |
|---|---|---|
| `USER_NOT_FOUND` | 404 | No account exists for that username. |
| `INVALID_USERNAME` | 400 | That username is not valid. |
| `LOGIN_IN_PROGRESS` | 429 | A login attempt for this account is already running. Please wait for it to finish. |
| `NO_ENROLLMENT` | 401 | This account has no biometric enrollment … Register again with the same username and e-mail to complete enrollment — the unfinished account is released automatically, so nothing is lost. (Body also carries `recovery: "REGISTER_AGAIN"`, and the login page shows a Register link.) See `docs/enrollment-completion.md`. |
| `RECORDING_MISSING` | 400 | No login recording was received. Please record your video and try again. |
| `RECORDING_UNREADABLE` | 401 | Your login recording could not be read. Please record it again. |
| `BIOMETRIC_EXTRACTION_FAILED` | 401 | No usable face or voice could be found in your recording. Make sure your face is clearly visible and lit, and that you speak aloud. |
| `FACE_MISMATCH` | 401 | Your face did not match the face enrolled for this account. |
| `VOICE_MISMATCH` | 401 | Your voice did not match the voice enrolled for this account. |
| `SPEECH_NOT_RECOGNIZED` | 401 | Your speech could not be transcribed. Please read the CAPTCHA aloud, clearly and close to the microphone. |
| `CAPTCHA_MISMATCH` | 401 | The CAPTCHA you read aloud did not match the one shown. |
| `CAPTCHA_EXPIRED` | 401 | Your CAPTCHA expired or was already used. A new one has been issued — record yourself reading it. |
| `SERVER_ERROR` | 500 | The biometric check could not be completed. Please try again. |

Response body on failure:

```json
{ "msg": "Login UnSuccessful...!",
  "reason": "FACE_MISMATCH+CAPTCHA_MISMATCH",
  "error": "Your face did not match the face enrolled for this account. The CAPTCHA you read aloud did not match the one shown.",
  "failedFactors": ["FACE_MISMATCH", "CAPTCHA_MISMATCH"] }
```

`msg` is unchanged for backward compatibility. Because the factors are verified
concurrently, **several can fail at once**; the codes are joined with `+` and
the sentences are concatenated, so the benchmark log aggregates each combination
as its own reason.

Two conditions are separated out *before* the CAPTCHA is consumed, because they
are not authentication failures at all and used to hide behind a decrypt error:
`NO_ENROLLMENT` (the account never enrolled) and `RECORDING_MISSING` (no
recording was uploaded for this attempt). A user in either state does not lose
their challenge.

`BIOMETRIC_EXTRACTION_FAILED` is reported instead of a face/voice mismatch when
no template could be built from the recording at all — with nothing to compare,
"your face did not match" would be untrue, and the remedy is different.

The frontend shows the sentence both as a toast and as a persistent panel under
the Log in button, so it is still readable while the user sets up the next
recording.
