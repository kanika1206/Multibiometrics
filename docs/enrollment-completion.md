# Registration is not complete until the biometric template is stored

## The defect

Live benchmark data showed 5 of 8 login failures answering `NO_ENROLLMENT`:
accounts that exist in the database but hold no biometric template, so there is
nothing for the face and voice matchers to compare against.

Diagnosis, from the database, the template directory and the server log:

* 19 accounts, 9 templates, **0 orphan template files**. Every template on disk
  is claimed by an account, and every template-less account is genuinely
  template-less. So the HMAC filename derivation, the storage path, the
  identifier used at login and the one used at registration all agree — none of
  the suspected lookup mismatches exist.
* The four accounts that hit `NO_ENROLLMENT` (`kanikak_06`, `ps1456`, `kiran`,
  `priyanshisehra`) are exactly four of the ten template-less accounts.
* For the three created after the benchmark log went live, the server log shows
  the same shape every time:

```
15:02:55  POST /api/register    201 …  6.194 ms
15:03:45  POST /upload-video    - - - - ms        <- no status: the client hung up
```

  versus a successful registration:

```
15:08:09  POST /api/register    201 …  3.003 ms
15:08:42  [enroll palak] …
15:08:42  POST /upload-video    200 27 - 31323.226 ms
```

  No `[enroll …]` line, no response, no template. The enrollment request was
  **aborted**, and the handler that would have rolled the account back never ran.

## The root cause

Registration is two requests — `/api/register` writes the account, `/upload-video`
enrolls the templates — and **only the second one can fail safely**. The account
row was persisted immediately and unconditionally, while the thing that makes an
account usable was written ~30 seconds later by a separate request. The rollback
that existed (`/upload-video` deletes the account when extraction fails) can only
fire inside a request that arrives. When the client aborted mid-enrollment, the
account survived as a permanent half-registration, and the user — who had already
been told "Account created" — believed they were registered.

What made users abort: the registration page gave **no in-flight feedback at
all**. The Register button stayed enabled, nothing said an upload was running,
and the ~30 s extraction looked like a hung page, so people reloaded or navigated
away — which is precisely what destroys the enrollment.

Ruled out by evidence, not assumption: template creation works (9 stored
templates, and two registrations during the same session enrolled and then logged
in successfully); registration is not marked successful on a failed *extraction*
(that path already rolls back); the storage location, the username→filename
derivation and the login-side lookup are identical (0 orphans); nothing deletes
or overwrites templates after registration. Six further template-less accounts
are legacy or abandoned test accounts predating this work.

## The fix

**An account is now created PENDING and confirmed only by the template write.**

* `model/User.model.js` — `enrollmentPending` / `enrolledAt`. Authentication never
  consults them: `hasTemplate()` on disk remains the authority on "is this user
  enrolled". They exist so the server can tell an abandoned registration from a
  complete one.
* `controllers/appController.js` — `/api/register` creates the account with
  `enrollmentPending: true` and answers `"Account created - biometric enrollment
  required"` rather than "User Register Successfully".
* `server.js` — `/upload-video` clears the flag and stamps `enrolledAt` **after**
  the template is stored, never before. It also watches for a client abort: an
  enrollment that completes after the client hung up is kept (the templates are
  stored and the account is usable) and recorded as `CLIENT_ABORTED_AFTER_ENROLLMENT`.
* `enrollmentJanitor.js` — sweeps pending accounts whose enrollment window has
  expired (15 min, against a 10-minute enrollment token) and that hold no
  template, releasing the username and the vault key. Runs at startup and every
  five minutes. It re-checks `hasTemplate()` immediately before each deletion, and
  an account that turns out to hold a template is *un-flagged*, never deleted.
  Accounts predating the flag are never touched.
* `components/Register.js` — the button is disabled for the duration and reads
  "Enrolling your biometrics…", a red notice says not to close or reload the page,
  a `beforeunload` handler asks before the tab is closed, and "Registered
  successfully" is only shown once the server confirms the templates are stored.

## Existing accounts with no enrollment

* **Self-service, and already supported:** registration deliberately releases a
  template-less account when the same username or e-mail registers again, so the
  user simply registers once more with the same details. The login failure now
  says exactly that, and carries `recovery: "REGISTER_AGAIN"` so the login page
  can show a "Register again to complete your biometric enrollment" link.
* **Operator sweep:** `scripts/cleanup_unenrolled.mjs` lists every template-less
  account (dry run by default) and deletes them with `--apply`, re-checking
  `hasTemplate()` per account. Legacy strays are shown, never auto-deleted.

## Verification

A fresh registration and login against the running server:

1. `POST /api/register` → account written with `enrollmentPending: true`, no template.
2. `POST /upload-video` with the enrollment token → `200`, template file written,
   account becomes `enrollmentPending: false` with `enrolledAt` set; one
   `registration/success` benchmark record.
3. `GET /captcha` + `POST /upload-video-login` + `POST /api/login` over HTTP →
   `401` with `reason: "CAPTCHA_MISMATCH"` **only** — i.e. face and voice matched
   the freshly stored template; the recording simply does not speak that
   challenge.
4. The same login driven in-process with the challenge the recording does speak →
   `face=true voice=true captcha=true`, `200`, JWT issued.
5. Janitor: a registration left un-enrolled survived a sweep at the real 15-minute
   grace and was released by a sweep with the window expired; enrolled accounts
   untouched.
