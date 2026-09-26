# Reviewer Response — `drafttt5-UT (1).pdf`

Reviewer: `utupakul`. Source: 7 sticky-note comments plus 15 highlight anchors embedded in the PDF
(pages 4–7). This document lists every comment, answers it against the actual implementation with
file/line evidence, states the change to make in the paper, and gives the code change where one was
needed. The code changes in §4 (P1–P7) have since been **applied**; P8 needs a corpus, not code.

Status legend: **PAPER** = text edit only · **CODE** = implementation gap, code change applied ·
**BOTH** = needs both.

---

## 1. Summary of reviewer comments

| # | Page | Anchor in draft | Comment (verbatim) |
|---|------|-----------------|--------------------|
| C1 | 4 | Algorithm 1, line 7 — `ttl = 10 min` | "Why TTL = 10 minutes? Users can have multiple account. Are you restricting users to 1 account? Please include some text for account reset and update process." |
| C2 | 4 | Algorithm 1, lines 13–14 (upload/template validation) | "Will it still work if the user uses devices with different camera settings." |
| C3 | 4–5 | §3.4 Threat Model, "(i) watch and record the victim's public or previously transmitted media" | "In the threat mode you are assuming that the attacker has video and voice of the user." |
| C4 | 5 | §3.5, "each modality is reduced to an L2 normalized embedding" | "What is L2?" |
| C5 | 5–6 | §3.6, `τ_f = 0.35` and `τ_a = 0.30` | "How are thresholds determined?" |
| C6 | 7 | §4 / Table 7 region, "no FAR, FRR, EER … is claimed" | "Expand FAR, FRR and EER" |
| C7 | 7 | §4.2, "147 KB … 11.18 MB … approximately 76-fold reduction" | "is usage of template and 76-fold reduction an advantage compared to related techniques in Table 5?" |

Highlighted (no note attached) — treat as "clarify this sentence":

- p4 Algorithm 1 line 7 `ttl = 10min`; Algorithm 1 lines 13–14.
- p4 §3.4: "adversary will: (i) watch and record the victim's public or previously transmitted media,
  including video from past sessions, (ii) launch phishing and relay" and "…presumed to be
  trustworthy. A real time relay that transmits the live challenge to the victim…".
- p5 §3.5: "A conjunctive rule is used so that compromise or successful spoofing of a single factor
  cannot independently produce a positive authentication decision."
- p5 §3.6: "Twelve frames are sampled uniformly from each recording"; `τ_f = 0.35`.
- p6 §3.6: `τ_a = 0.30`.
- p7 §4.2: "147 KB, compared with 11.18 MB … approximately 76-fold reduction"; the ✓ row of Table 5.

---

## 2. Answers and solutions

### C1 — TTL, multiple accounts, reset/update process — **BOTH**

**(a) Why 10 minutes?**

The enrolment token TTL is `ENROLL_TTL = "10m"` (`backend/enrollToken.js:20`). It is not arbitrary;
it is bounded on both sides by measured behaviour:

- *Lower bound.* The token must survive one complete enrolment plus at least one retry. Measured
  server-side enrolment (template extraction) is 4.6–12.6 s, and full registration wall-clock is
  7.4–14.3 s (N = 7, `backend/benchmarks/benchmarks.jsonl`). A user who fails on the first recording
  (no face detected, silent microphone) needs a second and possibly third attempt; 10 minutes leaves
  roughly 20–40 attempts' worth of headroom, including time to read an error and re-record.
- *Upper bound.* The token is a bearer credential that authorises writing a biometric template for a
  named account (`backend/enrollToken.js:33-46`). A leaked token is a licence to enrol *someone
  else's* biometrics into that account until it expires, so the window is kept to the shortest value
  the usability bound allows.
- *Consistency.* Three lifetimes are deliberately ordered:
  CAPTCHA 5 min (`backend/captchaStore.js:11`) < enrolment token 10 min (`enrollToken.js:20`) <
  janitor grace 15 min (`backend/enrollmentJanitor.js:44`). The janitor must never delete an account
  whose enrolment is still legally possible, hence 15 > 10.

*Paper edit:* replace the bare `ttl = 10 min` with a sentence giving this rationale and a
"challenge and token lifetimes" table (see §5, Table A).

**(b) Are users restricted to one account?**

Today the restriction is **one account per username and one account per e-mail address**, enforced at
`backend/controllers/appController.js:118-131`: the username must be unique, and the e-mail is matched
through a keyed index `emailIdx` (`piiStore.js`, the paper's `idx ← H_kpii(N_e(m))`) so the server
never compares plaintext addresses. There is **no biometric-level restriction** — the same person
with two e-mail addresses can hold two enrolled accounts. The draft does not say this, and Algorithm 1
line 5 ("Check for existing enrolled accounts with u or idx") reads as though it does more than it
does.

One further subtlety the draft omits: an account that was created but never enrolled is *released*,
not treated as a conflict (`appController.js:106-136`). An unenrolled account holds no biometrics, so
re-registering over it is indistinguishable from taking a never-used name; `hasTemplate()` gates every
deletion so an *enrolled* account is never released.

*Solution — paper:* state the policy explicitly: "identifier uniqueness and e-mail uniqueness are
enforced; biometric uniqueness across accounts is not, and is deliberately out of scope because a
global biometric duplicate check requires cross-user template comparison, which conflicts with the
per-user key isolation described in §3.7."

*Solution — code (optional, only if one-identity enforcement is actually wanted):* a biometric
de-duplication check at enrolment would require decrypting every stored template under its own vault
key and scoring the new template against all of them — O(n) decryptions per registration — and it
would break the property that one user's key never touches another user's data. If required, the
acceptable form is an offline, operator-run audit script rather than an online registration check.

**(c) Account reset and update process.**

This is a genuine gap, not just missing text.

- **Update:** exists. `PUT /api/updateuser` behind `Auth` (`backend/router/route.js:25`,
  `appController.js:559-593`). It re-seals changed PII fields and moves the e-mail index with the
  address, rejecting a collision with 409.
- **Reset / re-enrolment:** **now implemented** (it did not exist when this response was first
  written). OTP and password reset remain removed because the scheme is passwordless
  (`route.js`, `appController.js`). Enrolment was previously final — `/upload-video` returned
  `ALREADY_ENROLLED` 409 whenever a template existed — so a user whose biometrics stopped matching
  (injury, illness, a permanently changed voice) was locked out with no recovery path, and the
  enrolled template had no erasure route either. Both now exist:
  `POST /api/reenroll-request` and `DELETE /api/account`.

*Code change (applied):*

1. `POST /api/reenroll-request` (`route.js`, `appController.reenrollRequest`) — answers only after a
   *successful full three-factor login*: login and this endpoint now share one verification function
   (`appController.threeFactorAttempt`), so no second, laxer path exists. It then mints a token with
   `purpose: "reenroll"` and the same 10-minute TTL. `enrollToken.js` takes `purpose` as a parameter
   (`issueEnrollToken(username, purpose)`) instead of hard-coding `"enroll"`, and `enrollGrantFrom`
   returns `{ username, purpose }`. A session JWT is still rejected outright.
2. `/upload-video` accepts a `reenroll` grant as authority to **replace** a template
   (`templateStore.reenrollFromBuffer`): extract to a temp file, encrypt under a NEW key beside the
   old ciphertext, commit the key, then `rename(2)` the new ciphertext over the old one — atomic, so
   no reader sees a partial template. A failure before the swap leaves the enrolment untouched; a
   failure after the key was committed restores the previous key (`keyVault.putUserKey`). The purpose
   check is inverted rather than skipped: `enroll` may never replace a template, `reenroll` may only
   replace one.
3. `DELETE /api/account` behind `Auth` (`appController.deleteAccount`) — deletes the account row, the
   encrypted template (`templateStore.deleteTemplate`) and the vault key entry (the three deletions
   the janitor already performs), plus any login recording still on disk.
4. Out-of-band recovery for the case where the user *cannot* authenticate at all remains an
   administrative procedure, not an endpoint: operator-verified identity → delete the account
   (`DELETE /api/account`, or the equivalent operator action) → the user registers and enrols again.
   It is the deliberate trust anchor of the scheme and should be named as such in the paper rather
   than left implicit.

*Paper edit:* new subsection §3.9 "Account lifecycle: update, re-enrolment, recovery and deletion",
covering the four items above and stating which are implemented versus specified.

---

### C2 — Different camera settings across devices — **BOTH**

**Answer: partly by construction, but the claim is currently untested.**

What makes the pipeline device-tolerant in principle (`backend/extractTemplate.py`):

| Source of device variation | How the pipeline absorbs it | Evidence |
|---|---|---|
| Resolution, aspect ratio | InsightFace `buffalo_l` detects at `det_size=(640,640)` and internally aligns and crops each face to the recogniser's fixed input, so the embedding is computed on a normalised crop, not the raw frame | `extractTemplate.py:54` |
| Frame rate, clip length | 12 frames sampled by *even index* across the clip, not by timestamp; a fallback path handles browser containers that report no frame count | `extractTemplate.py:40,60-89` |
| Exposure, white balance, per-frame quality | Enrolled reference is the L2-normalised **mean** of frame embeddings; the login score is the **median** of per-frame cosines, so a minority of degraded frames cannot move the verdict | `extractTemplate.py:143-146`, `matchFaceTemplate.py:41-42` |
| Scale / gain differences | Both embeddings are L2-normalised, so the score is a cosine — invariant to embedding magnitude | `extractTemplate.py:123,146` |
| Microphone sample rate, channel count | ffmpeg forces mono at 16 kHz before ECAPA-TDNN, and clips under 1 s are rejected | `extractTemplate.py:107-114` |
| Container / codec | Recording is browser `MediaRecorder` output, decoded by OpenCV/ffmpeg; upload cap 100 MB | `frontend/src/components/Register.js:54`, `backend/server.js:76-78` |

What is **not** handled, and should be stated honestly:

1. Capture was unconstrained — the client asked for `{ video: true, audio: true }` — so resolution,
   frame rate and channel count were whatever the device defaulted to, and a low-end front camera
   could yield faces below the detector's usable size, failing as "no face detected" (exit 2) rather
   than as a low score. **Now constrained** (applied, below).
2. There was **no image- or audio-quality gate**: no minimum face bounding-box size, no usable-frame
   floor. A poor enrolment produced a poor reference template permanently, and template-only storage
   means it cannot be re-scored later (§4.3 of the draft). **An enrolment-only gate now exists**
   (applied, below). Blur, illumination and SNR checks remain absent.
3. **No cross-device experiment has been run.** Every measurement in the draft comes from recordings
   made on the same hardware, so cross-device robustness is at present an argument from architecture,
   not a result. The log now carries the capture settings needed to run one (applied, below), but the
   experiment itself is still outstanding.

*Code change (applied):*

- Capture constraints are pinned in both recorders (`Register.js`, `Password.js`):
  `{ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  audio: { channelCount: 1, sampleRate: 48000, echoCancellation: true } }`. They are `ideal`, so a
  device negotiates its closest match rather than failing, and a capture error still falls back once
  to the unconstrained request.
- `extractTemplate.py --enrollment` applies a quality gate: at least 6 of the sampled frames must
  carry a face of at least 80×80 px. It exits 3 with `QUALITY:FACE_TOO_SMALL` or
  `QUALITY:TOO_FEW_USABLE_FRAMES`, which `templateStore.qualityReason` turns into "move closer" /
  "improve the lighting" for the user. Enrolment only — the gate is never applied at login, where
  tightening the input would only raise FRR for users who are already enrolled.
- Each benchmark record carries the capture settings the browser actually negotiated —
  `device: { width, height, frameRate, platform }`, bounded and whitelisted by
  `benchmarkStore.deviceInfo` — so a cross-device analysis is possible from the existing log.

*Paper edit:* new §3.6 paragraph "Acquisition variability", giving the invariance argument in the
table above, and a matching limitation sentence in §4.3 stating that cross-device evaluation is
future work. Add the cross-device protocol to §5: record each subject on at least two devices and
report per-device and cross-device genuine score distributions.

---

### C3 — Threat model assumes the attacker holds the victim's video and voice — **PAPER**

**Answer: yes, and that assumption is intentional and should be stated as the premise of the design,
not buried in a list.**

Face and voice are *observable* traits: they appear in video calls, social media and recordings of
past sessions. A scheme that only holds up while the attacker lacks samples is not deployable.
The draft therefore assumes the adversary already possesses genuine face and voice media of the
victim, and the security argument does not rest on biometric secrecy at all. It rests on **freshness**:

- the challenge `C` is server-generated, single-use and consumed on retrieval regardless of outcome
  (`captchaStore.js:36-42`), with a 5-minute expiry (`captchaStore.js:11`);
- decision fusion is conjunctive, `D = b_f ∧ b_a ∧ b_c` (draft eq. 4), so previously captured media
  can satisfy `b_f` and `b_a` yet still fail `b_c`.

In other words, the assumption the reviewer highlights is precisely what motivates the third factor.
What the scheme adds over a pure face+voice matcher is exactly the part the attacker's archive cannot
supply: a correct spoken response to a value that did not exist when the archive was recorded.

Limits that must stay explicit (already partly in the draft, but scattered): a **real-time relay**
that shows the live challenge to the victim and returns the response inside the validity window, and
a **real-time deepfake** able to speak an unpredictable string in the victim's voice and face, both
defeat this defence. They are out of scope and are the subject of §5.

*Paper edit:* restructure §3.4 into three labelled blocks — **Adversary capabilities** (holds archived
face and voice media of the victim; controls the client device and the network; can phish and relay),
**Trust assumptions** (server, challenge generator and key vault are honest), **Out of scope**
(real-time relay within the validity window, real-time responsive deepfake, verifier compromise,
coercion). Then add one sentence: "Because face and voice are observable traits, the scheme assumes
they are known to the adversary; security derives from challenge freshness and conjunctive fusion,
not from biometric secrecy." That single sentence is the direct answer to this comment.

---

### C4 — "What is L2?" — **PAPER** (no code change)

L2 is the Euclidean norm. For an embedding `e ∈ R^d`, `‖e‖₂ = sqrt(Σ e_i²)`, and "L2 normalised"
means the vector is rescaled to `e / ‖e‖₂`, so that `‖e‖₂ = 1`. Two unit vectors satisfy
`⟨e₁, e₂⟩ = ‖e₁‖‖e₂‖ cos θ = cos θ`, so the **inner product is exactly the cosine similarity**, in
`[-1, 1]`. This is why the draft can write the decisions as inner products in eq. (1)–(2) while
calling them cosine similarities, and why the thresholds are interpretable as cosines.

Implementation: `emb /= np.linalg.norm(emb)` for the speaker embedding (`extractTemplate.py:123`),
`template /= np.linalg.norm(template)` for the mean face reference (`extractTemplate.py:146`);
per-frame face embeddings arrive already normalised from InsightFace (`normed_embedding`,
`extractTemplate.py:78,88`); the matchers therefore score with a plain dot product
(`matchFaceTemplate.py:41`, `matchVoiceTemplate.py:65-68`).

*Paper edit:* on first use in §3.5, expand to "L2 (Euclidean) normalised, i.e. rescaled to unit
Euclidean norm, ‖e‖₂ = 1, so that the inner product of two embeddings equals their cosine
similarity", and add a one-line definition of the L2 norm. This also means the reference face
template is the *L2-normalised mean* of the frame embeddings, which §3.6 should spell out.

---

### C5 — How are the thresholds determined? — **BOTH**

The two thresholds do **not** have the same status today, and the draft should say so rather than
presenting them as a matched pair.

**Voice, τ_a = 0.30 — empirically derived.** `backend/matchVoiceTemplate.py:50`, with the derivation
in its module docstring (`matchVoiceTemplate.py:24-40`) and `docs/voice-verification.md`. From a
labelled set built from the available recordings (two distinct human speakers, segmented into
overlapping windows):

- real cross-speaker (impostor) cosine, maximum: **0.256**
- genuine same-speaker cosine, floor: **0.345** (excluding one near-silent 4 s window artefact)

0.30 sits in that empirical gap: FAR = 0 on the real impostor pairs, with FRR driven only by a
degenerate short window that cannot arise at login, where the whole recording is embedded. Synthetic
`espeak` voices were deliberately excluded from threshold selection — they share a synthesis timbre
and are not distinct speakers to ECAPA-TDNN.

The same file documents *why the paper's original MFCC distance was replaced*: on the enrolled
templates, genuine pairs scored 172.8–178.8 and impostor pairs 153.7–193.0 — the impostor range spans
the genuine one, so no threshold separates speakers. That statistic measured loudness, not identity.
This belongs in the paper; it justifies the ECAPA-TDNN substitution.

**Face, τ_f = 0.35 — an inherited operating point, not a calibration.**
`backend/matchFaceTemplate.py:17` carries only the comment "buffalo_l separates identities well above
this". The available evidence is the diagnostic separation already in draft Table 7 (genuine 0.8385
versus impostor 0.0928 — a gap of 0.75, so any threshold in roughly 0.1–0.8 gives the same verdict on
that data), which shows the value is *safe* on the observed scores but does **not** show it is
calibrated. The draft must not imply otherwise.

**The harness for doing this properly already exists and should be cited.**
`backend/scripts/evaluate_corpus.py` scores a labelled corpus using the *deployed* matcher code paths
(median per-frame cosine for face, dot product of L2-normalised ECAPA embeddings for voice; the
deployed operating points are quoted at lines 41–42 so the plots can mark them), forms genuine pairs
only across *different sessions* of the same subject — never a recording against itself, which would
flatter FRR — and sweeps FAR/FRR across every distinct score to produce EER, AUC, DET curves and
score-distribution figures. `backend/scripts/run_evaluation.mjs` drives it; `docs/EVALUATION.md`
specifies corpus collection, including the consented `EVAL_CAPTURE` mode.

*Solution:* state the two provenances separately and honestly in §3.6, cite the measured voice
distribution, label τ_f as an inherited operating point pending corpus calibration, and state the
rule that will be used once a corpus exists: pick each τ at the EER of its own modality on the
evaluation corpus, then report the operating-point FAR/FRR at the deployed τ. No code change is
required to *determine* the thresholds — only a corpus; the harness is already written.

---

### C6 — Expand FAR, FRR and EER — **PAPER**

Expansions on first use, plus definitions the draft currently assumes:

- **FAR** — False Acceptance Rate: the fraction of impostor attempts accepted,
  `FAR(τ) = P(s ≥ τ | impostor)`.
- **FRR** — False Rejection Rate: the fraction of genuine attempts rejected,
  `FRR(τ) = P(s < τ | genuine)`.
- **EER** — Equal Error Rate: the value at the threshold where `FAR(τ) = FRR(τ)`; a single
  threshold-free summary used to compare matchers.
- While expanding these, also expand on first use: **ROC** (Receiver Operating Characteristic),
  **DET** (Detection Error Tradeoff), **AUC** (Area Under the Curve), **PAD** (Presentation Attack
  Detection), **STT** (Speech-to-Text), **TTL** (Time To Live), **MITM** (Man-In-The-Middle) — the
  last two appear only as abbreviations, including inside Table 5's column headers.

Add one sentence making the system-level relationship explicit, since the scheme is conjunctive:
with independent factors, `FAR_system ≈ FAR_face × FAR_voice × FAR_challenge` and
`FRR_system ≈ 1 − (1 − FRR_face)(1 − FRR_voice)(1 − FRR_challenge)` — that is, AND fusion lowers FAR
and raises FRR relative to any single factor. This is the quantitative statement of the security
argument in §3.5 and is worth stating even though the corpus is too small to instantiate it.

*Placement:* expand at first occurrence (abstract / §4) and add a nomenclature list. Keep the existing
§4.3 caveat that no FAR/FRR/EER value is claimed from the present corpus — expanding the acronyms does
not weaken that; it makes the caveat readable.

---

### C7 — Is the 76-fold reduction an advantage over Table 5 systems? — **PAPER**

**Honest answer: as presently written, no — and the claim should be reframed rather than defended.**

Three separate points are currently compressed into one sentence:

1. **The measurement.** 147 KB template versus 11.18 MB source recording, ≈ 76×, plus a fixed 34-byte
   AES-256-GCM envelope overhead. This is a *storage* figure for this implementation. The ratio is not
   a property of the scheme: it scales with recording length, resolution and codec, all of which are
   device-dependent (see C2), while the template size is fixed by construction — 12 × 512-d face
   frame embeddings, one 512-d mean, one 192-d speaker embedding. A 4K recording would make the ratio
   look several times "better" while changing nothing of substance.
2. **What it demonstrates.** Not compression efficiency but **template-only storage**: the raw
   recording is destroyed after extraction, so the persistent artefact is a fixed-size, non-invertible
   representation rather than reusable face and voice media. *That* is the privacy property, and the
   76× is merely its visible side-effect.
3. **Comparability with Table 5.** None of [15]–[19] report per-user storage, so no comparative claim
   can be made from this number, and Table 5 has no storage column. The honest comparison to Table 5
   is the one Table 5 already makes: template protection, encryption, and unlinkability/pseudonymity
   (columns where the proposed scheme is ✓ and most compared systems are ✗).

*Solution — paper:*

- Move the 147 KB / 11.18 MB / 76× figure out of any comparative context into a short "Storage
  footprint" paragraph in §4.2, phrased as a deployment cost measurement: "the persistent per-user
  artefact is 147 KB independent of recording length, versus 11.18 MB for the source recording in
  this implementation (≈76×); the ratio depends on capture settings and is reported as a deployment
  cost, not as a comparative advantage."
- State the fixed-size property explicitly, since that *is* comparable: per-user storage is
  **O(1) in recording length** — 12 × 512 + 512 + 192 floats plus a 34-byte envelope.
- Add one sentence to §3.8 tying the advantage to the right columns: "the advantage over [15]–[18] is
  template-only storage with authenticated encryption and pseudonymous naming (Table 5, columns
  Templ. Prot. / Encr. / Unlink.), not storage size, which those works do not report."
- Optionally add a "Raw media retained" column (Yes / No / not stated) to Table 5 — it is the property
  actually being claimed, and it is assessable from the cited papers.

---

## 3. Changes to make in the paper, in order

| # | Section | Change | Source comment |
|---|---------|--------|----------------|
| 1 | §3.1 / Algorithm 1 | Rationale for the 10-minute TTL; add lifetimes table (Table A) | C1 |
| 2 | §3.1 | State the uniqueness policy: username and e-mail unique; biometric uniqueness out of scope; unenrolled accounts released, enrolled accounts never | C1 |
| 3 | §3.9 (new) | Account lifecycle: update (implemented), re-enrolment (implemented, `POST /api/reenroll-request`), deletion (implemented, `DELETE /api/account`), operator recovery (administrative procedure, not an endpoint) — label implementation status of each | C1 |
| 4 | §3.6 | New paragraph "Acquisition variability": detector-side alignment, index-based frame sampling, median fusion, cosine invariance, 16 kHz mono resampling | C2 |
| 5 | §4.3 | Limitation: no cross-device evaluation; no acquisition quality gate; enrolment quality is permanent under template-only storage | C2 |
| 6 | §3.4 | Restructure into Adversary capabilities / Trust assumptions / Out of scope; add the "biometrics are not secrets; security rests on freshness" sentence | C3 |
| 7 | §3.5 | Define the L2 norm; state that unit-norm embeddings make the inner product a cosine | C4 |
| 8 | §3.6 | Separate threshold provenance: τ_a empirical (0.256 / 0.345 gap), τ_f inherited operating point; state the EER calibration rule for future corpora; cite the MFCC-replacement evidence | C5 |
| 9 | §4 | Cite `evaluate_corpus.py` / `run_evaluation.mjs` / `docs/EVALUATION.md` as the implemented accuracy harness | C5, C6 |
| 10 | Abstract, §4, new nomenclature list | Expand FAR, FRR, EER, ROC, DET, AUC, PAD, STT, TTL, MITM on first use; add the conjunctive FAR/FRR composition formulas | C6 |
| 11 | §4.2 | Reframe 147 KB / 11.18 MB / 76× as a storage-footprint measurement; add the O(1)-in-recording-length statement | C7 |
| 12 | §3.8 / Table 5 | Tie the claimed advantage to Templ. Prot. / Encr. / Unlink. columns; optionally add a "Raw media retained" column | C7 |
| 13 | §5 | Add: cross-device evaluation protocol; automated key rotation (already noted); on-premises STT (already noted) | C2 |

---

## 4. Code changes (P1–P7 applied)

| # | File | Change | Why | Comment | Status |
|---|------|--------|-----|---------|--------|
| P1 | `backend/enrollToken.js` | `purpose` is a parameter (`issueEnrollToken(username, purpose)`); purposes `enroll` and `reenroll`; `enrollGrantFrom` returns `{ username, purpose }` | Enables authenticated re-enrolment | C1 | applied |
| P2 | `backend/router/route.js`, `controllers/appController.js` | `POST /api/reenroll-request`, answered only by the same three-factor verification `/api/login` runs (shared `threeFactorAttempt`) | No recovery path existed | C1 | applied |
| P3 | `backend/server.js` (`/upload-video`), `templateStore.js`, `keyVault.js` | A `reenroll` grant replaces a template: extract to temp, encrypt under a new key, commit the key, atomic `rename` swap, previous key restored on failure | `ALREADY_ENROLLED` 409 made enrolment permanent | C1 | applied |
| P4 | `backend/router/route.js`, `controllers/appController.js`, `templateStore.js` | `DELETE /api/account` behind `Auth`: account row + encrypted template + vault key + any login recording | No erasure route for enrolled biometric data | C1 | applied |
| P5 | `frontend/src/components/Register.js`, `Password.js` | Explicit 720p30 / mono-audio `ideal` constraints, with a one-shot unconstrained fallback | Capture quality was whatever the device defaulted to | C2 | applied |
| P6 | `backend/extractTemplate.py` | Enrolment-only quality gate (`--enrollment`): face bounding box ≥ 80×80 px, ≥ 6 usable frames, exit 3 with `QUALITY:<CODE>` | A poor enrolment template is permanent and unrecoverable | C2 | applied |
| P7 | `backend/benchmarkStore.js` | `device: { width, height, frameRate, platform }` per attempt, whitelisted by `deviceInfo` | Makes cross-device analysis possible from the existing log | C2 | applied |
| P8 | — (no code change) | Run `run_evaluation.mjs` over a consented corpus and set each τ at its modality's EER | The harness exists; only a corpus is missing | C5, C6 | outstanding |

---

## 5. Results tables for the revised implementation

### Table A (new) — Challenge and token lifetimes

Answers C1 directly and makes the ordering constraint visible.

| Artefact | Lifetime | Single-use | Source |
|---|---|---|---|
| Login CAPTCHA `C` | 5 min | Yes — consumed on retrieval regardless of outcome | `captchaStore.js:11,36-42` |
| Enrolment token `E` (`purpose: enroll`) | 10 min | Bound to one account; `/upload-video` refuses an existing template | `enrollToken.js`, `server.js` |
| Re-enrolment grant (`purpose: reenroll`) | 10 min | Bound to one account; issued only after a successful three-factor login, and may only REPLACE an existing template | `enrollToken.js`, `appController.reenrollRequest`, `server.js` |
| Unenrolled-account janitor grace | 15 min | Re-checks `hasTemplate()` immediately before deletion | `enrollmentJanitor.js:44` |
| Session token (post-authentication) | Per `ENV` signing configuration | — | `appController.js` (login) |

Caption constraint to state: grace (15) > enrolment TTL (10) > challenge TTL (5), so no sweep can
delete an account whose enrolment is still possible.

### Table 6 (revised) — Measured per-stage processing time (ms)

Keep the draft's N = 5 rows, and add the larger live sample now present in
`backend/benchmarks/benchmarks.jsonl` (25 attempts, 2026-08-22). New rows and columns in **bold**.

| Stage | Mean | Min | Max | **N** | **Source** |
|---|---|---|---|---|---|
| Login template extraction | 12424 | 11888 | 12779 | 5 | controlled runs (i9-12900) |
| Face matching | 98 | 73 | 116 | 5 | controlled runs |
| Voice matching | 104 | 83 | 138 | 5 | controlled runs |
| Audio demultiplexing | 154 | 146 | 162 | 5 | controlled runs |
| Speech-to-text | 2367 | 2085 | 2666 | 5 | controlled runs |
| **Template decryption** | **9.4** | **2.6** | **28.8** | **4** | **live log, successful logins** |
| **Login template extraction (live)** | **6596** | **4606** | **12190** | **4** | **live log, successful logins** |
| **Face + voice matching, combined (live)** | **150** | **143** | **155** | **4** | **live log, successful logins** |
| **Speech-to-text (live)** | **2354** | **1534** | **3648** | **4** | **live log, successful logins** |
| **Server-side verification, total (live)** | **6746** | **4757** | **12339** | **4** | **live log, successful logins** |

Caption note: the live rows come from the deployed server's own benchmark log rather than the
controlled timing runs, so they include ordinary system contention; the two sets agree on the
structural conclusion — template extraction dominates, matching is negligible.

### Table B (new) — End-to-end authentication and enrolment time (live log, N = 25 attempts)

This is the table the draft currently lacks: it reports user-visible latency, not only server stages.

| Operation | Outcome | N | Total mean (s) | Total min (s) | Total max (s) | Client-side pre-upload mean (s) | Server mean (s) |
|---|---|---|---|---|---|---|---|
| Registration (account + enrolment) | success | 7 | 11.56 | 7.35 | 14.30 | 1.55 | 10.01 |
| Login | success | 4 | 26.89 | 14.87 | 42.78 | 20.13 | 6.76 |
| Login | failure | 13\* | 35.08 | 0.02 | 140.08 | 21.13 | 12.95 |

\* 14 failure records; one carries no total, having been rejected before any upload.

Point to make in the text: client-side time — recording the video and speaking the challenge — is
**about 20 s of the roughly 27 s successful login**. It dominates the end-to-end experience, and it is
*user* time, not compute. Server-side verification is 6.76 s mean. This reframes the draft's
optimisation priority: persistent model services (§5) address the 6.76 s, not the 20 s.

### Table C (new) — Authentication attempt outcomes (live log, N = 25)

Supports the draft's claim of "functional end-to-end authentication behaviour" with actual numbers,
without claiming any recognition-accuracy metric.

| Operation | Outcome | Reason code | Count |
|---|---|---|---|
| Registration | success | — | 7 |
| Login | success | — | 4 |
| Login | failure | `NO_ENROLLMENT` | 7 |
| Login | failure | `CAPTCHA_MISMATCH` | 6 |
| Login | failure | `SPEECH_NOT_RECOGNIZED` | 1 |
| **Total** | | | **25** |

Required caption wording: these are **operational** outcomes from a development deployment, not
biometric error rates. In particular, no failure in this log was a biometric mismatch: the
`NO_ENROLLMENT` failures are the abandoned-enrolment defect analysed in `docs/enrollment-completion.md`
(now addressed by `enrollmentJanitor.js` and the pending-enrolment flag), and the `CAPTCHA_MISMATCH`
and `SPEECH_NOT_RECOGNIZED` failures are third-factor transcription failures. Neither FAR nor FRR may
be inferred from this table.

### Table 7 (unchanged values, caption strengthened) — Deployed matcher diagnostic scores

| Deployed matcher | Genuine | Impostor | Threshold | **Threshold provenance** |
|---|---|---|---|---|
| Face: median per-frame cosine | 0.8385 | 0.0928 | τ_f = 0.35 | **Inherited operating point; separation observed (gap 0.75) but not calibrated** |
| Voice: ECAPA-TDNN speaker cosine | 0.455 | 0.090 | τ_a = 0.30 | **Empirical: impostor max 0.256, genuine floor 0.345; 0.30 lies in the measured gap** |

### Table D (new) — Threshold derivation evidence for the voice factor

Answers C5 with the measured distribution rather than an assertion.

| Statistic | Value | Source |
|---|---|---|
| Real cross-speaker (impostor) cosine, maximum | 0.256 | `matchVoiceTemplate.py:24-40`, `docs/voice-verification.md` |
| Genuine same-speaker cosine, floor | 0.345 (excluding one near-silent 4 s window) | same |
| Selected operating point τ_a | 0.30 | `matchVoiceTemplate.py:50` |
| FAR on the measured real impostor pairs at τ_a | 0 | same |
| Superseded MFCC statistic — genuine range | 172.8 – 178.8 | `extractTemplate.py:17-21` |
| Superseded MFCC statistic — impostor range | 153.7 – 193.0 (spans the genuine range) | same |

### Table E (template) — Recognition accuracy, to be filled from the evaluation corpus

Include in the paper as a populated table only if the corpus is collected before submission;
otherwise keep it in §5 as the planned evaluation. Produced directly by `evaluate_corpus.py`
(`metrics.json`).

| Modality | Genuine pairs | Impostor pairs | EER (%) | AUC | FAR at deployed τ (%) | FRR at deployed τ (%) | τ at EER |
|---|---|---|---|---|---|---|---|
| Face (median per-frame cosine) | — | — | — | — | — | — | — |
| Voice (ECAPA-TDNN cosine) | — | — | — | — | — | — | — |
| Challenge (STT versus `C`) | — | — | n/a | n/a | — | — | n/a |
| Fused (`b_f ∧ b_a ∧ b_c`) | — | — | — | — | — | — | n/a |

Pairing rule to state in the caption: genuine pairs are formed between **different sessions of the
same subject** — never a recording against itself, which would flatter FRR; impostor pairs are formed
between different subjects.

### Table 5 (optional added column) — Comparison with recent systems

Add one column, which is the property the 76× figure is actually evidence for:

| Work | … existing columns … | **Raw media retained** |
|---|---|---|
| Jha et al. [15] | … | not stated |
| Aanjankumar et al. [16] | … | not stated |
| Jha et al. [17] | … | not stated |
| Chen et al. [18] | … | not stated |
| Jha et al. [19] | … | not stated |
| Proposed scheme | … | **No — template only, 147 KB fixed, O(1) in recording length** |

---

## 6. Evidence index

| Claim in this response | File:line |
|---|---|
| Enrolment token TTL = 10 min | `backend/enrollToken.js:20` |
| Token purpose check rejects session JWTs | `backend/enrollToken.js:33-46` |
| CAPTCHA TTL = 5 min, single-use consumption | `backend/captchaStore.js:11,36-42` |
| Janitor grace = 15 min, `hasTemplate()` re-check | `backend/enrollmentJanitor.js:44` |
| Username and e-mail uniqueness; abandoned accounts released | `backend/controllers/appController.js:106-136` |
| Keyed e-mail index (`idx ← H_kpii(N_e(m))`) | `backend/controllers/appController.js:118`, `backend/piiStore.js` |
| Account update implemented; reset/OTP removed | `backend/router/route.js:25,28-30`; `appController.js:559-597` |
| `enroll` grant may never replace a template (`ALREADY_ENROLLED`); `reenroll` may only replace one | `backend/server.js` (`/upload-video`) |
| Re-enrolment authorised by a full three-factor login | `backend/controllers/appController.js` (`threeFactorAttempt`, `reenrollRequest`); `backend/router/route.js` |
| Template replacement: new key, atomic swap, previous key restored on failure | `backend/templateStore.js` (`reenrollFromBuffer`); `backend/keyVault.js` (`generateUserKey`, `putUserKey`) |
| Erasure route (account row + template + vault key) | `backend/controllers/appController.js` (`deleteAccount`); `backend/router/route.js` |
| Enrolment-only acquisition quality gate | `backend/extractTemplate.py` (`check_enrollment_quality`); `backend/templateStore.js` (`qualityReason`) |
| 12 frames sampled by index; detector `det_size=(640,640)` | `backend/extractTemplate.py:40,54,60-89` |
| L2 normalisation of voice and mean-face embeddings | `backend/extractTemplate.py:123,146` |
| Audio forced to 16 kHz mono; under 1 s rejected | `backend/extractTemplate.py:107-114` |
| Face threshold 0.35, median per-frame cosine | `backend/matchFaceTemplate.py:17,41-42` |
| Voice threshold 0.30 with measured derivation | `backend/matchVoiceTemplate.py:24-40,50` |
| Accuracy harness (FAR/FRR/EER/AUC/DET) on deployed code paths | `backend/scripts/evaluate_corpus.py:1-90`; `run_evaluation.mjs`; `docs/EVALUATION.md` |
| Live timing and outcome log (25 attempts) | `backend/benchmarks/benchmarks.jsonl`; `backend/benchmarkStore.js`; `backend/scripts/benchmark_report.mjs` |
| Abandoned-enrolment defect analysis | `docs/enrollment-completion.md` |
| Pinned capture constraints (720p30, mono audio) with fallback | `frontend/src/components/Register.js`; `Password.js` |
| Per-attempt capture settings in the benchmark log | `backend/benchmarkStore.js` (`deviceInfo`); `docs/BENCHMARKING.md` |
| Upload cap 100 MB | `backend/server.js:76-78` |
| External STT dependency (Google speech API) | `backend/speechToTexty.py:11,29-32` |
