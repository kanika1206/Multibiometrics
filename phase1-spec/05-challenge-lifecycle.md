Status: proposed Phase 1 specification, 1 November 2026. Documents only; implementation is NOT authorized. Submitted v1 revision: **5df0ecd0a5cb2ed8fbf6e1f8211671534189034d** (user-designated HEAD; no uncommitted submission changes). Existing files outside phase1-spec/ remain untouched. Fixed target: Windows, i5-class CPU, 8 GB RAM; phone work deferred.

# Local challenge lifecycle

Expected digits exist ONLY in process memory. Persistent records contain opaque attempt ID, claimed identity binding, lifecycle status and non-secret bookkeeping; no expected value, transcript or digit hash (the five-digit space is enumerable). Five-minute lifetime; single use on first submission regardless of outcome.

## Generation and binding
Use Windows OS-backed CSPRNG; unbiased rejection sampling over integers 0..99999, formatted as exactly five digits. Never Math.random/modulo-biased mapping. Generate an independent >=128-bit random attempt ID and enforce uniqueness in the durable store. Bind to identity, process-session ID, capture handle and package policy. Expected digits are not accepted from the caller. Persist ISSUED identifier/status before display; if persistence fails, do not display. New issuance invalidates any older outstanding attempt for that identity. No digits in logs, crash reports or persistent UI state.

## State transitions
| From | Event | Durable next state / result |
|---|---|---|
| None | Successful creation | ISSUED; display only after durable commit |
| ISSUED | Valid submission | Atomic compare-and-set to CONSUMED before inference; one owner |
| ISSUED | Expiry/cancel/new challenge | INVALIDATED; erase memory value |
| ISSUED | Startup recovery | INVALIDATED; old process values cannot be reconstructed |
| CONSUMED | Complete verified factors and durable completion | SUCCESS; release one ACCEPT |
| CONSUMED | Any mismatch/error/cancel | FAILURE; no retry with same ID |
| CONSUMED | Crash/restart before terminal state | INVALIDATED/INTERRUPTED terminal record; never return to ISSUED |
| Any terminal state | Submission/replay | Reject without inference |

Store transition and verifier ownership must be transactional. If concurrent requests race, only the successful consume transaction proceeds. Failure to commit denies. Completion after expiry also denies. A response lost after SUCCESS does not authorize reuse; the user obtains a fresh challenge.

## Time and restart
Use monotonic elapsed time for the 300-second budget within the issuing process. Compare elapsed wall time too: use the larger nonnegative elapsed interval; observed backward wall-clock motion, monotonic reset, suspend/resume or timing discontinuity invalidates outstanding challenges. This conservative suspend policy avoids extending lifetime on clocks that exclude sleep. Never reconstruct remaining validity from persisted wall timestamps after restart. A submission at or beyond 300 seconds is expired. No clock correction grants additional lifetime.

## Verification cases
Test 00000/00001/99999 formatting and generator range/bias implementation; duplicate attempt ID collision handling; identity/capture mismatch; simultaneous submissions; repeated submission after success and failure; expiry immediately before/at/after deadline; crash before issue commit, after commit/before display, after display, before/after consume commit, during inference, before/after completion commit and before response delivery; restart before/after consumption; backward/forward clock changes; suspend/resume; store-write failure. Assert no second owner/inference/grant and no expected digits retained. Use controlled test clocks and deterministic RNG injection only in isolated future test harness, never production.

## Security boundary
This handles intact-store concurrency/crashes/replay, not restoration of older disk/VM/process snapshots or a device-controlling attacker. CSPRNG challenges can repeat digit values; a fresh ID cannot by itself detect old media that happens to contain the same digits. No PAD/liveness claim in Phase 1. Durable identifiers do not constitute hardware anti-rollback counters.
