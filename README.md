# Multibiometric Authentication

Implementation of "Secure User Authentication Scheme Using Multimodal Biometrics"
(Rajput & Varshney, IIT Jammu): passwordless login from a **single webcam video**
that carries three factors — **face**, **voice**, and a **spoken CAPTCHA** —
combined with strict AND logic. A JWT is issued only when all three pass.

## Architecture

- **Frontend** (React, `frontend/`): records one video (`react-media-recorder`),
  uploads it, and displays a server-issued CAPTCHA (SVG only — the text never
  leaves the server).
- **Backend** (Express, `backend/`): reduces the registration video to encrypted
  biometric **templates** (`templateStore.js`), orchestrates the Python
  verification pipeline, and issues the JWT.
- **Enrollment** (registration): `extractTemplate.py` turns the video into a
  512-d InsightFace face embedding plus a 192-d ECAPA-TDNN voice embedding. Only
  those are encrypted and kept (`templates/<user>.tmpl.enc`); **the video itself
  is deleted.** No recording of any user is stored on the server. The upload is
  authorized by a one-time enrollment token, not the filename
  (`docs/enrollment-security.md`).
- **Verification pipeline** (Python, spawned by `controllers/appController.js`;
  the biometric and CAPTCHA branches run concurrently):
  - `extractTemplate.py` — reduces the login recording to the same templates.
  - `matchFaceTemplate.py` — face factor: cosine similarity against the enrolled
    embedding (threshold 0.35).
  - `matchVoiceTemplate.py` — voice factor: cosine similarity between ECAPA-TDNN
    speaker embeddings (threshold 0.30, measured). Replaced the non-discriminative MFCC
    distance; see `docs/voice-verification.md`.
  - `extractAudio_login.py` + `speechToTexty.py` — CAPTCHA factor: Google Speech
    transcription (over HTTPS); the transcript is compared against the
    server-stored CAPTCHA (`captchaStore.js`, single-use, 5-minute TTL).

  Every stage reports pass/fail through its **exit code**; stdout is data only.

## Security properties

- Token minted only on face AND voice AND CAPTCHA success; all failures return
  a generic 401 (per-factor detail goes to the server log only).
- **No raw biometric media is retained.** Registration stores only encrypted
  templates; the login recording is transient and deleted once the attempt
  resolves. A server breach yields feature vectors, not playable video.
- Templates are encrypted at rest (AES-256-GCM, `*.tmpl.enc`; the GCM auth tag
  doubles as the integrity/tamper check). At login they are decrypted into a
  private temp directory that is removed afterwards.
- Upload filenames are validated against a strict pattern; usernames are
  validated before they reach any filesystem path.
- **Enrollment is authorized, not filename-trusted.** `/upload-video` requires a
  one-time, server-signed enrollment token issued by `/api/register`; the enrolled
  identity comes from the token, so no client can overwrite another user's
  templates (`docs/enrollment-security.md`).
- Passwordless by design: no password field, no recovery flow.

## Deviations from the paper (documented enhancements)

1. **Face matching**: the paper specifies whole-frame pHash + Hamming distance
   (threshold 25). That algorithm false-rejects a genuine user on this repo's
   own recordings and measures the scene rather than the face. It was replaced
   with face-embedding comparison. Full measurements and the original scripts:
   `backend/paper_reference/`.
2. **Voice matching**: the paper's MFCC-distance statistic is not
   speaker-discriminative (impostor pairs scored better than genuine pairs, so no
   threshold separates speakers — it was accepting the wrong speaker). Replaced
   with an ECAPA-TDNN speaker embedding + cosine similarity, the same kind of
   substitution as the face factor. Measurements and rationale:
   `docs/voice-verification.md`.
3. **Parallel verification**: the paper cascades the factors; here they run
   concurrently and are AND-combined at the end (addresses reviewer comment on
   sequential processing). Measured speedup and per-stage timings:
   `docs/PERFORMANCE.md`.
4. **Template-only storage**: the paper stores `username.mp4` and re-derives
   features from it at every login. Here registration extracts the templates
   once, encrypts them, and destroys the video (addresses the reviewer comment on
   protecting stored biometric data). Rationale, threat model and the migration
   path: `docs/TEMPLATE_STORAGE.md`.
5. **Authorized enrollment**: `/upload-video` used to trust the uploaded filename
   for identity and required no authentication, allowing account takeover by
   overwriting another user's templates. Enrollment is now bound to a one-time
   server-signed token. Attack path and verification: `docs/enrollment-security.md`.

## Running locally

```bash
# MongoDB (any instance; Docker example)
docker run -d --name multibio-mongo -p 27017:27017 mongo:7

# Python venv at repo root
python3 -m venv .venv
.venv/bin/pip install opencv-python imagehash librosa SpeechRecognition Pillow \
  numpy insightface onnxruntime pydub scikit-learn

# backend/config.js is gitignored — create it to read process.env (see repo docs),
# then:
cd backend && npm install
ATLAS_URI=mongodb://localhost:27017/multibio PORT=8099 \
  BIOMETRIC_KEY=<random-secret> JWT_SECRET=<random-secret> node server.js

# frontend/.env: REACT_APP_SERVER_DOMAIN=http://localhost:8099
cd frontend && npm install && npm start
```

`ffmpeg` must be on PATH. Existing plaintext enrollments can be migrated with
`node scripts/encrypt_existing.mjs --backup-dir <dir>` (run from `backend/`).

## Repository notes

- `backend/paper_reference/` — the paper's original pHash pipeline, kept for
  research reproducibility; not wired into the app.
- `backend/uploadsl/login_videos/imposter_l.mp4` — impostor test fixture.
- Performance and accuracy measurements: `docs/PERFORMANCE.md`.
