# Windows End-to-End Testing Plan

Scenario: application deployed behind an HTTPS URL; tester opens it in
Chrome/Edge on a Windows laptop with webcam and microphone.

## 0. Pre-flight

- [ ] Deployed URL loads over `https://` (padlock, no certificate warning)
- [ ] Windows Settings → Privacy & security → Camera and Microphone: access on for the browser
- [ ] Backend log shows "Database Connected" and "Server connected"
- [ ] `GET https://<backend>/` returns `"Home GET Request"` (backend reachable)

## 1. Positive flow

### Registration
- [ ] Open `/register`, enter unique email + username (letters/digits/`_`/`-` only — other characters are rejected at upload)
- [ ] Click **Start Recording** → browser prompts for camera + microphone → Allow
- [ ] Live camera preview appears while recording (status "recording")
- [ ] Read the on-page CAPTCHA aloud during recording (registration CAPTCHA is a liveness aid; the login CAPTCHA is the verified one)
- [ ] Click **Stop Recording** → recorded video plays back with audio
- [ ] Click **Register** → "Register Succesfully" toast, redirect to login page
- [ ] Backend: `uploads/videos/<username>.mp4.enc` exists (encrypted, starts with `MBENC1`)
- [ ] If EMAIL/PASSWORD configured: welcome email arrives

### Login (all three factors genuine)
- [ ] Enter username → biometric login page loads, greeting shows username
- [ ] CAPTCHA image (SVG) is displayed — text is NOT visible in the network response (check DevTools: `/captcha` returns only `svg`)
- [ ] Record video: same face, same voice, read the displayed CAPTCHA aloud clearly
- [ ] Submit within 5 minutes of the CAPTCHA appearing (server TTL)
- [ ] "Login Successfully" toast → redirected to `/profile`
- [ ] Backend log line: `login <user>: face=true voice=true captcha=true`

### Session
- [ ] `localStorage.token` contains a JWT (DevTools → Application)
- [ ] Profile page shows user data
- [ ] Profile update (PUT /api/updateuser) succeeds with the token
- [ ] Logout clears the token; profile route no longer accessible

## 2. Negative tests

Each must return **401 "Login UnSuccessful"** and the response must NOT say
which factor failed (check the JSON body). Backend log shows the factor detail.

- [ ] **Wrong face**: another person records the login video, reads CAPTCHA correctly → log `face=false`
- [ ] **Wrong voice**: different speaker reads the CAPTCHA → log `voice=false`
- [ ] **Wrong CAPTCHA**: genuine user reads wrong characters aloud → log `captcha=false`
- [ ] **Silent video**: genuine user records without speaking → captcha=false (no transcript)
- [ ] **Expired CAPTCHA**: fetch login page, wait >5 minutes, then submit → log "(no captcha issued/expired)"
- [ ] **Replay CAPTCHA**: after one login attempt (success or fail), immediately retry without reloading the page → fails (single-use)

## 3. Upload/API attack tests (curl or DevTools)

- [ ] **Invalid filename**: `curl -F "video=@x.mp4;filename=../../evil.mp4" https://<backend>/upload-video` → 400 "Invalid file name"
- [ ] **Bad extension**: filename `user.exe` → 400
- [ ] **Tampered upload**: flip one byte in `uploads/videos/<user>.mp4.enc` on the server, attempt login → 401 (GCM auth failure, log "video decrypt failed")
- [ ] **Missing video**: register a user via `POST /api/register` directly (no upload), attempt login → 401 (decrypt failure on missing file)
- [ ] **Missing file field**: `POST /upload-video` with no file → 400 "Please upload a video file"
- [ ] **Expired/forged token**: call `PUT /api/updateuser` with no token, a garbage token, and a token signed with a wrong secret → all 401 "Authentication Failed!"
- [ ] **Unknown username login**: `POST /api/login {"username":"nosuchuser"}` → 404

## 4. Cleanup checks (server-side, after the test run)

- [ ] No `bio-*` directories left in the OS temp dir (decrypted copies removed even on failed logins)
- [ ] No plaintext `.mp4` files in `uploads/videos/` or `uploadsl/login_videos/` (only `.enc`; `imposter_l.mp4` is a local test fixture — remove before deploy)
- [ ] Backend memory stable across ~10 logins (no runaway growth)

## Expected timing

A login runs face matching + 2× audio extraction + voice matching +
speech-to-text. On CPU-only hosts expect roughly 15–60 s per login attempt;
the per-stage timeout is 120 s, after which the stage is killed and the login
fails closed.
