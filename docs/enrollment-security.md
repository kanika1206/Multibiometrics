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
  created. `/api/register` rejects duplicate usernames, so a token can be minted
  **only for a brand-new account** — never for one that already has templates.
- `POST /upload-video` now requires `Authorization: Bearer <enrollToken>`, verifies
  it, checks `purpose === "enroll"`, and takes the username from the **verified
  token claim**. The filename is still pattern-validated but is no longer trusted
  for identity.

Consequences:

- An unauthenticated upload is rejected (401).
- A token issued for account A can only ever write `templates/A.tmpl.enc`;
  pointing its filename at `victim.mp4` does nothing — the filename is ignored.
- Because no enroll token exists for an already-enrolled account, **no client can
  overwrite another user's templates**.
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
  `JWT_SECRET` (and `BIOMETRIC_KEY`) in production — the dev fallback logs a
  warning.
- There is no rate limit on `/api/register`, so an attacker can still create their
  *own* accounts freely. That is account creation, not takeover, and is out of
  scope for this fix.
