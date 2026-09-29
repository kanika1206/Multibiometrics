# SPACE 2026 (LNCS) — correction plan, evidence and change log

Status (2026-09-29): **proposal only. `main.tex`, `refs.bib`, the abstract, the conclusion,
τf = 0.35 and τa = 0.30 are unchanged.** Nothing below is applied to the paper until each item
is approved. Every number is copied from the result files listed in §2; nothing is estimated.

---

## 1. What was done in this session

| Work | Outcome | Files |
|---|---|---|
| CREMA-D attack evaluation (splice, replay/challenge) | Done, CIs, rule-of-three for zero cells | `datasets/eval/attack/res_cremad_attacks.json`, `RESULTS_FINAL.md` |
| ASVspoof 2019 LA + PA against the deployed voice matcher at τa = 0.30 | Done, dev + eval, single + multi enrolment; re-run reproduces stored results (0 differences) | `datasets/eval/attack/res_asv_LA.json`, `res_asv_PA.json` |
| MAIN re-scored in both directions | No approved MAIN number changes | `datasets/eval/res_main_bidir.json` |
| Page budget for LNCS | Measured on scratch copies only | `datasets/eval/PAGE_BUDGET.md`, `page_budget.json` |
| CORS lock-down (code) | `app.use(cors())` replaced by an origin allow-list; tests 9/9, full backend 46/46 | `backend/corsPolicy.js`, `backend/tests/cors.test.mjs`, `backend/server.js`, `backend/config.js`, `docs/DEPLOYMENT.md` |
| Paper claim audit (liveness / PAD / deepfake / replay / phishing) | 20 overstatements found; replacements proposed in §4 | this file |

Not changed: ECAPA-TDNN model, InsightFace model, τf, τa, fusion logic, any experimental result.

---

## 2. Evidence base (numbers to be preserved exactly)

### 2.1 Deployed voice factor (from the code)
- Model: ECAPA-TDNN speaker embedding, `speechbrain/spkrec-ecapa-voxceleb`, 192-d, 16 kHz
  (`backend/extractTemplate.py:71–73, 190`).
- Decision: cosine ≥ `THRESHOLD = 0.30` (`backend/matchVoiceTemplate.py:50`); single-recording
  enrolment; clips < 1 s are refused by the encoder (counted as rejections).
- **No anti-spoofing / countermeasure / PAD component exists anywhere in the codebase.**

### 2.2 Spoken challenge (from the code)
- `backend/server.js:68`: `svgCaptcha.create({ charPreset: "0123456789", size: 5, noise: 2 })`
  — digits only, exactly 5, text kept server-side, only an SVG sent to the client.
- `backend/captchaStore.js:11`: `TTL_MS = 5 * 60 * 1000` (5-minute validity);
  `:16` one live code per username; `:48–52` `takeCaptcha` deletes the code before use
  (single-use, also on failure).
- `svg-captcha/lib/random.js`: `Math.round(min + Math.random()*(max-min))` → **not uniform**
  (digits 0 and 9 at p = 1/18, 1–8 at p = 1/9); `Math.random` is not a CSPRNG.
- Analytic (NOT measured): two independent codes coincide with p = 1.273 × 10⁻⁵ (≈ 1/78,583);
  a specific old code is re-issued with p between 5.29 × 10⁻⁷ and 1.694 × 10⁻⁵ (≈ 1/59,049).

### 2.3 Identity performance (CREMA-D, voice factor, deployed thresholds)
95% actor-level bootstrap, 5,000 replicates, seed 20260927.

| Protocol | FAR | FRR | EER @ EER threshold |
|---|---|---|---|
| MAIN (91 actors, different sentences) | 10,069/583,214 = 1.73% [1.40, 2.14] | 364/5,941 = 6.13% [4.52, 7.88] | **3.15% [2.60, 3.71] @ 0.267** |
| SECONDARY (different emotions) | 964/36,855 = 2.62% [2.08, 3.25] | 62/273 = 22.71% [16.85, 28.94] | 8.73% [6.54, 10.90] @ 0.222 |

Face ∧ voice on MAIN: FAR 0/583,214 observed (rule-of-three ≈ 3/583,214), FRR 364/5,941 = 6.13%.
The challenge factor was **not** evaluated on CREMA-D (no spoken digits), so these are not
three-factor system rates.

### 2.4 Spoofing (ASVspoof 2019 eval, voice factor only, τa = 0.30, single-utterance enrolment)
95% speaker-level bootstrap, 5,000 replicates, seed 20260927. ASVspoof has no face and no
challenge, so **no system-level number exists**.

| | LA (TTS / VC) | PA (replay) |
|---|---|---|
| FRR (genuine rejected) | 15/5,370 = 0.28% [0.13, 0.47] | 565/12,960 = 4.36% [2.93, 6.05] |
| FAR (zero-effort impostor) | 2,096/33,327 = 6.29% [3.21, 10.32] | 10,646/123,930 = 8.59% [5.72, 12.06] |
| EER genuine vs impostor | 1.26% [0.67, 1.99] @ 0.387 | 6.06% [4.53, 7.69] @ 0.322 |
| **Spoof acceptance** | **46,062/63,882 = 72.10% [70.09, 73.95]** | **88,841/116,640 = 76.17% [72.73, 79.33]** |
| EER genuine vs spoof | 29.29% [27.65, 30.88] @ 0.582 | 37.22% [36.30, 38.11] @ 0.481 |

Multi-utterance (ASVspoof protocol) enrolment, for reference: LA spoof acceptance
48,239/63,882 = 75.51% [73.81, 77.19]; PA 95,560/116,640 = 81.93% [79.28, 84.40].
Per attack (eval, single): LA A14–A16 98.7–99.2%, A07/A08/A10–A12 90–96%, A09 10.0%, A17 9.3%;
PA from 86.3% (AA) down to 63.4% (CC).

### 2.5 CREMA-D attack results (RESULTS_FINAL.md, Table 1)
| Attempt | System result |
|---|---|
| Genuine control | 5,577/5,941 = 93.87% [92.12, 95.48] — assumes the STT step passed |
| Victim face + attacker's live voice | 8,075/531,026 = 1.52% [1.21, 1.90] (challenge assumed answered) |
| Attacker face + victim's archived voice | 0/531,026 observed; rule-of-three ≈ 3/531,026 |
| Replay of archived clip | 0/5,941 (structural: corpus contains no digit strings; not a test of replaying a prior code) |

### 2.6 Code tests
- CORS tests: **9/9 pass** (`backend/tests/cors.test.mjs`).
- Full backend suite: **46/46 pass** (`npm test`).

---

## 3. Terminology the paper must keep separate

The overstatements in §4 all come from one conflation: the spoken challenge is called a
"liveness" mechanism. The three properties are different, and the evidence differs for each:

| Property | What it tests | Implemented? | Evidence |
|---|---|---|---|
| **Speaker / face verification (identity)** | Is the sample close to the enrolled template? | Yes (ECAPA ≥ 0.30, InsightFace ≥ 0.35) | CREMA-D voice EER 3.15% @ 0.267 |
| **Challenge–response freshness** | Was the recording made after this challenge was issued? | Yes (5 digits, single-use, 5 min) | Code; analytic ≈ 1.3 × 10⁻⁵ |
| **Presentation-attack / liveness detection** | Is the sample from a live person, not a replayed / synthetic / converted artefact? | **No** | ASVspoof: 72.10% (LA) / 76.17% (PA) of spoofs accepted |

**Proposed new paragraph** (System Model, after Eq. (3) for $b_c$):

> Three properties are kept distinct throughout. *Speaker and face verification* establish
> identity: $b_a$ and $b_f$ test whether the login sample is close to the enrolled template, and
> do not test whether it comes from a live person. *Challenge–response freshness*: $b_c$ tests
> that the recording contains the digits issued for this attempt, so media recorded before the
> challenge was issued cannot pass; it does not test whether the speech is live, replayed live,
> synthesised or converted. *Presentation-attack (liveness) detection*, deciding whether a sample
> originates from a live person rather than an artefact, is not implemented in the deployed
> scheme.

---

## 4. Claim-by-claim corrections (line numbers = current `main.tex`, tracked changes accepted)

For each: **(a)** current claim, **(b)** proposed replacement, **(c)** why it is supported.

### Voice liveness / PAD

**4.1 Abstract, l.80**
- (a) "…the spoken challenge simultaneously serves as a liveness cue and as a session-binding
  nonce, which raises the cost of replay and phishing-relay attacks."
- (b) "…the spoken challenge serves as a single-use, session-binding nonce, so a recording made
  before the challenge was issued is not accepted; it is a freshness check, not a
  presentation-attack detector."
- (c) No PAD exists (§2.1); a live relay is not prevented (paper's own threat model l.219/223).

**4.2 Contributions, l.223**
- (a) "…because the challenge is generated server-side and is unpredictable to the adversary, a
  previously recorded video cannot satisfy the current challenge, which mitigates video reuse
  and replay attacks. …the spoken CAPTCHA additionally provides a challenge–response liveness
  cue…"
- (b) "The dynamic CAPTCHA is a per-session nonce: it is generated server-side, never sent to the
  client as text, consumed on first use and valid for five minutes, so a recording made before
  it was issued matches it only by chance (analytically ≈ 1.3 × 10⁻⁵ per attempt for the
  deployed digit distribution). This mitigates reuse of previously captured recordings. It is a
  freshness check, not a liveness test: it does not detect replayed, synthesised or converted
  speech that says the current code. The challenge is bound to the same recording that supplies
  the face and voice evidence."
- (c) §2.2 (code, analytic probability); CREMA-D replay 0/5,941 is structural only (§2.5);
  ASVspoof shows the voice factor accepts synthetic/replayed speech (§2.4).

**4.3 l.405**
- (a) "Dynamic CAPTCHA reduces video reuse/replay attacks and adds to the liveliness detection of
  a specific user."
- (b) "The dynamic CAPTCHA prevents reuse of a recording made before the challenge was issued; it
  does not by itself establish liveness."
- (c) As 4.2.

**4.4 Challenge handling l.399 and Algorithm comment l.832**
- (a) "…a client that knows the expected text can satisfy the challenge without a live
  utterance."
- (b) "…a client that knew the expected text could prepare a matching response before the
  attempt."
- (c) The check proves the utterance post-dates the challenge, not that a live human spoke it.

**4.5 `tab:recent` Proposed row, l.257 (Liveness / Challenge cell)**
- (a) "Challenge-response liveness cue (not full PAD)"
- (b) "Spoken challenge–response (freshness only); no PAD"
- (c) §2.1.

**4.6 `tab:recentsec` caption, l.263**
- (a) "liveness is a challenge-response cue, not a complete presentation-attack detector"
- (b) "the spoken challenge is a freshness check; no liveness or presentation-attack detector is
  implemented"
- (c) §2.1.

**4.7 `tab:recentsec` Proposed row, l.276 — Liveness/PAD column**
- (a) ✓
- (b) ✗
- (c) No PAD implemented; 72.10% / 76.17% spoof acceptance (§2.4).

**4.8 Positioning l.280, comparison items l.285 and l.288**
- (a) l.280 "…shares the spoken challenge and liveness properties…"; l.285 "adds a
  challenge-response liveness cue"; l.288 "both use a random spoken challenge for liveness".
- (b) l.280 "…shares the spoken challenge; that work additionally reports a PAD stage and a
  spoof-video evaluation, which the present scheme does not have…"; l.285 "adds a spoken
  challenge–response freshness check (no presentation-attack detection)"; l.288 "both use a
  random spoken challenge; there it is paired with PAD, here it provides freshness only".
- (c) Row l.256 lists that work's "liveness + PAD"; §2.1.

**4.9 Evaluation scope, l.291**
- (a) "…the spoken challenge is a liveness cue rather than a complete presentation-attack
  detector."
- (b) "…the spoken challenge is a freshness check and no presentation-attack detector is
  included; on ASVspoof 2019 the speaker factor accepts 72.10% (LA) and 76.17% (PA) of spoofed
  trials at τa = 0.30."
- (c) §2.4.

**4.10 Conclusion, l.723**
- (a) "…with a challenge-bound liveness cue…"
- (b) "…with a single-use spoken challenge that binds each login recording to the current attempt
  (freshness), rather than a liveness detector…"
- (c) §2.1–2.2.

**4.11 Conclusion / limitations summary, l.727**
- (a) "The liveness argument rests on the unpredictability of the challenge rather than on an
  explicit presentation-attack detector."
- (b) "The scheme has no presentation-attack detector: the spoken challenge establishes
  freshness, not liveness, and the deployed speaker factor (τa = 0.30) accepts
  46,062/63,882 = 72.10% of ASVspoof 2019 LA and 88,841/116,640 = 76.17% of PA spoofed trials."
- (c) §2.4.

### Deepfake / synthetic-voice resistance

**4.12 Threat model, l.219 (out-of-scope list)**
- (a) "…synthesising a real-time deepfake that reproduces an unpredictable challenge within the
  session window are outside the scope…"
- (b) keep, and add: "…and speech synthesised or converted in the victim's voice, including
  concatenation of pre-recorded digits, which the speaker factor does not detect."
- (c) Five digits of target-voice speech are cheap to produce offline, so "real-time deepfake"
  understates the attack; ASVspoof LA (TTS/VC) 72.10% accepted. Digit concatenation itself was
  **not tested** and must be stated as such.

**4.13 `tab:2` (Bonneau), l.688 Resilient-to-Targeted-Impersonation, Proposed column**
- (a) ✓
- (b) ◐ (`\ymark`), caption note: "partial: synthetic or converted voice is not detected
  (ASVspoof 72.10% / 76.17%) and face presentation attacks were not evaluated."
- (c) §2.4; face PAD not measured.

### Replay resistance

**4.14 `tab:recent` Proposed row, l.257 (Replay cell)**
- (a) "✓ (previously recorded video/challenge)"
- (b) "✓ recordings made before the challenge; ✗ synthetic or converted speech"
- (c) §2.2 freshness; §2.4 PA replay of the target voice accepted 76.17% at the voice factor.

**4.15 `tab:recentsec` Proposed row, l.276 — Replay column**
- (a) ✓
- (b) ◐ (partial: pre-issued recordings only), legend entry added to caption.
- (c) As 4.14.

**4.16 Algorithm Login/Challenge, l.829**
- (a) "five symbols drawn uniformly at random from the challenge alphabet Σ"
- (b) "five digits drawn server-side by the CAPTCHA library (`Math.random`; digits 0 and 9
  occur with probability 1/18, the others 1/9)"
- (c) §2.2 (`svg-captcha/lib/random.js`). The current text is false, and the replay
  probability in 4.2 depends on it.

**4.17 Threat model security argument, l.219**
- (a) "…the AND-based fusion rule requires every factor to be verified, so compromise of any
  single modality is insufficient"
- (b) "…the AND rule requires every factor to pass, so control of one modality is not sufficient
  on its own: on CREMA-D, the victim's face combined with the attacker's own voice passed
  face ∧ voice in 8,075/531,026 = 1.52% of trials (challenge assumed answered)."
- (c) §2.5 — a single compromised modality succeeds 1.52% of the time, not never.

### Phishing resistance

**4.18 l.236**
- (a) "Our scheme also provides resistance to phishing attacks."
- (b) "Because no reusable secret is entered and each login recording is bound to a single-use
  challenge, material harvested by a phishing site cannot be replayed later, and the API accepts
  browser requests only from the configured frontend origin. The scheme does not prevent a
  real-time relay (Section~\ref{sec:model})."
- (c) §2.2; CORS allow-list implemented and tested (§2.6, §6); relay limitation is the paper's
  own threat model.

**4.19 `tab:recentsec` Proposed row, l.276 — Phish/MITM column; `tab:2` l.699 Resilient-to-Phishing**
- (a) ✓ / ✓
- (b) ◐ / ◐, note: "replay-based phishing and cross-origin phishing pages only; real-time relay
  not prevented."
- (c) As 4.18.

**4.20 Abstract motivation, l.80**
- (a) "2FA/MFA … fail to protect against … real-time MITM, control relay MITM…"
- (b) keep; add in the abstract or contributions: "The scheme likewise does not prevent real-time
  relay."
- (c) Without it a reader infers the scheme solves relay; the CORS allow-list blocks only
  browser-page relays, not a server-side proxy (no `Origin` header).

### Related (outside the five categories, same root cause)
- `tab:recent` l.257 last cell "fused FAR 0 observed, FRR 6.13%" → "face ∧ voice FAR 0 observed,
  FRR 6.13%; voice EER 3.15% @ 0.267; ASVspoof voice spoof acceptance 72.10% (LA) / 76.17% (PA)".
- `tab:accuracy` l.608, 609, 613 and prose l.595, 618, 620, 629: "Fused AND" → "face ∧ voice"
  (challenge not evaluated). Tested content-only LaTeX for the table is in
  `datasets/eval/PAGE_BUDGET.md`; it also removes the 1.4 pt overfull box.
- l.727 still says "no FAR/FRR/EER is reported" and "external speech-to-text service"; both are
  out of date (CREMA-D error rates are in the paper; local faster-whisper is the default).
- `backend/matchVoiceTemplate.py:33` docstring says 0.30 "gives FAR = 0 on the real impostor
  pairs" — true only of the early 3-identity corpus; CREMA-D measures 1.73%. (Code comment, not
  paper; not changed.)

---

## 5. New Limitations paragraph (proposed, `sec:limits`)

> *Spoofing of the voice factor.* The speaker factor is an identity test, not a spoof detector.
> On CREMA-D it separates speakers well (voice EER 3.15% at EER threshold 0.267), but on ASVspoof
> 2019 at the deployed τa = 0.30 it accepts 72.10% of logical-access (TTS/VC) and 76.17% of
> physical-access (replay) spoofed trials, and genuine and spoofed trials overlap so strongly
> (genuine-vs-spoof EER 29.29% LA, 37.22% PA) that no threshold on this score would separate
> them; τa was therefore not retuned. Protection against spoofed voice rests on the other factors
> and on challenge freshness; face presentation attacks, a real-time voice clone speaking the
> fresh code and digit concatenation were not evaluated, and a dedicated presentation-attack
> detector is future work.

Reasoning: states the identity result and the spoofing result side by side, explains why
retuning cannot help (spoof-EER thresholds 0.48–0.58, errors still 29–37%), and lists what was
not measured instead of implying it.

---

## 6. Code change made: CORS (applied, tested)

**Problem.** `backend/server.js` had `app.use(cors())` (every origin allowed). A phishing page on
any domain could call `/captcha`, `/upload-video-login` and `/api/login` from the victim's
browser and read the replies — the building blocks of a live relay.

**Fix.**
- New `backend/corsPolicy.js`: allow-list from `CORS_ORIGINS` (exact `scheme://host[:port]`,
  comma-separated; paths, `*` and non-origins stop the server at startup).
- Any request whose `Origin` header is not listed gets **403 before any route runs** — needed
  because GETs and multipart uploads are "simple" requests the browser sends without preflight.
- Unset: development allows `http://localhost:3000/3999` and `127.0.0.1` equivalents only;
  production allows no cross-origin browser access and logs a warning.
- Requests without an `Origin` header (curl, same-origin page loads) are unaffected.
- `backend/config.js` is git-ignored, so `server.js` falls back to reading `CORS_ORIGINS` from the
  environment if an older `config.js` lacks it (avoids a startup crash on a fresh clone).
- `docs/DEPLOYMENT.md` updated.

**Tests.** `backend/tests/cors.test.mjs` 9/9 (allowed origin, foreign origin, foreign multipart
upload never reaches the handler, preflight allowed/refused, no-Origin request, empty list,
parsing incl. rejection of `https://*.example.com`); full backend suite 46/46.

**Deployment action required.** Set `CORS_ORIGINS=<frontend origin>` in `backend/.env` and restart
the backend, or the live frontend receives 403. Update it whenever the frontend tunnel URL
changes.

**Scope.** Blocks a phishing *page* driving the API from the victim's browser. Does not block a
relay that proxies traffic through its own server. Not committed.

---

## 7. Is the voice scheme good enough for SPACE 2026?

- **Acceptable as an identity factor:** CREMA-D voice EER 3.15% @ 0.267; ASVspoof LA
  genuine-vs-impostor EER 1.26%.
- **Not acceptable as an anti-spoofing factor:** 72.10% (LA) / 76.17% (PA) spoof acceptance at
  τa = 0.30. Acceptable for submission **only if the claims in §4 are corrected.**
- **Main weakness:** ECAPA encodes *who* speaks, not *whether the voice is real*; synthetic,
  converted or replayed target-voice speech scores like the target. The challenge stops only
  media recorded *before* the challenge; TTS speaking the fresh digits defeats both the voice
  factor and the challenge.
- **Is an anti-spoofing model necessary?** Only if the paper keeps spoof / deepfake / liveness
  claims. With the §4 corrections the paper is honest without one.
- **Lowest-risk improvement:**
  1. *(chosen by this plan)* correct the claims and report the ASVspoof numbers as a measured
     limitation — no code, model, threshold or result changes;
  2. *(optional, needs approval + model download)* evaluate a pretrained audio countermeasure
     (e.g. AASIST, ASVspoof 2019 LA-trained) as a separate extra AND check, measurement-only
     first: LA eval spoof rejection and CREMA-D genuine false-rejection cost. PA would need a
     PA-trained model; generalisation to unseen deepfakes is limited.

---

## 8. LNCS conversion and page budget (from `datasets/eval/PAGE_BUDGET.md`)

- `main.tex:1` is still `\documentclass[10pt,journal,compsoc]{IEEEtran}`; as-is build 28 pages
  (includes all 52 struck-out passages).
- **Anonymisation breach:** `main.tex:65–68` author names and institution — must be removed for
  double-blind.
- Scratch LNCS rendering (changes accepted, `llncs` + `splncs04`, anonymous author):
  **47.8 pp**. All measured Low/Med-harm cuts together (variant B, keeps Figs. 4–5): **25.3 pp**.
  Target 17.5 pp (+1.5 pp attack section → ≤ 20 pp) needs ≈ 7.8 pp more from rewriting (Security
  Mechanisms, recent-system comparison, Sect. 4 prose). Ranked cut list with measured savings is
  in `PAGE_BUDGET.md`.
- Every wide `table*` overflows LNCS width by 118–177 pt and must be re-laid-out.
- `tab:recentacc` (protected) is not yet in `main.tex`; space is reserved in the budget.
- Tooling: no pdflatex/bibtex on this machine; builds used Tectonic (XeTeX + BibTeX).

---

## 9. Decisions needed before any paper edit

1. Approve §3 paragraph and §4 items (all, or by number).
2. Where the ASVspoof numbers live: §5 Limitations paragraph, the planned attack-evaluation
   section, or both.
3. LNCS template switch + anonymisation fix (prerequisite for real page counts).
4. Page-budget variant (A or B) and which rewrite items to take on.
5. Whether to run the optional countermeasure measurement (§7, option 2; needs a download).
6. Commit of the CORS change (currently uncommitted; project rule: no git operations by the
   assistant).
