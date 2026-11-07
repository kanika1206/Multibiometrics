Status: proposed Phase 1 specification, 1 November 2026. Documents only; implementation is NOT authorized. Submitted v1 revision: **5df0ecd0a5cb2ed8fbf6e1f8211671534189034d** (user-designated HEAD; no uncommitted submission changes). Existing files outside phase1-spec/ remain untouched. Fixed target: Windows, i5-class CPU, 8 GB RAM; phone work deferred.

# Compatibility tests (planned, not executed)

The submitted source oracle is pinned to 5df0ecd0a5cb2ed8fbf6e1f8211671534189034d, with no uncommitted submission delta. Numerical oracle results and binary asset hashes still require future authorized baseline runs/inventory; the pin alone is not measured evidence. Never checkout/reset or execute v1 in its existing working tree; future baseline runs require an isolated authorized copy/environment and consented fixtures. If submitted STT requires networking, it is a separate disclosed baseline experiment, never part of offline acceptance. Historical 6.8/13.3-second timings are i9/62 GB-class, machine-specific context only; no further records exist beyond repository documents. Do not average, reconstruct absent provenance or report them as Windows target measurements. Phase 1 produces fresh target measurements.

| Suite | Inputs | Evidence / acceptance |
|---|---|---|
| Matcher-only | Identical JSON vectors through pinned and proposed matchers | Same formula, dimensions, normalization, threshold inclusivity and verdict for every fixture; investigate any numerical difference |
| Threshold boundaries | Finite controlled vectors giving scores below/equal/above 0.35/0.30, including nearest representable neighbors | No comparator change or rounded-score decision; boundary verdict parity required |
| Invalid inputs | NaN/infinity/zero norms, wrong dimensions, absent fields, empty frames | New implementation rejects all; any difference from baseline is explicit hardening, not an alleged baseline behavior |
| Preprocessing | Same consented recording bytes/metadata | Frame-selection and waveform comparisons; deviations reported separately from model and matcher results |
| Model conversion | Same normalized audio through source ECAPA and export; same face inputs if changed | Embedding cosine >0.99 is preliminary gate only; score delta distribution and near-threshold decision parity also required |
| ASR | Same audio, issued-code labels, candidate outputs | Report string accuracy and policy-induced decision changes independently; do not claim ASR equality |
| Enrollment | Same single-recording baseline fixtures; separate three-recording new fixtures | B0 preserves submitted enrollment; new-enrollment outcomes labeled; not credited to detectors |
| Orchestration | 64 factor combinations plus errors/races | Only all PASS and valid lifecycle grants; no missing/error bypass |
| Store/lifecycle | Controlled corruption, interrupted commit, replay, restart | Fail closed, no stale enrollment/challenge resurrection within stated boundary |

No floating tolerance may convert a threshold rejection to acceptance. Numerical tolerances for waveform/embedding diagnostics are documented from deterministic reference runs before assessing new results, not selected to hide mismatches. If a conversion changes boundary decisions, record and investigate; retain source model in the new package or qualify conversion explicitly rather than adjusting 0.35/0.30. Face model swaps/quantization are not required merely to fit an estimate.

Fixture ledger: pseudonymous subject/session, consent, recording hash, enrollment/probe relation, expected digits (restricted test labels only), baseline commit and asset hashes, runtime manifest, score/verdict pair, discrepancy class, reason and disposition. Fixture expected digits are research evidence, not runtime challenge persistence. No held-out tuning or headline claims in Phase 1.

Model/preprocessing parity, enrollment-policy changes, ASR-policy changes and later detector effects occupy separate tables. B0 must not be relabeled as new identity pipeline without detectors. A controlled new-identity/no-detector comparator will be needed to attribute later detector effects; full evaluation applicability remains Phase 4 work.
