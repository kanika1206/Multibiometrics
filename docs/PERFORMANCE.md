# Performance Evaluation

Quantitative processing-delay measurements for the multibiometric authentication
scheme, addressing reviewer comment 3 ("provide performance results that quantify
the additional processing and communication delays introduced by the proposed
scheme") and supplying the evidence for reviewer comment 1 (parallel, not
sequential, verification).

## 1. Method

These numbers are for the **template-based pipeline** (see
[TEMPLATE_STORAGE.md](TEMPLATE_STORAGE.md)); §6 compares them against the
video-based pipeline they replaced.

All numbers below are produced by `backend/scripts/measure_performance.mjs`:

```bash
cd backend
node --env-file=.env scripts/measure_performance.mjs <login_video.mp4> 5 kanika1206 48077
```

A login recording must be supplied on the command line: no recording of any user
is stored on the server any more, so there is nothing on disk to replay.

The script times each pipeline stage over N runs, then times two complete
pipelines end to end:

- **Sequential cascade** — the paper's Algorithm 1: face matching gates audio
  extraction, which gates voice matching, which gates speech-to-text. Each stage
  waits for the previous one.
- **Parallel `login()`** — what this repository implements: face matching runs
  concurrently with the audio branch, and within the audio branch voice matching
  runs concurrently with speech-to-text. All three verdicts are then combined
  with AND logic.

The parallel figure is the real `login()` controller, so it also includes AES-256-GCM
decryption, temp-directory setup and teardown, the AND decision, and JWT minting.

### Measurement environment

| Item | Value |
| --- | --- |
| CPU | Intel Core i9-12900 (24 threads) |
| RAM | 62 GB |
| Node.js | v22.23.1 |
| Python | 3.12.3 (repo venv) |
| Database | MongoDB on localhost |
| Runs | N = 5 per stage |
| Account | `kanika1206` (genuine registration + login video, spoken CAPTCHA `48077`) |

All five `login()` runs returned HTTP 200 with `face=true voice=true captcha=true`
(face cosine similarity 0.65 against the 0.35 threshold), so the timings are for
the full success path, not an early rejection.

## 2. Per-stage processing time

Times in milliseconds, N = 5. **These are the ECAPA-TDNN voice pipeline numbers**
(measured 2026-07-14, account `kanika1206`); §5 compares them against the MFCC
pipeline they replaced.

| Stage | Mean | Std | Min | Max |
| --- | ---: | ---: | ---: | ---: |
| Extract login template (`extractTemplate.py`) | 12424 | 324 | 11888 | 12779 |
| Face match (`matchFaceTemplate.py`) | 98 | 14 | 73 | 116 |
| Voice match (`matchVoiceTemplate.py`) | 104 | 23 | 83 | 138 |
| Audio extraction (`extractAudio_login.py`) | 154 | 5 | 146 | 162 |
| Speech-to-text (`speechToTexty.py`) | 2367 | 209 | 2085 | 2666 |

Template extraction from the login recording dominates overwhelmingly: it is the
one stage that loads **both** heavy model stacks — InsightFace (face) *and*
torch + ECAPA-TDNN (voice) — in a single freshly `spawn`ed interpreter, then runs
both. Adding the ECAPA embedding to this stage is what raised it from ~4.0 s (MFCC
pipeline) to ~12.4 s.

Matching itself is now almost free on both factors: face is a dot product against
the enrolled embedding (98 ms) and **voice is a 192-d cosine (104 ms)** — down
from 682 ms for the old MFCC pairwise-distance matrix, because comparing two
speaker embeddings is a single dot product, not an N×M distance matrix over MFCC
frames. So the ECAPA migration moved cost *out* of the per-login matcher and *into*
the one-time extraction spawn.

Each Python stage is a fresh `spawn`, so its time includes interpreter startup and
model/library import, not only the arithmetic — this is why extraction is so
model-load-heavy (see §6). Speech-to-text is the only stage that makes a network
call (Google Speech-to-Text); its higher mean here reflects network variance.

## 3. Sequential vs parallel end-to-end latency

| Pipeline | Mean | Std | Min | Max |
| --- | ---: | ---: | ---: | ---: |
| Sequential cascade (paper Algorithm 1) | 15320 | 507 | 14336 | 15698 |
| Parallel `login()` (this repository) | 13293 | 401 | 12571 | 13700 |

**Speedup: 1.15x — the parallel implementation saves ~2027 ms per authentication.**

The speedup is bounded by template extraction. Because extracting the login
template (12424 ms) takes far longer than the entire CAPTCHA branch it overlaps
with (154 ms audio extraction + 2367 ms speech-to-text ≈ 2521 ms), the parallel
pipeline can never finish faster than that stage plus the matching that follows
it. That is what the numbers show: 13293 ms end to end against a 12424 ms
extraction. Further latency reduction has to come from making the extraction spawn
cheaper — a warm model server that keeps InsightFace **and** ECAPA resident
instead of re-loading them on every login (see §6) — not from more concurrency.
The absolute speedup actually grew (2027 ms vs the MFCC pipeline's 1263 ms)
because the CAPTCHA branch that parallelism hides behind extraction is now larger,
but the *ratio* fell to 1.15x because the extraction stage it runs under grew
faster still.

Note that the sequential cascade is being timed on a *genuine* login, where every
stage runs. On a rejected login the paper's cascade short-circuits and can be
faster — that is its only advantage, and it is one the parallel design gives up
deliberately: running all three factors regardless of intermediate results is
what keeps the response time from revealing *which* factor failed.

## 4. Communication overhead

| Item | Value |
| --- | --- |
| Login video uploaded per attempt | 11.18 MB (`imposter_l.mp4`) |
| **Stored per user (template)** | **147 KB** (`kanika1206`, v2 ECAPA template) |
| Previously stored per user (video) | 11.18 MB (raw recording) |
| Encryption size overhead | 34 bytes (6-byte `MBENC1` magic + 12-byte IV + 16-byte GCM tag) |

The upload is unchanged — the client still sends one video — but the server now
keeps a **74x smaller** artifact, and one that is not replayable. The v2 template
adds a 192-float ECAPA voice embedding but drops the far larger MFCC matrix, so it
is no bigger than the v1 template. AES-256-GCM is a stream cipher mode, so
ciphertext length equals plaintext length; the only storage cost is the 34-byte
header.

Estimated upload time for the 1.49 MB clip, by uplink bandwidth:

| Uplink | Estimated upload time |
| --- | ---: |
| 5 Mbps | ~2.4 s |
| 10 Mbps | ~1.2 s |
| 25 Mbps | ~0.5 s |
| 50 Mbps | ~0.24 s |
| 100 Mbps | ~0.12 s |

These are computed from the file size, not measured over a live link, and exclude
TLS handshake and HTTP overhead. On a typical home uplink the upload is a
noticeable fraction of total login latency but remains smaller than face matching.

## 5. MFCC voice pipeline vs. ECAPA voice pipeline

The voice factor was migrated from an MFCC pairwise-distance matcher to an
ECAPA-TDNN speaker embedding (see [voice-verification.md](voice-verification.md)
for the correctness reason — the MFCC statistic was not speaker-discriminative).
The performance trade of that migration:

| | MFCC pipeline | ECAPA pipeline |
| --- | ---: | ---: |
| Extract login template | 3996 ms | **12424 ms** |
| Voice matching | 682 ms | **104 ms** |
| Sequential cascade | 6257 ms | 15320 ms |
| Parallel `login()` | 4994 ms | **13293 ms** |
| Parallel speedup | 1.25x | 1.15x |

The migration **moved cost from the per-login matcher into the extraction spawn**:
voice matching dropped 6.6x (a 192-d cosine instead of an MFCC distance matrix),
but extraction rose ~3x because it now loads torch + ECAPA in the same freshly
`spawn`ed interpreter as InsightFace. End-to-end login is therefore ~8.3 s slower
per attempt — **almost entirely a model-load cost, not a compute cost** (§6). A
warm model server that keeps both models resident would remove most of it. The
correctness gain (a voice factor that actually rejects the wrong speaker) was the
reason for the change; the latency regression is the accepted price under the
current fresh-spawn architecture.

## 6. Limitations

- **N = 5, single machine, single account.** The timings are stable (std under 3%
  for every stage except speech-to-text) but come from one genuine account on one
  desktop. They are not a multi-machine or multi-user characterisation.
- **Limited accuracy dataset.** A measured genuine/impostor cosine study was run
  for the voice factor (see [voice-verification.md](voice-verification.md)): on
  real distinct speakers, impostor pairs top out at 0.256 and genuine pairs floor
  at 0.345, and the operating threshold **0.30** is chosen from that gap. But it
  rests on two real human voices; a formal FAR/FRR/EER still needs many more
  speakers. The thresholds in use are face cosine ≥ 0.35 and **voice ECAPA cosine
  ≥ 0.30**.
- **Upload times are computed, not measured.** No bandwidth-shaped upload test was
  run.
- **Speech-to-text depends on an external service.** Its latency varies with
  network conditions and is not under the scheme's control.
- **Template extraction cost is a model-load cost.** Roughly all of the 12424 ms
  is InsightFace **and** torch + ECAPA loading and embedding in a freshly spawned
  interpreter. A long-lived model process that keeps both resident would cut
  end-to-end latency substantially (it is the single biggest lever now); that is a
  deployment change, not an algorithm change, and was not attempted here.
