# Recognition-accuracy evaluation

This is the procedure for producing FAR, FRR, EER, ROC and DET for the scheme.
It is not run by default and reports nothing until real recordings exist — the
paper reports no accuracy metric for exactly this reason.

## Two ways to collect the corpus

The evaluation harness (`backend/scripts/run_evaluation.mjs`) reads a flat
directory of raw recordings named:

```
<subject>_s<session>.mp4     e.g. p01_s1.mp4, p01_s2.mp4, p02_s1.mp4
```

Genuine pairs are formed between **different sessions of the same subject**;
impostor pairs between **different subjects**. There are two ways to fill that
directory.

### Option A — instrumented normal use (`EVAL_CAPTURE`)

Participants use the application normally; the server saves a copy of each
uploaded recording into the corpus automatically.

```bash
cd backend
EVAL_CAPTURE=1 EVAL_CORPUS_DIR=../evaluation_corpus node --env-file=.env server.js
```

- **Registration** writes session 1; **each login** writes the next session.
- The subject in the filename is a **keyed hash** of the username (the same
  `templateId` the template store uses), not the plaintext name — so a listing of
  the corpus discloses no usernames. Sessions of one participant still share a
  subject and group correctly; different participants are different subjects.
  (The video content is still identifying, so the corpus remains sensitive.) If
  you need the participant↔subject mapping, compute `templateId(username)` with
  the server key, or keep a separate consented mapping.

So each participant **registers once and logs in at least once**, which yields
the two different-session recordings a genuine pair needs. Different usernames
are different subjects.

`EVAL_CAPTURE` is off unless set to a truthy, non-`0` value. When off, behaviour
is exactly as before: recordings are reduced to encrypted templates and deleted,
and nothing is written to the corpus. The server prints a warning at startup
whenever capture is on.

**Consent is required and enforced, not merely displayed.** When capture is on,
the registration and login pages show a red retention banner explaining that the
recording will be kept for research and offer an opt-in checkbox (unchecked by
default). The client sends the consent flag with the upload, and the server
retains the recording only when that flag is present — enabling `EVAL_CAPTURE`
alone never retains anyone who did not tick the box. A participant who declines
still registers and logs in normally; their recording is deleted as usual. The
client learns capture is active from `GET /eval-status`, which exposes only the
boolean.

**This mode writes plaintext recordings to disk — the one thing the scheme
otherwise never does.** It is for a consented data-collection session only, must
never be enabled in production, and the collected corpus must be stored and
disposed of under whatever consent the participants gave. The capture directory
should be excluded from version control.

Notes and edge cases:
- A login recording is captured on the login *upload*, before the pipeline runs,
  so it is captured even if that login later fails the biometric check. In a
  controlled session where each participant uses their own account this is
  harmless; do not mine the corpus for impostor labels from failed logins, since
  the file is named for the account the recording was submitted against, not the
  person actually in it.
- Session numbering is derived by scanning the corpus, so it is stable across
  server restarts.

### Option B — out-of-band recording (no app involvement)

Record clips directly and name them yourself. The harness runs the same
extraction the app uses, so the app need not run at all. This keeps the
evaluation corpus fully separate from the (empty) production store, which is the
cleaner arrangement for a published result.

## Running the evaluation

```bash
cd backend
node scripts/run_evaluation.mjs ../evaluation_corpus ../evaluation_out
```

The harness will:

1. Extract one template per recording through the deployed extraction path.
2. **Refuse to proceed** unless there are at least 5 subjects and every subject
   has at least 2 sessions — below that an error rate is not worth reporting.
3. Verify that no two recordings produced an identical template (the guard
   against the duplicate-enrolment problem that invalidated the first corpus).
4. Score every genuine and impostor pair with the deployed matchers
   (median-per-frame face cosine at 0.35, ECAPA voice cosine at 0.30), plus the
   conjunctive fused decision.
5. Write `scores.csv`, `metrics.json` (FAR/FRR sweep, EER, AUC, deployed
   operating point), and `fig_det.png` / `fig_score_dist.png`.

## What is still needed

Recordings that do not presently exist. **Minimum: 5 participants, 2 sessions
each.** For rates comparable to the schemes surveyed in the paper, aim for
**20–50 participants with 2–3 sessions each**, sessions separated in time so
that within-person variation is represented. Each recording must contain a
visible face and at least one second of speech (the participant reading the
digit challenge aloud satisfies both).
