# Runbook — evaluation recording day

Operational checklist for collecting the **own consented recordings** used for
cross-session accuracy and attack evaluation. The accuracy corpus from a public
dataset (CREMA-D) and the analysis of deployed templates are covered in
[EVALUATION.md](EVALUATION.md); attacks in [ATTACKS.md](ATTACKS.md).

Everything here uses the normal application with `EVAL_CAPTURE` switched on.
Nothing changes for production: with the flag off, recordings are reduced to
encrypted templates and deleted exactly as before.

## 0. Before the day

- **Consent.** Printed/online consent form per volunteer stating that raw video
  and audio of face and voice will be retained, for which study, where, for how
  long, and how to withdraw. The in-app checkbox is a second, per-recording
  consent; it does not replace the form.
- **Participant sheet (kept OFF the capture machine's `eval_data/`).** Columns:
  participant id (P01, P02, …), username they will register, session 1 date/time,
  session 2 date/time, device used per login. `eval_data/` file names are keyed
  hashes of the username, so this sheet is the only participant↔file mapping.
- **Accounts.** Each volunteer uses **one fresh account** created on the day.
  Never let a volunteer log in to someone else's account during capture — the
  clip is named after the account, not the person in it.
- **Devices.** At least two where possible: the laptop webcam and the
  volunteer's own phone. The phone must reach the app over HTTPS (camera access
  requires it) — use the public URL from [PERMANENT_URL.md](PERMANENT_URL.md).
- **Room.** Reasonable, even lighting; one face in frame; quiet enough that the
  five spoken digits are intelligible.

## 1. Start the server in capture mode

The normal service must be stopped first so only one backend owns port 8099.

```bash
systemctl --user stop multibio-backend
cd ~/Multibiometric_Code/backend
EVAL_CAPTURE=1 EVAL_SESSION=1 node server.js
```

Check the startup line:

```
[eval-capture] ENABLED — plaintext recordings will be written to ../eval_data (session 1) ...
```

and that `GET /eval-status` returns `{"evalCapture":true}`. The registration and
login pages now show the red **"Research evaluation mode is active"** notice and
the consent checkbox (unchecked by default).

`EVAL_SESSION` is the recording-day session number and is written into every
clip name. It is **per run of the server**, so restart with the next number for
the next session. Unset, numbering falls back to one session per upload, which
does not fit this protocol.

## 2. Session 1 (EVAL_SESSION=1)

For each volunteer:

1. **Register** (laptop webcam), ticking the consent box.
   → `eval_data/<subject>_s1__enroll.mp4`
2. **Genuine logins: at least 2, ideally 3–5**, ticking the consent box each
   time. Each login shows a new five-digit challenge; the volunteer reads it
   aloud while facing the camera.
   → `eval_data/<subject>_s1__<code>.mp4`
3. **Second device**, if available: at least 2 further logins from the phone in
   the same session. Note the device of every login on the participant sheet.

A failed login is still captured (it is captured on upload, before matching).
Keep it: it is a genuine attempt and belongs in the FRR. Do not relabel it.

## 3. Session 2 (EVAL_SESSION=2)

- **Ideally on a different day.** If that is impossible, at least **2 hours
  after** session 1, preferably after a change of room, lighting or clothing.
  Same-sitting repeats understate within-person variation and would flatter
  the FRR.
- Restart the server with the new number:

  ```bash
  # Ctrl+C the session-1 server, then
  EVAL_CAPTURE=1 EVAL_SESSION=2 node server.js
  ```

- Same volunteer logs in to the same account: **at least 2 logins per device**,
  laptop and phone where possible. No re-registration.

Genuine pairs are formed only **between** sessions (s1 × s2 of one subject);
clips inside one session are never paired with each other. Impostor pairs are
all cross-subject pairs.

## 4. Attack material (same day, optional)

Run the scripted attacks in [ATTACKS.md](ATTACKS.md) (replay, spliced audio,
photo; voice-clone and face-swap media are supplied separately) directly on
`eval_data/`, which already uses the `<subject>_s<session>__<code>.mp4` layout
`attack_suite.mjs` expects. Clips with a `-2` collision suffix (same code twice
in one session — rare) are skipped by the attack suite.

## 5. End of day — switch capture off

```bash
# Ctrl+C the capture server, then
systemctl --user start multibio-backend
curl -s http://localhost:8099/eval-status     # must print {"evalCapture":false}
```

Then count what was collected:

```bash
cd ~/Multibiometric_Code
ls eval_data | sed -E 's/^([0-9a-f]{8})[0-9a-f]*_s([0-9]+)__.*/\1 s\2/' | sort | uniq -c
```

Every subject needs clips in **both** s1 and s2, else the harness refuses it.

## 6. Run the evaluation

```bash
cd ~/Multibiometric_Code/backend
node scripts/run_evaluation.mjs ../eval_data ../evaluation_out_own
node scripts/attack_suite.mjs --corpus ../eval_data --out ../attack_out
```

`run_evaluation.mjs` refuses to report unless ≥5 subjects each have ≥2 sessions.
For a cross-device split, write `eval_data/corpus_meta.json` with a
`recordings_index` of `{ "recording": "<file name without .mp4>", "device":
"laptop" | "phone" }` entries from the participant sheet before running.

## 7. Data handling

- `eval_data/` holds **plaintext face and voice video**. It is git-ignored; keep
  it on an encrypted disk, never copy it into the repo, the paper directory or
  cloud sync.
- Delete it on the date stated in the consent form, and on any withdrawal
  (remove that subject's files — the participant sheet gives the username, and
  `templateId(username)` gives the file prefix).
- Report in the paper only aggregate numbers and counts: volunteers, sessions,
  clips per session, devices.

## Size planning

| Volunteers | Sessions | Logins/session | Genuine pairs (s1 clips × s2 clips) |
|---|---|---|---|
| minimum 5 | 2 | 2 | 5 × (3 × 2) = 30 |
| target 20 | 2 | 3 | 20 × (4 × 3) = 240 |

Session 1 contributes the enrolment clip plus its logins; session 2 its logins.
Impostor pairs grow quadratically in volunteers, so genuine trials (FRR) are
the scarce side — add volunteers before adding logins.
