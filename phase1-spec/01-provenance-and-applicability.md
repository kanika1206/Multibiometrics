Status: proposed Phase 1 specification, 1 November 2026. Documents only; implementation is NOT authorized. Submitted v1 revision: **5df0ecd0a5cb2ed8fbf6e1f8211671534189034d** (user-designated HEAD; no uncommitted submission changes). Existing files outside phase1-spec/ remain untouched. Fixed target: Windows, i5-class CPU, 8 GB RAM; phone work deferred.

# Provenance and applicability

## Authority
User decisions in this conversation govern scope and preservation. Specification Baseline 1.0 integrity is CLOSED: all six hashes match and were independently confirmed by the user. Do not re-open unless a file changes. The consolidated document is secondary to frozen sources. For bank-source interpretation: v3 amends v2; v4 wins on evaluation; v5 wins on Issues 1–3. These priorities do not import excluded bank functionality into this prototype. The architecture PDF is the implementation-facing standalone design; user constraints override conflicting deployment suggestions.

The 13 documents were read from codex-baseline-bundle.zip. Later corrections to non-frozen documents are adopted from the user's authoritative report; no claim is made that the older ZIP reflects those corrections.

| Document | Status and applicability |
|---|---|
| FREEZE-RECORD.md | Records six frozen files and precedence/change discipline; specification freeze is not evaluation freeze |
| protocol-spec-v2.md | Frozen; retain threat-boundary and evidence discipline; signing, bank stages, transactions, packs and bank services excluded |
| protocol-spec-v3-amendments.md | Frozen; joint/conditional attack acceptance, confidence intervals and measured scalability apply; tiers and financial limits excluded |
| experimental-plan-v4.md | Frozen; source for paired comparisons, held-out discipline and resource reporting; bank trial endpoints/P1/P3/tier definitions not imported |
| spec-closure-v5-issues-1-2.md | Frozen bank closure record; T/S-series not standalone prerequisites; specification closure is not tested security |
| prototype-architecture-bank.md | Frozen bank variant, subject to amendments; component ideas contextual only; no mandatory bank backend |
| product-features-bank.md | Frozen bank feature inventory; six-digit challenges, fallbacks, tiers and bank UX excluded by fixed five-digit strict-AND scope |
| build-plan-offline.md | Standalone deployment plan; local inference, lifecycle, packaging and offline tests apply; desktop shell with non-network IPC selected by user; loopback rejected |
| build-plan-scalable.md | Use slim representation/parity and population-versus-concurrency methodology; bank service implementation and in-place migration excluded |
| multimodal-prototype-architecture-report.pdf | Primary standalone design: three-sample enrollment, local verification/vault, optional sync, measured defenses; 1:N and cancelable transforms are not Phase 1 |
| evaluation-freeze-worksheet.md | Non-frozen draft; later Phase 4 input, not a completed freeze; corrected to use new evaluation-freeze-record.md |
| evaluation-freeze-starter.md | Non-frozen draft; known values are provisional until checked against code; no editing v4 to record freeze |
| attack-lab-matrix-draft.md | Non-frozen draft; adopted corrections: development/tuning then freeze then held-out; A11 mismatched A/V; physical and file-fed trials separate |

## Agreed discrepancy register
- Local STT/cloud fallback and generic versus factor-specific failures differ between current code and historical prose: resolved against pinned HEAD: local Whisper with cloud fallback and factor-specific failures are submitted behavior; never repair v1.
- 6.8/13.3 seconds are historical, machine-specific i9/62 GB-class figures per user direction. No further provenance records exist beyond repository documents. They are not comparable to the Windows/i5/8 GB target; Phase 1 must produce fresh target measurements. Do not average or infer missing historical engine/stage details.
- ASVspoof 72.10/76.17 percent are voice-only, not full-system rates.
- Expected challenge digits are memory-only; durable identifiers/status only. Snapshot rollback is outside guarantee.
- Baseline template payload remains in Phase 1; Phase 3 slimming requires parity, justified by unused enrollment frame arrays.
- Consented plaintext evalCapture is a privacy exception.
- Three-recording enrollment is new; B0 preserves submitted single-recording enrollment. Detector improvements cannot absorb enrollment/ASR effects.
- Evaluation applicability is a NEW Phase 4 artifact. No bank-specific definitions imported now. New evaluation-freeze-record.md will reference the frozen baseline without editing it.
- Plan A's no-socket/localhost inconsistency is now an explicit choice, not permission for both.

## Task mapping and sequence
Original tasks 1/2 map here (provenance and resolved submitted pin); task 3 to 02; task 4 to 03; task 5 to 04; task 6 to 08; task 7 to 05; task 8 to 06; task 9 to 07; task 10 to 03; task 11 to 09; task 12 to 10. Five phases remain offline core, deepfake layers, scalability/resource qualification, evaluation freeze, headline evaluation.

## Recorded host and baseline inputs
Review host: Ubuntu 24.04.4 LTS, kernel 6.17.0-40-generic, Intel Core i9-12900, OS-visible RAM 67,113,635,840 bytes (about 62.5 GiB). No Windows version is detectable on this running host. It is not the specified reference target.
User designated submitted commit 5df0ecd0a5cb2ed8fbf6e1f8211671534189034d (HEAD), with no uncommitted changes included in the submission. Pin is resolved. Exact Windows version/build and exact i5 model remain unspecified placeholders; 8 GB RAM is fixed. The Ubuntu/i9 host is development-only: no measurement from it may be reported as a target result. No benchmark records exist beyond repository documents; historical i9/62 GB-class timings are contextual only. Model versions/hashes will be resolved by implementation provisioning, not invented in this specification.

## Decision record — user designation

The four decisions above are recorded without modifying v1 or frozen documents. Git HEAD was checked read-only and matches the designated full SHA. All former pin-dependent source descriptions now refer to that revision. Source pinning does not resolve unmeasured compatibility, untracked model hashes or missing Windows target details. Implementation remains NOT authorized.
