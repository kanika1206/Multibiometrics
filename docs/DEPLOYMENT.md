# Deployment Guide — Multibiometric Authentication System

MERN application with a Python biometric pipeline. The backend spawns Python
scripts (face, voice, speech-to-text) per login, so the deployment host must
provide Node.js, Python 3, ffmpeg, and MongoDB. Camera/microphone capture
happens in the user's browser and requires HTTPS.

---

## 1. Backend

### 1.1 System requirements

| Component | Requirement | Notes |
|---|---|---|
| Node.js | v18+ (developed on v22) | ES modules used |
| Python | 3.10+ | invoked via `PYTHON` env var |
| ffmpeg | any recent build, on PATH | audio extraction (`extractAudio*.py`) |
| MongoDB | real instance for production | in-memory fallback is dev-only, data lost on restart |
| RAM | ≥ 2 GB free | InsightFace buffalo_l model loads per login |
| Disk | ~1 GB | InsightFace models download to `~/.insightface` on first run |
| Outbound HTTPS | required | speechToTexty.py calls Google Speech API (`www.google.com`) |

### 1.2 Install

```bash
cd backend
npm install

# Python environment (any OS)
python3 -m venv .venv               # Windows: python -m venv .venv
.venv/bin/pip install -r requirements.txt   # Windows: .venv\Scripts\pip install -r requirements.txt
```

First login after install downloads InsightFace's buffalo_l model (~300 MB).
To pre-warm, run once manually:
`<venv-python> matchFaces.py <any.mp4> <any.mp4>`

### 1.3 Environment variables (backend)

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | **enforced in production** | Signs session and enrolment tokens — and nothing else; it is not an encryption key for any store. Development falls back to a placeholder constant that is published in the source; **under `NODE_ENV=production` the server refuses to start if it is missing, still set to that placeholder, or shorter than 32 characters.** |
| `NODE_ENV` | **yes (production)** | Set to `production`. It is what turns on the mandatory-secret check below; without it the server starts with development fallbacks. |
| `BIOMETRIC_KEY` | **enforced in production** | AES-256-GCM key for the transient login-video blobs, and the secret behind the HMAC that derives pseudonymous template **file names**. It decrypts **no** biometric template — templates use their owner's per-user key from the vault (see `BIOMETRIC_MASTER_KEY`). **Changing it breaks template file-name resolution.** |
| `BIOMETRIC_VAULT_URI` | **yes (production)** | MongoDB connection string for the **separate biometric key-vault database** (`keyVault.js`). Must point to a *different database* from `ATLAS_URI` — production refuses identical values. Unset = throwaway in-memory vault (enrolments vanish on restart). |
| `BIOMETRIC_MASTER_KEY` | **enforced in production** | Wraps (AES-256-GCM) every **per-user** 256-bit template key before it is stored in the vault; the plaintext per-user keys exist only in memory. Development falls back to a JWT_SECRET-derived key with a warning; **under `NODE_ENV=production` the server refuses to start without it.** **Changing it makes every wrapped per-user key unrecoverable — unwrap under the old value first.** |
| `BIOMETRIC_INDEX_KEY` | **enforced in production** | Secret for the pseudonymous vault lookup index, `userIndex = HMAC-SHA-256(BIOMETRIC_INDEX_KEY, username)`, so the vault stores no usernames. **Changing it orphans every vault row** (lookups derive different indices). Must differ from every other secret. |
| `PII_KEY` | **enforced in production** | AES-256-GCM key for account PII — email, name, mobile, address, avatar (`piiStore.js`). **Set it to a different value from `BIOMETRIC_KEY`**: the separation is the point, so that a leaked template key does not also expose contact details. Development falls back to a JWT_SECRET-derived key with a warning; **under `NODE_ENV=production` the server refuses to start without it.** **Changing it makes existing accounts unreadable** (`GET /api/user/:username` returns 500) — re-key by reading the records under the old key before switching. New deployments must run `node scripts/migrate_pii.mjs --apply` once over any pre-existing accounts. |
| `ATLAS_URI` | **yes (production)** | MongoDB connection string. Unset = throwaway in-memory Mongo (users vanish on restart). |
| `PYTHON` | **yes on Windows / non-repo layouts** | Path to the venv Python interpreter. Default is `../.venv/bin/python` (Linux repo layout). Windows: `<repo>\.venv\Scripts\python.exe`. |
| `PORT` | no | Backend port, default 8080 (dev box uses 8099). |
| `EMAIL`, `PASSWORD` | no (but see note) | Gmail credentials for the registration email. If unset, `/api/registerMail` returns 500 — registration itself still succeeds because the frontend sends the mail request after the user is created. |

Generate strong secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### Mandatory secrets in production

With `NODE_ENV=production`, `backend/config.js` validates the at-rest keys before
anything else loads and **exits (status 1) rather than serving traffic** if any of
these hold:

| Rejected | Why |
|---|---|
| `JWT_SECRET` unset, or left at the development placeholder, or under 32 chars | The placeholder is a constant in the published source: anyone could forge a session token (bypassing authentication) or an enrolment token (re-keying an account). |
| `BIOMETRIC_KEY`, `PII_KEY`, `BIOMETRIC_MASTER_KEY`, or `BIOMETRIC_INDEX_KEY` unset | The key would silently be derived from `JWT_SECRET`, making the at-rest encryption only as strong as the token-signing secret — and deriving *all* from one root, which collapses the separation the keys exist to provide. |
| Any key shorter than 32 characters | A short key is a guessable passphrase, not a key. |
| Any two of the four at-rest keys identical | Same as having one key while believing there are several: a leak of one store's key would also open the others. Checked pairwise. |
| Any key equal to `JWT_SECRET` | Re-creates by hand the coupling the mandatory keys remove. |
| `BIOMETRIC_VAULT_URI == ATLAS_URI` | Collapses the two-database design: the vault must be a separate database from the application data, so no single dump discloses both wrapped keys and account records. |

The failure prints one line per problem and points here. The same check runs for
`scripts/*.mjs`, so a migration cannot be executed against production with the
wrong keys either. Development (no `NODE_ENV=production`) is unaffected and keeps
the warned fallbacks.

Development (no `NODE_ENV=production`) keeps the warned fallbacks unchanged.

#### Key rotation is not automated

There is **no rotation tooling**. Changing a key in place breaks the data it
protects, and the recovery differs per key:

| Key changed | Consequence |
|---|---|
| `BIOMETRIC_KEY` | Template HMAC file names no longer resolve, so every stored template becomes unfindable (their *contents* are unaffected — those are under per-user vault keys). Login videos in flight also fail their GCM tag. Recovery: rename the template files under the old key first, or — if the old key is gone — re-enroll, since the source recordings were destroyed by design. |
| `BIOMETRIC_MASTER_KEY` | Every wrapped per-user key in the vault fails its GCM tag, so no template decrypts. Recovery: unwrap all per-user keys under the old master key and re-wrap under the new one (the per-user keys themselves need not change — the schema's `keyVersion` field exists to support exactly this kind of rotation). |
| `BIOMETRIC_INDEX_KEY` | Every vault lookup derives a different `userIndex`, so all rows are orphaned and **every login fails closed** (there is no fallback key for templates). Recovery: recompute indices under the old key first. |
| `PII_KEY` | Contact fields fail to decrypt (`getUser` → 500) and `emailIdx` no longer matches, so duplicate-registration checking silently stops detecting existing accounts. Recovery: re-encrypt and recompute the index under the old key first. |
| `JWT_SECRET` | Outstanding sessions and enrolment tokens become invalid; holders re-authenticate. No stored data is affected. |

Every case fails **closed** (rejected logins, not admitted ones), but it is an
outage. Plan a re-key window, and keep the retiring key until the migration
completes.

### 1.4 Working directory (critical)

The backend uses **relative paths** (`uploads/videos/`, `uploadsl/login_videos/`,
`./matchFaces.py`). The Node process **must be started with `backend/` as the
current working directory**:

```bash
cd backend && node server.js
```

Running `node backend/server.js` from the repo root will break uploads and the
Python pipeline. In systemd/PM2, set `WorkingDirectory`/`cwd` to the backend
folder.

Both upload directories must exist before the first upload:

```bash
mkdir -p uploads/videos uploadsl/login_videos
```

### 1.5 Process manager example (PM2)

```bash
cd backend
NODE_ENV=production PORT=8099 JWT_SECRET=... \
  BIOMETRIC_KEY=... PII_KEY=... \
  BIOMETRIC_MASTER_KEY=... BIOMETRIC_INDEX_KEY=... \
  ATLAS_URI=mongodb://.../app BIOMETRIC_VAULT_URI=mongodb://.../keyvault \
  PYTHON=/full/path/.venv/bin/python \
  pm2 start server.js --name biometric-backend
# every secret above must be a DIFFERENT value; the two URIs must be
# DIFFERENT databases — production refuses to start otherwise.
```

(nodemon in `npm start` is a dev tool; use `node server.js` in production.)

---

## 2. Frontend

### 2.1 Environment variable

`frontend/.env` (baked in at **build time** — rebuild after changing):

```
REACT_APP_SERVER_DOMAIN=https://your-backend-domain.example.com
```

Must be the public **HTTPS** URL of the backend, no trailing slash.

### 2.2 Build and serve

```bash
cd frontend
npm install
npm run build        # outputs frontend/build/
```

Serve `build/` from any static host or reverse proxy. Because the app uses
client-side routing (react-router), configure the server to fall back to
`index.html` for unknown paths.

---

## 3. HTTPS and domain configuration

**HTTPS is mandatory.** Browsers only expose `getUserMedia` (camera +
microphone) in a secure context. On a plain `http://` link the recording
buttons will sit in `idle` forever and users will never get a permission
prompt. `localhost` is the only HTTP exception.

Typical setup — one domain, nginx in front:

```
https://app.example.com/          -> frontend/build (static)
https://app.example.com/api/...   -> proxy to backend
https://app.example.com/captcha   -> proxy to backend
https://app.example.com/upload-video        -> proxy to backend
https://app.example.com/upload-video-login  -> proxy to backend
```

With this layout set `REACT_APP_SERVER_DOMAIN=https://app.example.com`.
Get certificates with Let's Encrypt (`certbot --nginx`).

Reverse-proxy upload limit: video uploads can be tens of MB. For nginx set
`client_max_body_size 120m;` (backend multer limit is 100 MB).

If frontend and backend are on **different** domains, CORS is already open
(`app.use(cors())`), but both must be HTTPS or the browser blocks mixed content.

### Camera and microphone permissions

- The browser prompts on first `getUserMedia` call; the user must click Allow.
- If permission was denied earlier, it must be re-enabled via the padlock icon
  in the address bar (Chrome/Edge) — the site cannot re-prompt.
- Windows itself can block camera/mic per-app: Settings → Privacy & security →
  Camera / Microphone → allow desktop apps and the browser.

---

## 4. MongoDB

Production options:

- **MongoDB Atlas** (managed): create a cluster, allow the backend host's IP,
  set `ATLAS_URI=mongodb+srv://user:pass@cluster.../<db>`.
- **Self-hosted / Docker**: `docker run -d -p 27017:27017 --name mongo -v mongodata:/data/db mongo:6`,
  then `ATLAS_URI=mongodb://localhost:27017/multibiometric`.

Without `ATLAS_URI` the server silently uses an in-memory database — fine for
demos, unacceptable for real deployment (all users lost on restart; the
encrypted videos on disk would orphan).

---

## 5. Known platform notes

| Concern | Status |
|---|---|
| Python invocation | Portable via `PYTHON` env var; default only works on Linux repo layout. On Windows set `PYTHON=<repo>\.venv\Scripts\python.exe`. |
| ffmpeg | Called as bare `ffmpeg` from Python — must be on PATH on every OS. Windows: install from ffmpeg.org or `winget install ffmpeg`, then reopen the shell. |
| File paths in JS | `path.join` / forward-slash relative paths; Node normalizes on Windows. No hardcoded absolute paths found. |
| Temp files | `os.tmpdir()` + `fs.mkdtempSync` (Node), `tempfile.mkstemp` (Python) — portable, cleaned in `finally`. |
| Browser recording format | `react-media-recorder` produces WebM (VP8/Opus) in Chrome/Firefox even though files are named `.mp4`. OpenCV and ffmpeg detect the container by content, not extension, so the pipeline handles it. **iOS Safari records MP4/H.264 — untested; test one iPhone login before claiming mobile support.** |
| `backend/transcript.wav` | Legacy artifact of the old shared-file speech flow; no longer read or written. Safe to delete. |

---

## 6. Google Speech API dependency

`speechToTexty.py` uses the free `recognize_google` endpoint over HTTPS. This
is an unofficial API: it needs outbound internet from the backend host and can
be rate-limited. If the deployment environment blocks outbound traffic to
`www.google.com`, the CAPTCHA factor will always fail (fail-closed) and no
login can succeed.
