# Template-Only Biometric Storage

Addresses reviewer comment 2: *"What security mechanisms are used to protect the
biometric information stored on the server? For example, how is a file such as
`username.mp4` protected against unauthorised access, tampering, or theft?"*

The strongest answer to "how is `username.mp4` protected" is **not to have it.**

## What changed

| | Before | After |
| --- | --- | --- |
| Stored at registration | `uploads/videos/<user>.mp4.enc` — the whole video, AES-256-GCM | `templates/<user>.tmpl.enc` — face embedding + ECAPA voice embedding, AES-256-GCM |
| Stored per user | 1.49–1.91 MB of replayable video | ~147 KB of feature vectors |
| Login recording | kept encrypted on disk indefinitely | deleted as soon as the attempt resolves |
| Breach yields | a playable recording of the user's face and voice | vectors that do not reconstruct the recording |

A stolen template is still sensitive — it is a biometric identifier, and it is
still encrypted at rest — but it is not a video of the user that an attacker can
watch, replay to a human, or feed to another system that accepts video.

## What a template contains

`extractTemplate.py` reduces one recording to `templates/<user>.tmpl.enc`, an
AES-256-GCM envelope (`MBENC1` magic + 12-byte IV + 16-byte auth tag) around:

```json
{
  "version": 2,
  "face":  { "embedding": [512 floats], "frames": [[512 floats], ...], "n_frames": 12 },
  "voice": { "embedding": [192 floats], "model": "ecapa-voxceleb", "n_samples": 170667 }
}
```

- **face.embedding** — the mean of the per-frame InsightFace (`buffalo_l`,
  ArcFace) embeddings, L2-normalized, so a dot product against it is a cosine
  similarity.
- **voice.embedding** — a 192-d ECAPA-TDNN speaker embedding (SpeechBrain
  `spkrec-ecapa-voxceleb`), L2-normalized. Matched by cosine similarity ≥ 0.30.
  (This replaced the earlier `voice.mfcc` matrix — see
  [voice-verification.md](voice-verification.md) — because MFCC distance did not
  discriminate speakers. `version` was bumped 1 → 2; there is no MFCC fallback.)

## Face operating point (unchanged); voice operating point (changed)

The **face** template is exactly the intermediate value the old matcher already
computed from the video at every login — `matchFaces.py` averaged the
registration embeddings into a template — so storing and comparing it is the same
arithmetic and the face threshold carried over unchanged:

| Factor | Old (video → video) | New (template → template) |
| --- | --- | --- |
| Face, genuine | 0.6518 | 0.6518 |
| Face, different person | 0.1829 | 0.1829 |

The **voice** factor is a deliberate algorithm change, not a storage-preserving
one: MFCC pairwise distance (threshold 200) was replaced by ECAPA cosine
(threshold 0.30, measured). The operating point moved because the old one was
broken — impostor pairs scored better than genuine pairs. The new separation is
genuine cosine 0.75–1.00 vs real-impostor cosine ≤ 0.256; full study in
[voice-verification.md](voice-verification.md).

## The pipeline now

**Registration** (`POST /upload-video`, contract unchanged): the video arrives in
memory (multer `memoryStorage`), is written only to a temp file, is reduced to
templates, and the temp file is deleted. If no face can be extracted the request
fails **400 with no template stored**, so the account cannot log in until it
re-registers with a usable recording — fail closed.

**Login** (`POST /api/login`, contract unchanged): the stored template and the
fresh login recording are decrypted into a private temp dir. Two branches run
concurrently:

- **biometric** — extract the login template once, then match face and voice
  against the stored template in parallel;
- **CAPTCHA** — extract the audio and transcribe it.

The three verdicts are AND-combined; the JWT is minted only if all three pass.
The temp dir is removed in a `finally`, and the login recording is deleted, so
once an attempt resolves the server holds no media at all.

## Threat model

| Threat | Mitigation |
| --- | --- |
| Theft of stored biometrics | No video is stored. Templates are AES-256-GCM encrypted under a key from `BIOMETRIC_KEY` (never in the repo). |
| Tampering with a stored template | The GCM auth tag fails on any modified byte, so login returns 401 rather than matching against attacker-chosen vectors. Verified by flipping a ciphertext byte. |
| Unauthorised access to media | Nothing is web-accessible: no `express.static` over `templates/`, and no route serves a template. |
| Replay of a stolen recording | The spoken CAPTCHA is single-use, server-side, 5-minute TTL, so a recording of a past login does not authenticate a future one. |
| Interception in transit | HTTPS (Cloudflare tunnel in the deployed setup). |

## Migration

`backend/scripts/migrate_to_templates.mjs` converts existing accounts:

```bash
cd backend
node --env-file=.env scripts/migrate_to_templates.mjs           # dry run
node --env-file=.env scripts/migrate_to_templates.mjs --delete  # delete the raw videos
```

**Deletion is irreversible** — a video cannot be reconstructed from a template.
Back up the `.mp4.enc` files first if the recordings are irreplaceable. All four
existing accounts (`123`, `aditi123`, `kanika1206`, `kanikak_06`) were migrated
and their raw videos deleted; `uploads/videos/` is now empty.

## Known limitations

- **No cancelable biometrics.** The templates are raw feature vectors, not
  BioHashed or salted with a per-user secret, so they are not revocable: a
  breached template cannot be reissued the way a password can. This is the one
  remaining item from the reviewer's storage suggestions. Implementing it means a
  one-way transform per user, and re-enrolling every account.
- **Enrollment quality is not enforced.** A registration video with few usable
  face frames still enrolls a (thin) template. The re-enrolled `kanika1206` yields
  12 usable frames, but a minimum-frame-count guard at enrollment would still be
  sensible for robustness.

### Resolved since this document was first written

- **Voice factor now discriminates speakers.** The old MFCC pairwise-distance
  statistic accepted a different speaker against `kanika1206`'s template (only the
  face factor caught it). It was replaced by an ECAPA-TDNN speaker embedding with
  a measured cosine threshold (0.30). See
  [voice-verification.md](voice-verification.md).
- **Enrollment is authorized, not filename-trusted.** `POST /upload-video` used to
  enroll a template under whatever username the filename carried — anyone reaching
  the endpoint could overwrite an existing user's template. It now requires a
  one-time server-signed enrollment token whose claim, not the filename, is the
  identity. See [enrollment-security.md](enrollment-security.md).
