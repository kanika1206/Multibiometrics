# Recognition-accuracy evaluation

This is the procedure for producing FAR, FRR, EER, AUC, ROC and DET for the
scheme. It reports nothing until a corpus exists, and refuses to emit metrics
from a corpus too small to support them.

Related: [ATTACKS.md](ATTACKS.md) for attack success rates, and
[THREAT_MODEL.md](THREAT_MODEL.md) for the adversaries those attacks instantiate.

## The full pipeline

```bash
cd backend

# 1. build a corpus from a public audio-visual dataset (see "Corpus" below)
node scripts/ingest_public_corpus.mjs --profile ravdess \
     --src ../datasets/RAVDESS --out ../evaluation_corpus --sessions 3

# 2. measure the challenge factor's own false rejection rate
node scripts/evaluate_challenge.mjs --trials ../challenge_corpus \
     --out ../evaluation_out

# 3. score the corpus and produce every figure and table
node scripts/run_evaluation.mjs ../evaluation_corpus ../evaluation_out
```

Step 2 is optional but changes what step 3 can report: with a measured challenge
FRR present, the independence comparison against the paper's Eq. (6)–(7) runs on
all three factors rather than the two biometric ones.

Then copy the generated `results.tex` and the three figures next to the paper
source. The paper `\input`s that file, so **no number is ever retyped by hand** —
re-running the harness updates the paper.

## Corpus

The harness reads a flat directory of recordings named:

```
<subject>_s<session>.mp4            e.g. p01_s1.mp4, p01_s2.mp4, p02_s1.mp4
<subject>_s<session>__<code>.mp4    e.g. p01_s1__48213.mp4 (several clips per session)
```

Genuine pairs are formed between **different sessions of the same subject**;
impostor pairs between **different subjects**. A recording is never compared
with itself — a self-comparison scores 1.0 and would flatter the FRR.

### Option 0 — a public dataset (no human-subject collection)

`scripts/ingest_public_corpus.mjs` maps a downloaded public audio-visual dataset
onto that layout and records provenance in `corpus_meta.json`: the dataset, its
consent basis, the device condition of each recording, the subject and session
counts, and the expected genuine and impostor pair counts. Those are exactly the
fields the paper's evaluation section has to state. Profiles: `voxceleb2`,
`voxceleb1`, `ravdess`, `cremad`, `mobio`, and `generic` with a `--pattern`.

**Pick a dataset the speaker model has not been trained on.** The deployed voice
factor is `spkrec-ecapa-voxceleb`, which is trained on the VoxCeleb1+2
*development* sets; measuring its EER on VoxCeleb2-dev scores the model on its
own training data. RAVDESS, CREMA-D and MOBIO are outside it; VoxCeleb1 is safe
only if restricted to the held-out test identities (id10270–id10309). Every
`corpus_meta.json` carries a `speaker_model_overlap` verdict, and the ingest tool
warns loudly when the corpus overlaps.

Trade-off to state in the paper: RAVDESS and CREMA-D are single-sitting studio
captures, so they support genuine/impostor pairing but **not** a cross-device or
cross-day claim. MOBIO is the only listed option with real device variation
(mobile vs laptop across twelve sessions), and is the right choice if the
cross-device table matters.

### Two ways to collect your own corpus instead

### Option A — instrumented normal use (`EVAL_CAPTURE`)

Participants use the application normally; the server saves a copy of each
uploaded recording into the corpus automatically.

```bash
cd backend
EVAL_CAPTURE=1 EVAL_SESSION=1 node server.js     # corpus dir defaults to ../eval_data
```

Step-by-step recording-day procedure (two sessions, several logins per
session, two devices): **[RUNBOOK.md](RUNBOOK.md)**.

- Clips are named `<subject>_s<session>__<code>.mp4`, where `<code>` is the
  five-digit challenge the participant was shown (`enroll` for the registration
  clip), so every clip's spoken content is known and the same directory serves
  both `run_evaluation.mjs` and `attack_suite.mjs`.
- With `EVAL_SESSION=N` set, every clip of that server run is session N, so a
  participant records several logins per session. Without it, **registration**
  writes session 1 and **each login** the next session (legacy numbering).
- The subject in the filename is a **keyed hash** of the username (the same
  `templateId` the template store uses), not the plaintext name — so a listing of
  the corpus discloses no usernames. Sessions of one participant still share a
  subject and group correctly; different participants are different subjects.
  (The video content is still identifying, so the corpus remains sensitive.) If
  you need the participant↔subject mapping, compute `templateId(username)` with
  the server key, or keep a separate consented mapping.

Under legacy numbering each participant **registers once and logs in at least
once**, which yields the two different-session recordings a genuine pair needs;
under `EVAL_SESSION` they need clips in two different sessions. Different usernames
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
is excluded from version control (`eval_data/` is in `.gitignore`).

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
5. Write the outputs below.

### Outputs

| File | Contents |
|---|---|
| `scores.csv` | one row per pair: reference, probe, genuine/impostor, same-device, both cosines |
| `metrics.json` | FAR/FRR sweep, EER, **threshold at the EER**, AUC, deployed operating point, fused AND rule, independence comparison, cross-device split, corpus provenance |
| `results.tex` | `\newcommand` macros and table bodies for `\input` into the paper |
| `fig_roc.png` | ROC curves per modality, labelled with AUC |
| `fig_det.png` | DET curves per modality, labelled with EER |
| `fig_score_dist.png` | genuine/impostor histograms, with the deployed **and** EER thresholds drawn |

Three things in `metrics.json` are worth reading directly rather than only via
the paper:

- **`<modality>.eer_threshold`** — where the EER actually sits. The console also
  prints a note when a deployed threshold is ≥0.02 away from it, which is the
  prompt to either re-justify the operating point or move it.
- **`independence_check`** — the measured fused FAR/FRR beside what Eq. (6)–(7)
  predict. A measured value *above* the prediction means the factors fail
  together rather than independently, which is plausible here since all three
  come from one recording. Either outcome is a reportable finding.
- **`cross_device.available`** — `false`, with a reason, when the corpus cannot
  support a cross-device claim. The harness does not approximate one.

## Corpus size

**Minimum enforced: 5 subjects, 2 sessions each** — below that the harness
refuses to emit metrics. For rates comparable to the schemes surveyed in the
paper, aim for **20–50 subjects with 2–3 sessions each**, sessions separated in
time so within-person variation is represented. Each recording must contain a
visible face and at least one second of speech.

Note the asymmetry when planning: genuine pairs grow linearly in subjects
(`subjects × C(sessions,2)`) while impostor pairs grow quadratically
(`C(subjects,2) × sessions²`). Genuine pairs are therefore the scarce side and
the binding constraint on the FRR's precision, so prefer more subjects over more
sessions per subject once you have at least two.
