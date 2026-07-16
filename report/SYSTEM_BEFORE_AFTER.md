# Multibiometric Authentication — System Report

**What this document is:** a factor-by-factor account of the system as it was originally implemented, and as it stands now, with the evidence behind each change.

**Reference paper:** `Research_paper.pdf` — *Secure User Authentication Scheme Using Multimodal Biometrics* (Rajput & Varshney, IIT Jammu).

**Scope note:** every measurement below was taken on the project's own recordings — a small dataset (two accounts of one person, one impostor, plus live Windows-laptop sessions). The results support the changes, but they are not a broad accuracy evaluation across many subjects. Nothing here should be read as "fully verified".

---

## 1. The scheme, unchanged

Both the original and the current system implement the same idea, and this did not change:

A user records **one webcam video**. That single video carries **three credentials at once** — their **face** (video frames), their **voice** (audio timbre), and a **spoken CAPTCHA** (the words they say). The server checks all three and grants a token only if all three agree. No password.

What changed is that in the original code, this scheme was described but not actually enforced. Now it is.

---

## 2. The original system

### Face
Frames were extracted from the registration and login videos, then compared with **perceptual hashing (pHash) + Hamming distance** over whole frames, accepting below a distance of 25.

### Voice
`matchAudio.py` computed MFCC distances between registration and login audio — but the check was written `distances.all` instead of `distances.all()`. In Python, `.all` without parentheses is a bound method object, which is always truthy. **The voice check could not fail.** Any voice, including an impostor's, passed.

### Spoken CAPTCHA
Not implemented as a login factor. The CAPTCHA text lived on the client side.

### Combination logic
The paper's AND logic was not enforced. Worse, the **failure branch of login signed and returned a valid 24-hour JWT** alongside its error response — so a rejected login still handed the caller a working token.

### Storage
Registration and login videos were written to disk as **plaintext MP4** files. The upload endpoint accepted a **client-supplied file path**, which was passed to `spawn`.

### Passwords
The paper claims a passwordless scheme, but the schema, login, register, and frontend all still carried a password field.

### Summary of the original security posture
The system had three factors on paper. In practice one factor (voice) could never reject anyone, one factor (CAPTCHA) did not exist server-side, the AND was not enforced, and the failure path issued a token anyway.

---

## 3. The system now

### Face — replaced primitive, evidence-backed
`backend/matchFaces.py` uses **InsightFace `buffalo_l` (ArcFace) face embeddings with cosine similarity, threshold 0.35**.

The paper's pHash was not merely swapped for convenience — it was measured and found to fail:

| pair | pHash Hamming | paper's verdict (threshold 25) | correct? |
|---|---|---|---|
| genuine 123 vs 123_l | 26.0 | reject | **false reject** |
| genuine aditi vs aditi_l | 22.0 | accept | ok |
| impostor 123 vs impostor | 32.0 | reject | ok |
| impostor aditi vs impostor | 30.0 | reject | ok |

Genuine users top out at 26 and impostors start at 30 — a four-bit margin, with a legitimate user already falling on the wrong side of the paper's own threshold. There is also a deeper problem: **pHash hashes the entire frame**, including background, lighting, and clothing. The impostor video was shot in a different room, so much of that 30–32 distance is the room, not the person — which implies pHash would likely accept an impostor sitting in the *same* room, the exact attack the scheme must resist.

Under InsightFace the same four pairs score genuine **0.73 / 0.62** and impostor **0.22 / 0.18** — all four correct, with a wide empty gap around the threshold. In live Windows testing, genuine similarity ran **0.81–0.86**.

The paper's original pHash pipeline is preserved unmodified in `backend/paper_reference/` for reproducibility; it is not wired into the live path.

### Voice — the always-pass bug is gone
The `.all` bug is fixed. Note that fixing it *literally* to `.all()` would have false-rejected everyone: the genuine maximum pairwise MFCC distance is 329–454, well over the threshold of 200. The correct statistic is the **mean** pairwise MFCC distance at the paper's threshold of 200 — genuine pairs score **108 / 169** (pass), impostor pairs **341 / 268** (reject).

The script now signals its verdict through **exit codes**, not printed text.

### Spoken CAPTCHA — now a real server-side factor
- `GET /captcha?username=` issues an SVG CAPTCHA and stores the text in `backend/captchaStore.js`: **server-side, single-use, five-minute TTL**. The text is never sent to the client.
- At login, `speechToTexty.py` transcribes the spoken audio over HTTPS and the server compares the normalized transcript against the stored text.
- CAPTCHAs are **digits only**. Random letter strings are effectively unspeakable — speech-to-text returned "speech unintelligible" for them. Digits transcribe reliably, and `normalizeCaptcha` maps spoken digit words and homophones ("nine", "oh", "to"/"for"/"ate") to numerals.
- Because speech-to-text's top guess for spoken digits is often a sound-alike word ("sexy" for "six five"), the transcriber returns **all candidate alternatives** and the factor passes if any candidate matches. The match is still exact against the single-use server-side code, so this costs no security.

### AND logic — enforced
`login` in `appController.js` was rewritten with async/await. Face matching runs **in parallel** with the audio branch (extract audio → voice matching ∥ speech transcription). A token is minted **only if `faceOk && voiceOk && captchaOk`**. Otherwise 401.

The response **never reveals which factor failed** — only the server log does. Each stage has a 120-second timeout, and any error fails closed.

The auth-bypass is gone: the failure branch no longer signs a token.

### Storage — encrypted at rest
Videos are now stored as **AES-256-GCM ciphertext** (`backend/secureStore.js`) — `uploads/videos/<user>.mp4.enc` and `uploadsl/login_videos/<user>_l.mp4.enc`. Uploads go through multer **memoryStorage** with a strict filename regex, so **plaintext biometric media never touches disk**. Login decrypts into a temporary directory that is removed in a `finally` block.

The server now owns the upload directories; client-supplied filesystem paths no longer reach `spawn`.

Tampering is detected: flipping a single byte of a stored video causes the GCM authentication tag to fail, and login returns 401.

### Passwords — removed
Removed from the schema, login, register, and frontend, matching the paper's passwordless claim. The OTP / password-reset flow was deleted end to end.

---

## 4. What was verified, and how

**Six-case login matrix** (run against the encrypted store):

| case | result |
|---|---|
| genuine video + correct spoken CAPTCHA | 200 + token |
| wrong spoken CAPTCHA | 401 |
| no CAPTCHA issued | 401 |
| impostor video (all three factors false) | 401 |
| expired / reused CAPTCHA | 401 |
| tampered ciphertext (one byte flipped) | 401 |

**Live deployment testing** (HTTPS via Cloudflare tunnel, Windows laptop, real webcam and microphone): a **complete three-factor login now passes end-to-end** — face, voice, and spoken CAPTCHA all green in a single attempt, as user `kanika1206`.

Reaching that point required diagnosing five real defects in the field, each found from the server's per-factor log line. Two of the five were **not code bugs at all**:

- The laptop microphone was capturing at a mean of **−42 dB** (usable speech sits around −20 dB). This was proven by decrypting the actual uploaded login video and running it through three independent speech engines — all failed on the same file. Fixed in Windows sound settings, not in code.
- After the microphone was fixed, the **voice factor started failing** because the registration template had been recorded on the *broken* microphone and the login audio on the *fixed* one. Two different capture chains push the MFCC distance past the threshold. Re-registering on the fixed microphone resolved it. **MFCC voice matching is sensitive to the capture chain — a hardware or driver change invalidates existing voice templates.**

---

## 5. Deviations from the paper, stated plainly

1. **Face matching uses InsightFace embeddings, not the paper's pHash + Hamming.** Justified by the false-reject measured above and by pHash hashing the background rather than the face. The scheme's architecture — one video, three factors, AND logic — is unchanged; only the face-matching primitive is swapped. The paper's algorithm is preserved in `backend/paper_reference/`.
2. **The voice threshold is applied to the mean pairwise MFCC distance, not the maximum.** The paper's threshold of 200 is kept; applying it to the maximum would reject every genuine user.
3. **CAPTCHAs are digits only,** because letter strings are not reliably speakable through speech-to-text.

---

## 6. Known limitations and open work

- The accuracy figures come from a **small dataset** (one person across two accounts, one impostor, plus live sessions). Broader multi-person validation is still needed before any accuracy claim is published.
- Speech-to-text accuracy is the weakest link in the pipeline; it depends on microphone quality and on a free cloud API.
- Voice templates are tied to the capture hardware (see above).
- End-to-end and per-stage timing numbers have **not yet been collected** — `scripts/measure_performance.mjs` is written but has not been run, and `docs/PERFORMANCE.md` does not exist yet.
- HTTP-level upload endpoint tests (valid / path-traversal / wrong-name) have been reviewed and unit-tested at the `encryptToFile` level, but not yet exercised over HTTP.
- The registration page still uses a client-side CAPTCHA (`react-simple-captcha`), a different mechanism from the server-side login CAPTCHA.

---

## 7. The change in one line

The original system claimed three factors but could only ever reject on one of them, and issued a valid token even when it rejected you. The current system actually runs all three, gates on all three together, stores the biometric media encrypted, and has now been observed passing a genuine login and rejecting an impostor on real hardware.
