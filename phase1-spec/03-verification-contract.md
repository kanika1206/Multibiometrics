Status: proposed Phase 1 specification, 1 November 2026. Documents only; implementation is NOT authorized. Submitted v1 revision: **5df0ecd0a5cb2ed8fbf6e1f8211671534189034d** (user-designated HEAD; no uncommitted submission changes). Existing files outside phase1-spec/ remain untouched. Fixed target: Windows, i5-class CPU, 8 GB RAM; phone work deferred.

# Local verification contract

## Request and prerequisites
Input: opaque claimed local identity, unique attempt ID, session-bound recording handle, capture timestamps/format, and approved package/model manifest ID. Expected challenge is an internal memory-only value, never a caller-supplied expected answer. No request-supplied template, score or verdict is trusted. Template comes from identity-bound vault. Validate readiness, identity, challenge freshness and recording ownership; atomically consume attempt before inference. All prerequisites must pass independently of the truth table.

Face: normalized enrolled 512-d mean against each normalized probe frame; score = median of dot products; PASS iff finite score >= 0.35. Voice: normalized 192-d vectors; score = cosine; PASS iff finite score >= 0.30. Dimensions, norms and finite values validated; invalid values produce ERROR, not threshold comparison. No threshold tuning, score fusion or modality fallback. Sampling source is resolved against pinned HEAD; runtime compatibility tests remain unexecuted; 12-frame target specified in 08.

Challenge: exact five-character match under 07 policy, only for the bound, unexpired, consumed-by-this-request attempt. Output per factor: PASS, FAIL, MISSING, ERROR. MISSING includes absent modality; ERROR includes invalid model/runtime/data. Both deny. Future PAD gates may only further restrict access.

## Response and lifetime
Response: attempt ID, identity binding, ACCEPT or REJECT, operational status, completion timestamps, package version. ACCEPT is delivered only after durable completion state and cleanup policy succeed; it is not a bearer credential reusable for another attempt. No JWT/bank service required. Authentication rejection UI is generic in the proposed new app; operational failures such as missing model are visible and actionable without revealing biometric scores. Pinned submitted v1 exposes factor-specific failures; generic UI is a proposed new-app difference, never applied to v1.

Local restricted diagnostics: factor states, error category, timings and model IDs. No digits/transcript/media/embeddings in normal logs. Scores only in separately enabled consented compatibility evidence. No prior successful verdict is cached for a subsequent request. Worker crash/timeout, cancellation, corrupt store, unknown identity, expired/replayed challenge and incomplete response all deny; a consumed attempt is never refunded.

## Full factor-state truth table
P = PASS; F = FAIL; M = MISSING; E = ERROR. Only PPP accepts, and only if all prerequisites above hold.

| Face | Voice | Challenge | Decision |
|---|---|---|---|
| P | P | P | ACCEPT |
| P | P | F | REJECT |
| P | P | M | REJECT |
| P | P | E | REJECT |
| P | F | P | REJECT |
| P | F | F | REJECT |
| P | F | M | REJECT |
| P | F | E | REJECT |
| P | M | P | REJECT |
| P | M | F | REJECT |
| P | M | M | REJECT |
| P | M | E | REJECT |
| P | E | P | REJECT |
| P | E | F | REJECT |
| P | E | M | REJECT |
| P | E | E | REJECT |
| F | P | P | REJECT |
| F | P | F | REJECT |
| F | P | M | REJECT |
| F | P | E | REJECT |
| F | F | P | REJECT |
| F | F | F | REJECT |
| F | F | M | REJECT |
| F | F | E | REJECT |
| F | M | P | REJECT |
| F | M | F | REJECT |
| F | M | M | REJECT |
| F | M | E | REJECT |
| F | E | P | REJECT |
| F | E | F | REJECT |
| F | E | M | REJECT |
| F | E | E | REJECT |
| M | P | P | REJECT |
| M | P | F | REJECT |
| M | P | M | REJECT |
| M | P | E | REJECT |
| M | F | P | REJECT |
| M | F | F | REJECT |
| M | F | M | REJECT |
| M | F | E | REJECT |
| M | M | P | REJECT |
| M | M | F | REJECT |
| M | M | M | REJECT |
| M | M | E | REJECT |
| M | E | P | REJECT |
| M | E | F | REJECT |
| M | E | M | REJECT |
| M | E | E | REJECT |
| E | P | P | REJECT |
| E | P | F | REJECT |
| E | P | M | REJECT |
| E | P | E | REJECT |
| E | F | P | REJECT |
| E | F | F | REJECT |
| E | F | M | REJECT |
| E | F | E | REJECT |
| E | M | P | REJECT |
| E | M | F | REJECT |
| E | M | M | REJECT |
| E | M | E | REJECT |
| E | E | P | REJECT |
| E | E | F | REJECT |
| E | E | M | REJECT |
| E | E | E | REJECT |

Verify all 64 cases, exact threshold equality, immediately adjacent representable scores, NaN/infinity/zero norm/wrong dimensions, concurrent callbacks and stale responses. No result ordering may change the decision. Error taxonomy: NOT_READY, ASSET_MISSING, ASSET_INVALID, IDENTITY_UNKNOWN, TEMPLATE_INVALID, KEY_UNAVAILABLE, CAPTURE_INVALID, FACTOR_MISSING, INFERENCE_ERROR, ASR_AMBIGUOUS, CHALLENGE_EXPIRED, ATTEMPT_REPLAY, CLOCK_ANOMALY, STORAGE_ERROR, CANCELLED. These are proposed new-module errors, not changes to v1.
