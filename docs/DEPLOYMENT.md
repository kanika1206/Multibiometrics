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
| `JWT_SECRET` | **yes (production)** | JWT signing key. Falls back to an insecure dev default. |
| `BIOMETRIC_KEY` | **yes (production)** | AES-256-GCM key for stored videos. Falls back to JWT_SECRET-derived key with a warning. **Changing it makes previously stored videos undecryptable — every user must re-register.** |
| `ATLAS_URI` | **yes (production)** | MongoDB connection string. Unset = throwaway in-memory Mongo (users vanish on restart). |
| `PYTHON` | **yes on Windows / non-repo layouts** | Path to the venv Python interpreter. Default is `../.venv/bin/python` (Linux repo layout). Windows: `<repo>\.venv\Scripts\python.exe`. |
| `PORT` | no | Backend port, default 8080 (dev box uses 8099). |
| `EMAIL`, `PASSWORD` | no (but see note) | Gmail credentials for the registration email. If unset, `/api/registerMail` returns 500 — registration itself still succeeds because the frontend sends the mail request after the user is created. |

Generate strong secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

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
PORT=8099 JWT_SECRET=... BIOMETRIC_KEY=... ATLAS_URI=... PYTHON=/full/path/.venv/bin/python \
  pm2 start server.js --name biometric-backend
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
