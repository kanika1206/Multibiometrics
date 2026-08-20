# Enrollment authorization — closing the account-overwrite hole

## The vulnerability (Critical)

Registration is two requests: `POST /api/register` creates the account row, and
`POST /upload-video` reduces a recording to encrypted biometric templates stored
at `templates/<username>.tmpl.enc`. Login later decrypts that template as the
reference the face and voice factors are matched against.

The old `/upload-video`:

- required **no authentication**, and
- took the enrolled username from the uploaded **file name**
  (`username.mp4` -> `templates/username.tmpl.enc`).

### Attack path

1. Attacker records themselves reading any CAPTCHA.
2. Attacker `POST`s that video to `/upload-video` with the filename
   `victim.mp4` (the victim being any existing account).
3. The server overwrites `templates/victim.tmpl.enc` with the **attacker's** face
   and voice embeddings.
4. Attacker logs in as `victim`: face + voice now match the attacker, and the
   CAPTCHA factor is satisfied by the attacker reading the live challenge.

The victim's account is taken over. No credential was ever checked — the filename,
which is fully attacker-controlled, was treated as the identity.

## The fix

Identity is bound to a **server-signed enrollment token**, never to the filename.

- `enrollToken.js` issues a JWT `{ username, purpose: "enroll" }` with a 10-minute
  TTL, signed with the server's `JWT_SECRET`.
- `POST /api/register` returns this token **once**, at the moment the account is
  created. `/api/register` rejects any username or email held by an **enrolled**
  account, so a token can never be minted against an existing enrollment.
- `POST /upload-video` now requires `Authorization: Bearer <enrollToken>`, verifies
  it, checks `purpose === "enroll"`, and takes the username from the **verified
  token claim**. The filename is still pattern-validated but is no longer trusted
  for identity.

Consequences:

- An unauthenticated upload is rejected (401).
- A token issued for account A can only ever write `templates/A.tmpl.enc`;
  pointing its filename at `victim.mp4` does nothing — the filename is ignored.
- Because no enroll token exists for an already-enrolled account, **no client can
  overwrite another user's templates**. `/upload-video` enforces this a second
  time on its own: it refuses outright if a template already exists for the
  username in the token, so an enrollment is final even if a token for it ever
  did leak.

## Half-finished registrations

Registration is two requests (`/api/register`, then `/upload-video`), so it can
stop in between — the tab is closed, the camera fails, the recording has no
usable face. That used to leave an account with **no template**: it could never
log in (nothing to match against) and never enroll (its token expires after 10
minutes), yet it held its username and email forever.

Such an account is inert, so it is not treated as a conflict:

- A failed extraction **rolls the account back** (`/upload-video` deletes it),
  releasing the identifier immediately.
- Registration **releases an abandoned account** — one whose username or email is
  held by a record with no template — instead of rejecting the request. Taking
  over an unenrolled identifier is indistinguishable from registering an unused
  one: no biometric reference was ever bound to it.
- Every deletion is gated on `hasTemplate()`, so an **enrolled** account is never
  released. That would be the takeover this document is about.
- `/upload-video` also rejects a token whose account no longer exists (409), so a
  stale token from a rolled-back registration cannot write a template that no
  account owns.
- A stolen **session/login** JWT does not work either: `purpose` must be
  `"enroll"`, so a normal login token cannot be used to re-key an account.

The registration flow order changed to match (frontend `Register.js`): create the
account first, receive the token, then upload. A failed upload can be retried with
the same token (kept in a ref) without creating a second account; the account
exists but cannot log in until a recording is enrolled.

### API contract

- `POST /api/register` response gains an `enrollToken` field; `msg` is unchanged.
- `POST /upload-video` now requires the `Authorization` header. Request body
  (multipart `video`) and success body (`"Video uploaded successfully"`) are
  unchanged. `/upload-video-login`, `/captcha`, and all `/api/*` routes are
  untouched.

## Verification

Run against the live server (`imposter_l.mp4` used as the recording):

| step | request | result |
|------|---------|--------|
| genuine register | `POST /api/register` (new user) | 201 + `enrollToken` |
| genuine upload | `POST /upload-video` with token | 200, template written |
| **attack: no token** | `POST /upload-video` filename `victim.mp4` | **401** |
| **attack: session JWT** | token with `purpose:"login"` | **401** |
| **attack: expired token** | `expiresIn: -10` | **401** |
| **attack: other user's token** | attacker1 token, filename `victim.mp4` | 200 but writes `attacker1.tmpl.enc`; **victim template sha256 unchanged** |

The victim template's hash was byte-identical before and after all attack
attempts.

## Remaining limitations

- The enrollment token, like the session token, is a bearer JWT signed with
  `JWT_SECRET`; if that secret leaks an attacker could forge either. Set a strong
  `JWT_SECRET` in production, along with the other mandatory secrets
  (`BIOMETRIC_KEY`, `PII_KEY`, `BIOMETRIC_MASTER_KEY`, `BIOMETRIC_INDEX_KEY`) —
  all five must differ, and production refuses to start otherwise. The dev
  fallback logs a warning. See [DEPLOYMENT.md](DEPLOYMENT.md) §1.3.
- There is no rate limit on `/api/register`, so an attacker can still create their
  *own* accounts freely. That is account creation, not takeover, and is out of
  scope for this fix.

## Update (2026-07-20): login-upload binding and duplicate-enrolment guard

Two further issues were found during a pre-submission audit and fixed.

### `/upload-video-login` was unauthenticated

Anyone could POST a recording named `<victim>_l.mp4` and overwrite the recording a
victim was about to submit. This was never account takeover — the three factors
still gate the decision — but it is an unauthenticated write against another user's
pending attempt.

The endpoint cannot require a session token, because logging in is precisely what
the caller has not done yet. It is instead bound to a *live login attempt*: the
username must have an issued, unexpired CAPTCHA (`hasLiveCaptcha`, `captchaStore.js`).
The challenge is checked here but never consumed — `/api/login` spends it. An upload
with no active challenge is rejected with 401.

### `reenroll_ecapa.mjs` could enrol one recording into many accounts

Its original signature took one video and a list of usernames. Run that way, every
named account receives a byte-identical template and those accounts authenticate as
one another. This had already happened: four accounts (`123`, `aditi123`,
`kanika1206`, `kanikak_06`) shared a single template, verified by SHA-256 of the
decrypted plaintext and by pairwise cosine of 1.0000 on both modalities.

Multi-username runs now abort unless `--allow-shared-recording` is passed explicitly.
The three redundant copies were moved to `backend/templates_removed_duplicates/`,
leaving one canonical template per distinct recording. Those three accounts now have
no enrolment and must re-register before they can log in, which is the correct
fail-closed outcome.
