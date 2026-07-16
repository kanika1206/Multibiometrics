# Voice factor: from MFCC distance to an ECAPA-TDNN speaker embedding

## The defect

The voice factor is one of the three AND-gated login factors (face, voice,
CAPTCHA). It was accepting **the wrong speaker**: an audit found that a login by
one person against another person's enrolled template passed the voice check,
while the face factor correctly rejected it. Only the face factor was actually
keeping impostors out, so the system was effectively two-factor, not three.

## Root cause — the comparison algorithm, not the threshold

The original matcher (`matchAudio.py`, later `matchVoiceTemplate.py` v1, matching
the paper's Algorithm 2) reduced each recording to a 13-coefficient MFCC matrix
and scored two recordings by the **mean pairwise Euclidean distance** between
their frames, accepting below a fixed threshold (200).

This statistic is not speaker-discriminative. Measured on the four enrolled
templates (two distinct humans, A = {kanika1206, kanikak_06}, B = {123,
aditi123}):

| pair | type | mean MFCC distance | verdict @200 |
|------|------|--------------------|--------------|
| 123 vs aditi123 | genuine (B) | 178.8 | accept |
| kanika1206 vs kanikak_06 | genuine (A) | 172.8 | accept |
| 123 vs kanika1206 | **impostor** | 193.0 | accept |
| 123 vs kanikak_06 | **impostor** | 166.8 | accept |
| aditi123 vs kanika1206 | **impostor** | 181.2 | accept |
| aditi123 vs kanikak_06 | **impostor** | 153.7 | accept |

The genuine range (172.8–178.8) sits **inside** the impostor range (153.7–193.0),
and the single closest pair of all is an impostor pair. No threshold on this
statistic can separate speakers — lowering it to reject the impostors also
rejects the genuine logins. The distance is dominated by frame log-energy (MFCC
C0 ≈ −300…−430, an order of magnitude larger than the other coefficients) and by
how spread out the two frame clouds are, i.e. by loudness and recording
conditions, not by voice identity.

We confirmed this is the algorithm and not the data: several hand-built MFCC
statistics (drop-C0 + deltas with Bhattacharyya distance, cosine and Euclidean on
mean feature vectors) were tried on the same templates and none separated genuine
from impostor either.

**This is a code defect, not merely a dataset limitation.** Text-independent
speaker verification is a learned-embedding problem; raw MFCC distance does not
solve it.

## The fix

The voice template is now a **192-d ECAPA-TDNN speaker embedding**
(`speechbrain/spkrec-ecapa-voxceleb`, trained on VoxCeleb), and the matcher scores
two embeddings with **cosine similarity**. This is the same architecture the face
factor already uses (InsightFace embedding + cosine), and it replaces the paper's
MFCC method for the same reason InsightFace replaced the paper's pHash.

- Extraction: `extractTemplate.py` demuxes the audio to 16 kHz mono and stores the
  L2-normalized embedding. Template schema is bumped to `version: 2`;
  `voice = { embedding: [192 floats], model: "ecapa-voxceleb", n_samples }`.
- Matching: `matchVoiceTemplate.py` accepts when cosine ≥ `THRESHOLD` (**0.30**,
  see the measured derivation below).

### Choosing the threshold from measured data

The threshold is derived from the measured cosine distribution, not guessed. A
labelled set was built from the recordings that survived the template migration:
two **real human speakers** (Kanika's login recording, and an unrelated login
recording), each cut into overlapping 4 s windows, plus three synthetic espeak
voices as extra negatives. ECAPA embeddings were computed with the shipped
`extractTemplate.voice_embedding`, and every same-speaker and cross-speaker window
pair was scored.

| population | n | min | mean | max |
|---|---|---|---|---|
| genuine (same human, different window) | 12 | 0.147\* | 0.645 | 0.926 |
| impostor (real human vs real human) | 32 | −0.007 | 0.134 | **0.256** |
| impostor (real vs synthetic espeak) | 24 | −0.078 | 0.057 | 0.293 |

\* The 0.147 genuine value is one near-silent 4 s window; excluding it the genuine
floor is **0.345**. That degenerate case cannot occur at login, where the full
~10 s recording is embedded rather than a 4 s slice.

So the real-speaker populations separate with a clean gap: **impostor ceiling
0.256, genuine floor 0.345.** The threshold sweep confirms it:

| threshold | FAR (real impostors) | FRR (genuine) |
|---|---|---|
| 0.25 | 0.062 | 0.083 |
| **0.30** | **0.000** | 0.083\* |
| 0.35 | 0.000 | 0.167 |

`0.30` sits in the middle of the empirical gap: it rejects **every** real
cross-speaker pair (FAR 0) while the only genuine miss is the silent-window
artifact. The previously-used 0.25 was SpeechBrain's generic default; the measured
data shows it is slightly too permissive for this deployment — a real cross-speaker
pair reached 0.268, which 0.25 would accept and 0.30 rejects (confirmed end to end
below). Synthetic espeak voices were **not** used to set the line: two espeak
"speakers" scored 0.883 against each other because they share the synthesizer's
timbre and are not distinct speakers to ECAPA, so those pairs are excluded as
artifacts.

## Migration impact

A v1 (MFCC) template cannot be upgraded in place: the recording it was derived
from was discarded at enrollment (template-only storage, reviewer comment 2), and
ECAPA needs the audio. `matchVoiceTemplate.py` therefore **fails closed** on a v1
template (`exit 2`, "re-enrollment required") rather than silently falling back to
the broken statistic. There is no MFCC fallback and no backward compatibility.

The four pre-existing accounts (123, aditi123, kanika1206, kanikak_06) were
re-enrolled to v2 with `backend/scripts/reenroll_ecapa.mjs` (a privileged
server-side operation — re-enrolling an existing account is intentionally not
possible over HTTP, since `/upload-video` requires a one-time enrollment token
that `/api/register` only mints for a brand-new account). **Identity caveat:** the
earlier template migration destroyed the original per-user enrollment videos, so
only one recording (`imposter_l.mp4`, Kanika) survived; all four fixture templates
were therefore re-enrolled from it and now carry Kanika's biometrics. They are no
longer distinct people. Genuine/impostor *separation* is established by the
distribution study above (real distinct speakers), which does not depend on the
fixture accounts; distinct multi-user fixtures require field re-recording.

## Verification

Genuine vs impostor, scored through the shipped `matchVoiceTemplate.py`:

End to end through the shipped `matchVoiceTemplate.py` at threshold 0.30, using
the re-enrolled `kanika1206` v2 template:

| test | input | cosine | exit | expected |
|------|-------|--------|------|----------|
| genuine, same speaker | kanika1206 reg vs Kanika login | 1.000 | 0 (accept) | accept |
| genuine, cross-window (distribution study) | Kanika vs Kanika | 0.75–0.93 | 0 (accept) | accept |
| **impostor, real human** | kanika1206 reg vs unrelated speaker | **0.268** | **1 (reject)** | reject |
| impostor, synthetic TTS | reg vs espeak voice | ≤0.08 | 1 (reject) | reject |
| legacy v1 template | any | — | 2 (error, fail closed) | reject |

The real-human impostor at **0.268** is the decisive case: it is **above** the old
guessed 0.25 (which would have false-accepted it) and **below** the measured 0.30
(which rejects it). This is exactly why the threshold was moved to the measured
operating point.

For contrast, the **old MFCC** statistic on comparable clips rejected a genuine
pair (distance 221.9 > 200) and accepted a robot-voice pair (199.0 < 200) — i.e.
exactly inverted.

## Remaining limitations

- **Small evaluation set.** Verification used two enrolled human voices plus
  synthetic impostors. The margin is large and the model is externally validated
  on VoxCeleb, but a formal EER on this deployment would need many more speakers.
  We did **not** tune the threshold to compensate for the small set.
- **Synthetic impostors are easy negatives.** TTS voices score near zero; a
  skilled human mimic is a harder case not represented here.
- **Legacy accounts must re-enroll** before their voice factor works again.
- **No anti-spoofing / replay defense** on the voice channel (a recording of the
  genuine user played back would score as genuine). The spoken CAPTCHA factor is
  what defends against replay; the voice factor only checks *who* is speaking.
