# Implementation Report: Secure User Authentication Using Multimodal Biometrics

**Project:** Multibiometric_Code
**Base research paper:** *Secure User Authentication Scheme Using Multimodal Biometrics* (Rajput & Varshney, IIT Jammu) — `Research_paper.pdf`
**Report prepared:** 2026-07-16
**Scope:** Objective, evidence-based account of the original paper design, what the repository originally implemented, the defects found, every improvement made, and the current state of the system.

> **Note on claims.** This report avoids "fully verified" language. Biometric accuracy statements are qualified to the available dataset (two human subjects across four accounts plus impostor clips). No completion percentages are given; status is expressed only through the implementation-status table in Section 12. All measurements cited are from the project's own measurement runs recorded in `docs/PERFORMANCE.md`.

---

## Table of Contents

1. Project Overview
2. Original Research Paper Design
3. Original Repository Implementation
4. Problems Identified
5. Complete List of Improvements
6. Current Architecture
7. Current Folder Responsibilities
8. Security Improvements
9. Performance Improvements
10. Comparison Table
11. Research Paper Differences
12. Implementation Status
13. Testing and Validation
14. Remaining Work
15. Conclusion

---

## 1. Project Overview

### 1.1 Objective of the research paper

The paper proposes a **passwordless multimodal biometric authentication scheme** in which a single webcam recording simultaneously carries three independent credentials:

1. **Face** — the user's facial appearance across video frames.
2. **Voice** — the user's speaker characteristics from the audio track.
3. **Spoken CAPTCHA** — a challenge string the user reads aloud, defeating replay and proving liveness.

All three factors must agree (AND logic) before authentication succeeds. The central claim is that combining three factors captured in one action raises the security bar over single-modality biometrics while keeping the user experience to a single recording.

### 1.2 Original architecture proposed in the paper

```
                 ┌──────────────────────────┐
                 │   Single webcam video    │
                 └────────────┬─────────────┘
                              │
              ┌───────────────┼────────────────┐
              │               │                │
         Frame extract   Audio extract    (audio reused)
              │               │                │
         pHash + Hamming  MFCC Euclidean   Speech-to-Text
          (face match)    (voice match)   (CAPTCHA verify)
              │               │                │
              └───────────────┴────────────────┘
                              │
                      AND of three results
                              │
                    Grant / Deny access
```

In the paper the three matching stages run in a **cascade**: audio extraction is triggered only after face matching succeeds, and CAPTCHA validation only after voice matching succeeds (Algorithm 1, Fig. 6).

### 1.3 Overall authentication workflow (paper)

1. User records a short video reading a displayed CAPTCHA aloud.
2. Server extracts frames and matches them against the enrolled reference using perceptual hashing.
3. On success, server extracts audio and matches voice using MFCC distance.
4. On success, server transcribes speech and compares to the issued CAPTCHA.
5. If all three pass, access is granted.

---

## 2. Original Research Paper Design

### 2.1 Registration workflow

- User records an enrollment video.
- Server stores the reference material keyed by username. Paper §3.1 describes the raw video (e.g. `username.mp4`) being saved in the database as the enrolled reference.

### 2.2 Login workflow

- User is shown a CAPTCHA, records a video reading it aloud.
- Server processes the video through the cascaded pipeline (Section 1.3).

### 2.3 Authentication workflow

- **Cascade / sequential:** each stage gates the next. A failure at any stage short-circuits the remaining stages.
- Final decision is the AND of the three stage results.

### 2.4 Face recognition algorithm

- **Perceptual hash (pHash)** of extracted frames.
- Comparison by **Hamming distance** between reference and probe hashes (`P1`, `P2` in the notation table; Fig. 11).
- Accept if distance ≤ threshold (paper uses **25**).

### 2.5 Voice verification algorithm

- **MFCC** (13 coefficients) extracted per frame with Librosa.
- Comparison by **Euclidean distance** between MFCC feature sets (Algorithm 2).
- Accept if distance is below a threshold (**200**).

### 2.6 CAPTCHA verification

- Server issues a challenge string.
- Speech-to-text transcribes the spoken audio.
- Accept if the normalized transcript equals the issued challenge.

### 2.7 Data storage

- Raw enrollment video stored in the database, keyed by username.

### 2.8 Security model

- Three independent factors combined with AND logic.
- Spoken CAPTCHA provides liveness / anti-replay.
- Paper Table 1 asserts properties including **"no trusted third party"**.

### 2.9 Advantages and limitations of the original design

| Advantages | Limitations |
|---|---|
| Single capture action yields three factors | Cascade is sequential, not truly parallel |
| AND logic raises attack cost | pHash hashes the whole frame (background/lighting), not the face |
| Spoken CAPTCHA gives liveness | MFCC-Euclidean is not speaker-discriminative |
| Passwordless | Raw video stored; large privacy/theft exposure |
| | Identity keyed by filename — no binding to an authenticated account |

---

## 3. Original Repository Implementation

This section describes the repository **as it stood before the improvements in this project**.

### 3.1 What matched the paper

- Single-video, three-factor concept implemented in a MERN stack (React + Node/Express + MongoDB) that shells out to Python scripts for the biometric math.
- pHash+Hamming face matcher (`matchFrames.py`) and MFCC voice matcher (`matchAudio.py`) existed, matching the paper's algorithms.
- Frame/audio extraction via OpenCV/FFmpeg-style scripts existed.

### 3.2 What was missing

- **CAPTCHA verification was not effectively enforced** as a server-side single-use challenge.
- No encryption at rest.
- No performance measurement.
- No enrollment authentication.

### 3.3 Bugs

- **Voice matcher `.all` bug** (`matchAudio.py:17`): the condition referenced the bound method `.all` (always truthy) instead of calling `.all()`, so the voice check effectively always passed.
- **Auth-bypass:** the login failure branch signed and returned a valid 24-hour JWT alongside its 400 error — a failed login still handed out a token.
- **stdout "yes" scraping:** a matching stage was judged by scraping stdout for `"yes"`, which broke the moment InsightFace/library banners printed extra lines.
- **Login-video race:** the login video was uploaded *after* `/api/login` had already fired.
- **Shared `transcript.wav`:** speech-to-text used one shared temp file — a concurrency hazard.
- **Formik validation** silently blocked all registration and all video upload.

### 3.4 Incorrect implementations

- **pHash over whole frames** measured the room, not the face — it false-rejected a genuine user at the paper's own threshold (measured Hamming 26 vs threshold 25).
- **MFCC-Euclidean mean distance** tracked loudness/recording spread, not speaker identity — impostor pairs overlapped genuine pairs.

### 3.5 Incomplete modules

- CAPTCHA store, single-use enforcement, and digit normalization did not exist.
- No template extraction/storage layer.
- OTP / password-reset flow existed but contradicted the passwordless design.

### 3.6 Security vulnerabilities

| Vulnerability | Nature |
|---|---|
| Enrollment overwrite | `/upload-video` unauthenticated, identity taken from filename |
| Token on failure | Valid JWT returned on failed login |
| Client-supplied paths to `spawn` | Windows filesystem paths from client reached child processes |
| Raw video at rest | No encryption, plaintext biometrics on disk |
| Voice accepts wrong speaker | MFCC statistic not discriminative |

### 3.7 Performance limitations

- No timing instrumentation; no sequential-vs-parallel comparison; no communication-overhead figures.

### 3.8 Architectural limitations

- Sequential cascade only.
- Raw-video storage model.
- Identity bound to filenames rather than authenticated accounts.

---

## 4. Problems Identified

| Problem | Severity | Location | Impact |
|---|---|---|---|
| Enrollment overwrite / account takeover | Critical | `/upload-video` (`server.js`) | Any unauthenticated client could overwrite a victim's template and log in as them |
| Token issued on failed login | Critical | `appController.js` login failure branch | Complete auth bypass |
| Voice matcher `.all` always-true bug | High | `matchAudio.py:17` | Voice factor never actually failed |
| Voice accepts different speaker | High | MFCC algorithm (`matchAudio.py`) | Scheme effectively two-factor |
| pHash false-rejects genuine user | High | `matchFrames.py` | Legitimate user locked out (Hamming 26 vs 25) |
| pHash measures background not face | High | `matchFrames.py` | Likely accepts same-room impostor |
| Raw video stored unencrypted | High | `uploads/`, DB | Biometric theft/tampering exposure |
| Client paths reach `spawn` | High | controllers | Path traversal / arbitrary file access |
| stdout "yes" scraping | Medium | matcher gating | Silent breakage on banner output |
| Login-video upload race | Medium | frontend/login | Login fired before video present |
| Formik validation blocks registration | Medium | `validate.js` | Registration/upload silently blocked |
| Shared `transcript.wav` | Medium | speech-to-text | Concurrency corruption |
| CAPTCHA not single-use server-side | Medium | login flow | Replayable challenge |
| Letter CAPTCHAs unintelligible to STT | Medium | CAPTCHA issuance | Unwinnable challenges |
| No encryption at rest | High | storage | Confidentiality/integrity gap |
| No performance metrics | Low | — | Reviewer comment 3 unanswered |
| Multi-user FAR/FRR/EER absent | Open | dataset | No accuracy claim possible |
| Google STT vs "no third party" claim | Open | `speechToTexty.py` | Contradicts paper Table 1 |

---

## 5. Complete List of Improvements

Each improvement follows the mandated template: original implementation, problem, new implementation, files modified, execution flow, security impact, performance impact, verification performed.

### 5.1 Face recognition migration (pHash → InsightFace)

- **Original implementation:** pHash + Hamming distance over whole frames (`matchFrames.py`), threshold 25.
- **Problem:** Hashes the entire frame (background, lighting, clothing), not the face. False-rejected a genuine user (Hamming 26 vs 25) and much of the impostor "distance" was the room, implying it would accept a same-room impostor.
- **New implementation:** InsightFace `buffalo_l` (ArcFace) 512-d face embeddings, cosine similarity, threshold **0.35**.
- **Files modified:** `backend/matchFaces.py` (then folded into template matching `matchFaceTemplate.py`); `extractTemplate.py`. Original pHash pipeline preserved under `backend/paper_reference/`.
- **Execution flow:** frame → face detect/align → ArcFace embedding → cosine similarity vs enrolled embedding → accept if ≥ 0.35.
- **Security impact:** Measures the actual face; genuine 0.62–0.73 accept, impostor 0.18–0.22 reject — a ~0.40-wide empty gap around threshold.
- **Performance impact:** Face stage dominates end-to-end latency (~4.5 s), the main cost of the upgrade.
- **Verification performed:** All four available test cases correct; genuine/impostor separation measured (see face-matching-deviation record). Verified on the available dataset only.

### 5.2 Voice recognition migration (MFCC → ECAPA-TDNN)

- **Original implementation:** Mean pairwise Euclidean distance over 13-coeff MFCC frames (`matchAudio.py`), threshold 200.
- **Problem:** Not speaker-discriminative — impostor pairs (153.7–193.0) overlapped/beat genuine pairs (172.8–178.8). No threshold separates them.
- **New implementation:** 192-d **ECAPA-TDNN** speaker embedding (SpeechBrain `spkrec-ecapa-voxceleb`), cosine similarity, threshold **0.30** (empirically derived, see below). MFCC fallback deleted entirely.
- **Files modified:** `backend/matchVoiceTemplate.py`, `extractTemplate.py`; deleted `matchAudio.py`, `extractAudio.py`; `requirements.txt` (torch, torchaudio, speechbrain); model cached at `backend/models/ecapa`.
- **Execution flow:** audio → ECAPA embedding → cosine vs enrolled embedding → accept if ≥ 0.30.
- **Threshold derivation:** Labelled set built from real impostor and genuine clips. Real-impostor cosine ceiling 0.256, genuine floor 0.345; a real impostor scored **0.268** — 0.25 would false-accept, **0.30 rejects it**. (espeak-vs-espeak scored 0.883, a synthetic-timbre artifact, excluded.)
- **Security impact:** Voice factor now discriminates speakers; genuine ~1.00 accept, real impostor 0.268 reject.
- **Performance impact:** Voice match itself dropped to **~104 ms** (192-d cosine), but a fresh model load added torch+ECAPA startup to the extraction spawn.
- **Verification performed:** Genuine accept (1.000), real impostor reject (0.268, exit 1), legacy v1 templates fail closed (exit 2). Small evaluation set — no formal EER claimed.

### 5.3 CAPTCHA implementation

- **Original implementation:** No effective server-side single-use CAPTCHA.
- **Problem:** Challenge could be replayed; letter CAPTCHAs were unintelligible to STT.
- **New implementation:** `backend/captchaStore.js` — server-side single-use store (username → text, 5-min TTL). `GET /captcha?username=` returns SVG only; text never sent to client. Digits only (`charPreset "0123456789"`, size 5). `normalizeCaptcha` maps spoken digit words/homophones to numerals; STT emits multiple candidates and the factor accepts if any candidate exactly matches the single-use code.
- **Files modified:** `backend/captchaStore.js`, `server.js`, `speechToTexty.py`, `appController.js`, `frontend/src/components/Password.js`.
- **Execution flow:** issue digit CAPTCHA → store server-side → user speaks → STT candidates → normalize → exact match vs stored single-use code.
- **Security impact:** True liveness/anti-replay; the code lives only server-side and is consumed on use.
- **Performance impact:** STT ~1.25 s.
- **Verification performed:** Positive path (digit codes → 200+token), mismatch → 401, no-captcha → 401. Confirmed live on Windows after fixing single-use re-fetch on retry.

### 5.4 Three-factor AND authentication

- **Original implementation:** Cascade; also the `.all` bug and token-on-failure meant the AND was not truly enforced.
- **Problem:** Factors did not all genuinely vote; failures could still yield tokens.
- **New implementation:** `login` rewritten async/await; token minted **iff** `faceOk && voiceOk && captchaOk`; 401 otherwise. Response never reveals which factor failed (server log does). Fail closed on any error.
- **Files modified:** `backend/controllers/appController.js`.
- **Execution flow:** run all factors → AND → grant/deny.
- **Security impact:** Enforced three-factor AND; no information leak on failure.
- **Performance impact:** Enables parallelism (Section 5.5).
- **Verification performed:** Positive path 200; wrong captcha, no captcha, impostor video all 401.

### 5.5 Parallel authentication pipeline

- **Original implementation:** Sequential cascade (paper Fig. 6): audio only after face, CAPTCHA only after voice.
- **Problem:** Reviewer comment 1 — the "parallel" claim held only for acquisition, not verification.
- **New implementation:** Once the video is captured, biometric and CAPTCHA branches run concurrently (`Promise.all`). Face and voice matching are independent concurrent tasks; STT runs concurrently with voice matching (it needs only the audio, not the voice result). Results combined only at the final AND.
- **Files modified:** `appController.js` (parallel branches ~lines 197, 214).
- **Execution flow:** fork extract branches → concurrent match → await all → AND.
- **Security impact:** No change to the decision logic; still fail-closed.
- **Performance impact:** Sequential vs parallel measured (Section 9); parallel bounded by the face stage.
- **Verification performed:** Measurement runs returned HTTP 200 with all three factors true.

### 5.6 Template generation

- **Original implementation:** Raw video used directly at each login.
- **Problem:** Storing/replaying raw video is a privacy and storage cost.
- **New implementation:** `extractTemplate.py` reduces a recording to a 512-d InsightFace embedding + per-frame embeddings + 192-d ECAPA voice embedding (schema v2) as JSON.
- **Files modified:** `backend/extractTemplate.py`, `templateStore.js`.
- **Execution flow:** video → embeddings JSON → encrypt → store.
- **Security impact:** Only derived features stored, not raw biometrics.
- **Performance impact:** Stored size ~89 KB/user vs ~1.49 MB raw video.
- **Verification performed:** Scores unchanged by design (face genuine 0.6518 identical old vs new).

### 5.7 Migration from raw video storage to encrypted template storage

- **Original implementation:** `username.mp4` saved in DB / `uploads/videos/`.
- **Problem:** Reviewer comment 2 — raw biometric video exposed to theft/tampering.
- **New implementation:** Templates only. `templateStore.enrollFromBuffer` writes video to a temp file, runs `extractTemplate.py`, encrypts the template to `backend/templates/<user>.tmpl.enc`, deletes the temp video. `uploads/videos/` is now empty.
- **Files modified:** `templateStore.js`, `server.js`, `scripts/migrate_to_templates.mjs`.
- **Execution flow:** upload → temp video → template → encrypt → delete video.
- **Security impact:** No raw video of any user exists on disk.
- **Performance impact:** ~74× storage reduction.
- **Verification performed:** All four accounts migrated (`--delete`); 6/6 case matrix re-verified.

### 5.8 AES-256-GCM secure storage

- **Original implementation:** Plaintext on disk.
- **Problem:** No confidentiality or integrity at rest.
- **New implementation:** `backend/secureStore.js` — AES-256-GCM. Key from `BIOMETRIC_KEY` env or JWT_SECRET-derived (with warning). GCM auth tag provides integrity.
- **Files modified:** `secureStore.js`, `templateStore.js`, login/registration paths.
- **Execution flow:** encrypt on write, decrypt to temp on read, verify GCM tag.
- **Security impact:** Confidentiality + tamper detection; a flipped byte fails the auth tag → 401.
- **Performance impact:** Decrypt ~2 ms — negligible.
- **Verification performed:** Tamper test (flipped byte → GCM auth failure → 401).

### 5.9 Temporary file cleanup

- **Original implementation:** Login consumed persistent files.
- **Problem:** Retained plaintext biometrics.
- **New implementation:** Login decrypts template + recording into a `mkdtemp` dir, removed in `finally`. **The login recording itself is deleted after each attempt.**
- **Files modified:** `appController.js`.
- **Execution flow:** decrypt to temp → match → `finally` remove temp + delete recording.
- **Security impact:** No plaintext biometric persists after a login.
- **Performance impact:** Negligible.
- **Verification performed:** Confirmed recording deleted post-login (test harnesses must re-plant `<user>_l.mp4.enc` before every attempt).

### 5.10 Enrollment-token security

- **Original implementation:** `/upload-video` unauthenticated; identity taken from uploaded filename.
- **Problem:** Critical — any client could overwrite any user's template (account takeover).
- **New implementation:** `backend/enrollToken.js` issues a one-time signed JWT `{username, purpose:"enroll"}` (10-min TTL) from `/api/register`. `/upload-video` now requires `Authorization: Bearer <token>` and takes the username from the verified claim, never the filename. Duplicate usernames are rejected at register, so no token can exist for an existing account. A session JWT is rejected (purpose claim checked).
- **Files modified:** `backend/enrollToken.js`, `server.js`, `frontend/src/components/Register.js` (register first, then upload with token).
- **Execution flow:** register → mint enroll token → upload with token → username from claim.
- **Security impact:** Closes account-takeover; stolen session token cannot re-enroll.
- **Performance impact:** Negligible.
- **Verification performed:** No token / session-JWT / expired → 401; other-user token writes only that user's template; victim template byte-identical (sha256 unchanged). Doc: `docs/enrollment-security.md`.

### 5.11 JWT authentication

- **Original implementation:** JWT present but issued even on failure.
- **Problem:** Auth bypass.
- **New implementation:** Token minted only on the successful AND path; distinct enroll-purpose token for registration upload.
- **Files modified:** `appController.js`, `enrollToken.js`.
- **Execution flow:** success → sign session JWT; failure → 401, no token.
- **Security impact:** No token leaks on failure; purpose-scoped tokens.
- **Performance impact:** Negligible.
- **Verification performed:** Failed logins return 401 with no token.

### 5.12 Login flow improvements

- **Original implementation:** Cascade; login-video race; uniform breakage on library output.
- **Problem:** Race condition and brittle gating.
- **New implementation:** Async/await; exit-code gating with 120 s per-stage timeouts; parallel branches; fail closed.
- **Files modified:** `appController.js`.
- **Execution flow:** upload → decrypt → parallel factors → AND → token/401.
- **Security impact:** Robust fail-closed behavior.
- **Performance impact:** Enables parallelism.
- **Verification performed:** 6-case matrix (genuine, wrong captcha, no captcha, different person, tampered template, deleted recording).

### 5.13 Registration flow improvements

- **Original implementation:** Formik validation silently blocked registration/upload; password fields present.
- **Problem:** Registration blocked; passwords contradicted passwordless design.
- **New implementation:** Validation fixed; password removed everywhere (schema, login, register, frontend); register-then-upload ordering with enroll token.
- **Files modified:** `Register.js`, `validate.js`, `User.model.js`, `appController.js`.
- **Execution flow:** register account → mint token → upload video → template stored.
- **Security impact:** Passwordless as designed; enrollment authenticated.
- **Performance impact:** Negligible.
- **Verification performed:** Registration over HTTP → 200 + template written + no video kept; no-face video → 400 fail closed.

### 5.14 Error handling improvements

- **Original implementation:** stdout scraping; token-on-failure; ambiguous failures.
- **Problem:** Silent/incorrect failure handling.
- **New implementation:** Exit-code-authoritative stage gating (0/1/2); fail closed on any error; uniform 401 to client, detailed per-factor log server-side (`face= voice= captcha=`).
- **Files modified:** `appController.js`, Python matchers.
- **Execution flow:** each stage returns exit code → gate → AND.
- **Security impact:** No factor-disclosure to attacker; every failure is a real failure.
- **Performance impact:** Negligible.
- **Verification performed:** Field defects were diagnosable purely from the per-factor log line.

### 5.15 Performance measurement framework

- **Original implementation:** None.
- **Problem:** Reviewer comment 3 — no quantified processing/communication delay.
- **New implementation:** `scripts/measure_performance.mjs` times each stage and end-to-end, sequential baseline vs parallel. Requires a login-video path argument (nothing on disk to replay). Results in `docs/PERFORMANCE.md`.
- **Files modified:** `scripts/measure_performance.mjs`, `docs/PERFORMANCE.md`.
- **Execution flow:** replay login N times → collect per-stage timings → report.
- **Security impact:** None.
- **Performance impact:** Produced the numbers in Section 9.
- **Verification performed:** All measurement runs returned HTTP 200 with all three factors true. FAR/FRR/EER still not computable on the current dataset (data gap).

### 5.16 Deployment improvements

- **Original implementation:** Local-only; hardcoded port 8080; no config for env.
- **Problem:** Port conflicts; no reproducible run.
- **New implementation:** `PORT` honored (8099 here); `config.js` reads `process.env`; Mongo in Docker; Python via repo venv (`ENV.PYTHON` defaults to `../.venv/bin/python`).
- **Files modified:** `server.js`, `config.js`, `docs/DEPLOYMENT.md`.
- **Execution flow:** env-driven backend + frontend.
- **Security impact:** No client-controlled paths reach `spawn`; server owns upload dirs.
- **Performance impact:** N/A.
- **Verification performed:** Backend runs on 8099, DB connects.

### 5.17 HTTPS testing using Cloudflare Tunnel

- **Original implementation:** None.
- **Problem:** Needed real HTTPS + real webcam/mic for browser capture (no camera on the dev box).
- **New implementation:** Cloudflare quick tunnels for backend and frontend. **`--protocol http2` mandatory** (network blocks outbound UDP 7844; default QUIC fails with error 1033). Frontend rebuilt with backend tunnel URL baked in (CRA bakes env at build time).
- **Files modified:** `docs/DEPLOYMENT.md`, `docs/TESTING_WINDOWS.md`.
- **Execution flow:** `node server.js` → `cloudflared --url ... --protocol http2` → rebuild frontend → serve + second tunnel → open on Windows.
- **Security impact:** Enabled real HTTPS end-to-end testing.
- **Performance impact:** Single-edge-connection tunnels flap ~every 5 min (host uplink), recover in ~20 s — operational, not a code issue.
- **Verification performed:** Full three-factor login passed end-to-end on a Windows laptop as user `kanika1206`.

### 5.18 Documentation updates

- **Original implementation:** Sparse README; none of the run steps documented.
- **Problem:** Reproducibility.
- **New implementation:** `docs/PERFORMANCE.md`, `docs/TEMPLATE_STORAGE.md`, `docs/enrollment-security.md`, `docs/voice-verification.md`, `docs/DEPLOYMENT.md`, `docs/TESTING_WINDOWS.md`; README rewritten. Paper's original algorithms preserved in `backend/paper_reference/`.
- **Files modified:** `docs/*`, `README.md`.
- **Execution flow:** N/A.
- **Security impact:** N/A.
- **Performance impact:** N/A.
- **Verification performed:** Docs reflect measured values (e.g. voice threshold 0.30).

---

## 6. Current Architecture

The system is a **MERN application that shells out to Python** biometric scripts. A single webcam video carries all three factors; **no raw video of any user is stored** — only encrypted templates.

### 6.1 Registration

```
Video Capture (React, react-media-recorder)
        │
        ▼  POST /upload-video  (Bearer enroll-token; multer memoryStorage)
Template Generation (extractTemplate.py)
   512-d InsightFace embedding + per-frame embeddings + 192-d ECAPA voice embedding
        │
        ▼
Encryption (secureStore.js — AES-256-GCM)
        │
        ▼
Storage  backend/templates/<user>.tmpl.enc   (temp video deleted; fail closed if no face)
```

### 6.2 Login

```
Video Capture (React)
        │
        ▼  POST /upload-video-login  (encrypted to temp)
   ┌────────────────────────────────────────────┐
   │            Parallel Execution               │
   │  Biometric branch        CAPTCHA branch     │
   │  extractTemplate.py      extractAudio_login │
   │     │       │                 │             │
   │  Face      Voice          Speech-to-Text    │
   │  match     match          (speechToTexty)   │
   │ (Face      (ECAPA         normalize vs      │
   │  cosine    cosine         single-use code   │
   │  ≥0.35)    ≥0.30)         in captchaStore)  │
   └────────────────────────────────────────────┘
        │
        ▼
   AND Decision  (face && voice && captcha)
        │
        ▼
   JWT (only on success; uniform 401 otherwise)
        │
        ▼
   Cleanup (finally: remove temp dir; delete login recording)
```

### 6.3 Key runtime facts

- Uploads use multer **memoryStorage** with a strict filename regex; plaintext never lands on disk.
- Server owns `UPLOAD_DIR` / `LOGIN_UPLOAD_DIR`; no client path reaches `spawn`.
- `runPy` gates on child exit codes with 120 s timeouts; fail closed on any error.
- Thresholds: **face cosine ≥ 0.35**, **voice cosine ≥ 0.30**, CAPTCHA exact match.

---

## 7. Current Folder Responsibilities

| Path | Responsibility |
|---|---|
| `frontend/src/` | React UI; records video (`react-media-recorder`), posts blobs, handles register/login. `Password.js` re-fetches single-use CAPTCHA on failure; `Register.js` register-then-upload with token |
| `backend/server.js` | Express entry point; routes, `/upload-video`, `/upload-video-login`, `/captcha`; env-driven `PORT`; owns upload dirs |
| `backend/controllers/appController.js` | Login orchestration — parallel factors, AND decision, JWT, cleanup |
| `backend/templateStore.js` | Enrollment: video → template → encrypt → delete video |
| `backend/secureStore.js` | AES-256-GCM encrypt/decrypt with GCM integrity tag |
| `backend/enrollToken.js` | One-time enroll JWT (`purpose:"enroll"`, 10-min TTL) |
| `backend/captchaStore.js` | Server-side single-use CAPTCHA store (5-min TTL) |
| `backend/extractTemplate.py` | InsightFace + ECAPA embeddings → JSON template |
| `backend/matchFaceTemplate.py` | Face cosine similarity vs stored embedding (≥0.35) |
| `backend/matchVoiceTemplate.py` | ECAPA cosine similarity vs stored embedding (≥0.30) |
| `backend/speechToTexty.py` | STT over HTTPS; multi-candidate output for CAPTCHA |
| `backend/extractAudio_login.py` | Audio extraction for CAPTCHA branch |
| `backend/models/ecapa` | Cached SpeechBrain ECAPA-TDNN model |
| `backend/templates/` | Encrypted per-user templates (`<user>.tmpl.enc`) |
| `backend/paper_reference/` | Paper's original pHash pipeline, preserved for reproducibility (not wired in) |
| `backend/scripts/` | `migrate_to_templates.mjs`, `reenroll_ecapa.mjs`, `measure_performance.mjs`, `encrypt_existing.mjs` |
| `docs/` | Performance, template storage, enrollment/voice security, deployment, Windows testing |

---

## 8. Security Improvements

| Improvement | Why it is better than the paper/original |
|---|---|
| **Enroll-token identity binding** | Paper/original keyed identity off filename; anyone could overwrite any template. Now identity comes from a server-signed one-time token — closes account takeover |
| **AES-256-GCM at rest** | Paper stored raw video; now confidentiality **and** integrity (GCM tag detects tampering → 401) |
| **Template-only storage** | Raw biometrics no longer exist on disk; a breach leaks derived embeddings inside an encrypted envelope, not video |
| **Post-login cleanup** | Login recording and decrypted temp are deleted every attempt — no lingering plaintext |
| **Enforced three-factor AND** | Original `.all` bug and token-on-failure meant the AND was not real; now every factor genuinely votes and failure never yields a token |
| **Discriminative voice factor (ECAPA)** | MFCC-Euclidean accepted wrong speakers; ECAPA cosine actually separates speakers (real impostor 0.268 rejected at 0.30) |
| **Face measures the face (InsightFace)** | pHash measured background; ArcFace embeddings measure identity with a wide separation gap |
| **Server-owned paths** | Client-supplied filesystem paths no longer reach `spawn` |
| **Single-use server-side CAPTCHA** | Challenge text never sent to client, consumed on use — real anti-replay/liveness |
| **No factor disclosure** | Uniform 401; only the server log records which factor failed |

---

## 9. Performance Improvements

Instrumentation added via `scripts/measure_performance.mjs`; results in `docs/PERFORMANCE.md`. Measurements are on this dev box, N=5.

### 9.1 Per-stage timing (template-storage build)

| Stage | Time |
|---|---|
| Face match | ~4473 ms (dominant) |
| Voice match (MFCC era) | ~1298 ms |
| STT | ~1253 ms |
| Decrypt | ~2 ms |

### 9.2 Sequential vs parallel

| Build | Sequential | Parallel | Speedup |
|---|---|---|---|
| Pre-template | 7316 ms | 5450 ms | 1.34× |
| Template storage | 6257 ms | 4994 ms | 1.25× |
| After ECAPA migration | — | 13293 ms | 1.15× |

Parallel latency is bounded by the face stage. After the ECAPA migration, **voice matching itself dropped to ~104 ms** (192-d cosine vs the old MFCC distance), but a **fresh spawn now loads both InsightFace and torch/ECAPA**, raising extraction cost (~3996 → ~12424 ms). This is model-load overhead of a cold spawn, addressable with a warm long-running server process.

### 9.3 Storage

| Metric | Before | After |
|---|---|---|
| Per-user stored | ~1.49 MB raw video | ~89 KB encrypted template (~74× smaller) |

### 9.4 What could not be measured

- **FAR / FRR / EER** — not computable on the current dataset (two human subjects, four accounts). This is a data gap, not a code gap.

---

## 10. Comparison Table

| Dimension | Original Paper | Original Repository | Current Implementation |
|---|---|---|---|
| **Face recognition** | pHash + Hamming (≤25) | pHash + Hamming (false-rejected genuine) | InsightFace ArcFace 512-d, cosine ≥0.35 |
| **Voice recognition** | MFCC Euclidean (<200) | MFCC with `.all` always-true bug | ECAPA-TDNN 192-d, cosine ≥0.30 |
| **Storage** | Raw `username.mp4` in DB | Raw video on disk | Encrypted templates only (`.tmpl.enc`) |
| **Authentication** | Cascade (sequential) | Cascade + token-on-failure bug | Parallel branches, enforced AND, fail closed |
| **Security** | AND + spoken CAPTCHA | Auth bypass, enrollment overwrite, plaintext | Enroll token, AES-256-GCM, cleanup, no factor disclosure |
| **Performance** | Not quantified | Not measured | Per-stage + seq/parallel + storage measured |
| **Architecture** | Single video, three factors | Same, sequential | Same concept; parallel + template layer |
| **Deployment** | Not addressed | Local, hardcoded port | Env-driven; Cloudflare HTTPS tunnels |
| **Encryption** | None specified at rest | None | AES-256-GCM with integrity tag |

---

## 11. Research Paper Differences

Each intentional deviation, why, whether it is an improvement, and whether the paper should be updated.

| # | Difference | Why changed | Improvement? | Paper should update? |
|---|---|---|---|---|
| 1 | Face: pHash → InsightFace | pHash false-rejected genuine user and measured background not face | Yes | Yes — Fig. 11 / algorithm and threshold |
| 2 | Voice: MFCC-Euclidean → ECAPA-TDNN | MFCC statistic not speaker-discriminative | Yes | Yes — Algorithm 2 |
| 3 | Storage: raw video → encrypted templates | Privacy/theft exposure (reviewer comment 2) | Yes | Yes — §3.1 "video saved in database" |
| 4 | Cascade → parallel `Promise.all` | Reviewer comment 1 (parallel verification) | Yes | Yes — Algorithm 1 / Fig. 6 |
| 5 | Identity: filename → signed enroll token | Account-takeover defect | Yes | Yes — enrollment description |
| 6 | Voice threshold 0.25 → 0.30 | Empirically re-derived from measured gap (a real impostor scored 0.268) | Yes | Yes — update stated operating point |
| 7 | CAPTCHA letters → digits | Letters unintelligible to STT | Yes (practical) | Optional note |

**Contradiction to resolve in the paper:** Table 1 claims **"no trusted third party"**, but `speechToTexty.py` uses Google STT. Either the claim must be softened or the STT must move on-device.

---

## 12. Implementation Status

### Fully Implemented (code side, verified on available dataset)

- Face migration to InsightFace
- Voice migration to ECAPA-TDNN
- Server-side single-use CAPTCHA
- Enforced three-factor AND, fail closed
- Parallel verification pipeline
- Template generation + encrypted template-only storage
- AES-256-GCM at rest with integrity
- Temporary file / recording cleanup
- Enrollment-token security
- JWT scoped to success + enroll purpose
- Registration/login flow fixes, passwordless
- Performance measurement framework
- Cloudflare HTTPS tunnel deployment + live Windows test
- Documentation set

### Partially Implemented

- **Accuracy evaluation** — per-stage timing done; FAR/FRR/EER not computable on current dataset
- **CAPTCHA on register page** — client-side `react-simple-captcha` still used on Register; login uses the server-side single-use store (two different mechanisms)
- **HTTP-level upload endpoint tests** — verified at unit level and code review; full traversal/wrong-name HTTP tests not yet executed

### Not Applicable

- OTP / password-reset flow — deliberately removed (contradicts passwordless design)
- Browser capture on this dev box — no camera hardware (hardware wall, not a bug)

### Future Enhancements

- Cancelable biometrics / BioHashing transform on embeddings
- Liveness / anti-deepfake beyond spoken CAPTCHA
- On-device STT to satisfy "no trusted third party"
- Warm long-running Python worker to remove cold model-load cost
- Automated end-to-end test suite

---

## 13. Testing and Validation

| Type | What was done | Result |
|---|---|---|
| **Functional** | Face/voice/CAPTCHA matchers exercised with genuine and impostor inputs | Genuine accept, impostor reject on available dataset |
| **End-to-end** | 6-case login matrix: genuine, wrong captcha, no captcha, different person, tampered template, deleted recording | Genuine 200; all failure cases 401 |
| **Deployment** | Backend on 8099, Mongo in Docker, Python venv, env-driven config | Runs; DB connects |
| **Cloudflare Tunnel** | HTTPS tunnels (`--protocol http2`); diagnosed error 1033 as single-edge-connection uplink flap | Stable with ~20 s reconnect window |
| **Windows (live)** | Real webcam/mic on a Windows laptop over HTTPS | Full three-factor login passed as `kanika1206` |
| **Security verification** | Enroll token (no/expired/session/other-user), tamper test (flipped byte → GCM fail), token-on-failure removed | All closed and verified |
| **Performance** | `measure_performance.mjs`, N=5, per-stage + seq/parallel + storage | Numbers in Section 9; all runs 200 with all factors true |

**Field-debugging lesson recorded:** two of the four field "bugs" during Windows testing were not code bugs — a laptop mic capturing at ~−42 dB and a capture-chain mismatch between enrollment and login. Diagnosed by decrypting the actual uploaded media and measuring it under multiple STT engines before touching code.

---

## 14. Remaining Work

### Implementation

- Full HTTP-level upload endpoint tests (valid / traversal / wrong-name)
- Warm Python worker to remove cold model-load latency
- Automated e2e test suite
- Optional: unify register-page CAPTCHA with the server-side single-use store

### Paper Updates

- Rewrite Algorithm 1 / Fig. 6 to parallel verification
- Rewrite Algorithm 2 (voice) and Fig. 11 (face) to the actual methods
- Update §3.1 storage description (templates, not raw video)
- Correct stated voice threshold (0.30)
- Soften or resolve the "no trusted third party" claim vs Google STT

### Experimental Evaluation

- Multi-user dataset (paper suggests N=50–100 attempts; current perf runs N=5)
- Compute FAR / FRR / EER for both biometric factors
- Communication-overhead figures across representative bandwidths

### Future Research

- Cancelable biometrics / BioHashing
- Liveness / anti-deepfake detection
- On-device speech-to-text

---

## 15. Conclusion

**What has been achieved.** The single-video, three-factor concept of the paper is implemented and works end-to-end: a live three-factor login was completed over HTTPS on a real Windows laptop. All three reviewer comments were addressed on the code side (parallel verification, encrypted template-only storage with integrity, quantified performance), and two additional security defects found during audit (enrollment overwrite, wrong-speaker voice acceptance) were fixed and verified.

**How the implementation evolved.** The system moved from a brittle sequential cascade with a non-voting voice factor, an auth-bypass, and plaintext raw-video storage, to a parallel, fail-closed pipeline over encrypted templates. Each biometric primitive was replaced with a modern, identity-measuring model: pHash → InsightFace for face, MFCC-Euclidean → ECAPA-TDNN for voice, with thresholds derived from measurements rather than assumed.

**Why the current system is stronger than the original implementation.** The AND now genuinely enforces three independent, discriminative factors; failures never leak a token or a factor name; biometrics are stored only as encrypted derived templates with tamper detection; enrollment is bound to an authenticated one-time token; and every login cleans up after itself.

**Original engineering contributions beyond the research paper.** The following go past what the paper specifies: the InsightFace face substitution with a measured separation gap; the ECAPA-TDNN voice substitution with an empirically derived 0.30 threshold; encrypted template-only storage (AES-256-GCM with integrity); the one-time enrollment-token identity binding; the parallelized verification pipeline; the performance-measurement framework; and the Cloudflare-HTTPS deployment used to validate the whole scheme on real hardware.

**Honest limits.** Accuracy claims (FAR/FRR/EER) cannot yet be made — the dataset is two human subjects across four accounts. The paper's figures, algorithms, and the "no trusted third party" claim must be revised before it can truthfully state that the code matches the proposed system. Those are the primary items of remaining work.

---

*Prepared from the project's own code, measurements (`docs/PERFORMANCE.md`), and audit records. Measurements are dev-box figures; biometric accuracy statements are qualified to the available dataset.*
