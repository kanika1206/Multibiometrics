# Phase 1 build log

Authorization: Phase 1 only. Pinned B0 5df0ecd0a5cb2ed8fbf6e1f8211671534189034d. Development host Ubuntu/i9; all Windows behavior UNVERIFIED-ON-TARGET. Three-sample equal-weight aggregation approved. ACCEPT may open only the same process's identity-bound protected local session; never a transferable credential.

## Preservation / setup
Recorded 201 tracked paths before work in evidence/preservation-before.json. No baseline integrity re-review. Separate .venv created. First pip attempt failed because sandbox DNS was unavailable. **Deviation:** initial pip/venv invocation did not redirect temporary files; it may have used system temporary storage outside the allowed folders. No existing source files were intentionally modified. Component provisioning stopped after failure; subsequent provisioning uses TMPDIR inside offline-prototype and isolated wheelhouse. This scope mistake is disclosed, not silently omitted.

## Contracts, packaging boundary and lifecycle
Implemented explicit four-state strict AND; finite/dimension validation; median face/cosine voice scoring; three-sample aggregation; local-only ASR candidate policy; durable SQLite challenge status, memory-only digits, consume-before-inference, expiration/clock checks, suspend hook and restart invalidation. AES-GCM vault with identity/schema/model/generation AAD, transactional activation and DPAPI adapter. Tests to follow below.

No release is provisioned yet. Development dependencies are not a Windows runtime bundle. Native-library no-socket behavior requires target monitoring; Python audit hook alone cannot prove it.

## Development test results
- Core batch: 15/15 unittest methods passed on Ubuntu/i9. Includes exhaustive 64 factor-state combinations, inclusive boundaries, nonfinite input rejection, three-sample aggregation, wrong/ambiguous ASR candidates, missing assets, concurrent consumption (16 submissions / one owner), expiry/backward clock, replay/restart, completion expiry/suspend invalidation, vault atomic replacement, metadata tampering, key-loss failure and synthetic service verification.
- IPC batch: 19/19 passed after adding bounded framing, subprocess readiness failure, and Python socket-audit denial. No actual Windows shell test. A file-writing command initially used the wrong relative working directory and failed without creating those files; rerun with correct paths succeeded.
- Compatibility batch: 20/20 passed. Ten synthetic vector cases compared against exact copies of pinned v1 matchFaceTemplate.py/matchVoiceTemplate.py in tests/reference: below/equal/above and adjacent floating-point values around 0.35/0.30. No v1 execution in its original tree. No real-media/model/preprocessing/ASR parity claim. Existing v1 enrollment stays single-recording; new package aggregation uses three samples. No detector work or headline evaluation.
- Full stdout/stderr: evidence/core-tests.txt. Tests use explicit test-only synthetic inference and test-only AES wrapping, not DPAPI substitutes in production.

## Component status and limitations
| Component | Built / exercised | Outstanding |
|---|---|---|
| Isolation | 201 tracked files inventoried; own venv/wheelhouse | Broader untracked asset snapshot was not performed; no claim of exhaustive untracked preservation audit |
| Decision | strict AND, normalized speaker cosine, median face score, approved aggregation; synthetic tests | real fixture compatibility |
| Provisioning | Linux cryptography 46.0.3, numpy 2.4.6, cffi 2.1.1, pycparser 3.12 and per-file venv hashes | Windows runtime, all model assets, installer and qualified manifest NOT provisioned |
| Challenge | SQLite status, memory-only value, atomic consume, restart/expiry/clock tests | OS suspend notification wiring, all fault-injection transition cases, process-wide single-instance lock |
| Vault | AES-GCM authenticated identity/schema/model/generation metadata, stage/activate/delete, test wrapping | Windows DPAPI execution UNVERIFIED-ON-TARGET; ACL setup, backup and crash/journal forensic tests incomplete |
| ASR | deterministic acceptance policy; explicit local Vosk loader | Vosk/model not installed; real acoustic 10x20 test not run |
| Capture | Windows DirectShow ffmpeg/ffprobe interface | UNVERIFIED-ON-TARGET; binaries not provisioned; full timestamp/drop/cleanup integration incomplete |
| Orchestration | core service tested with synthetic adapter | real inference, quality-gate adapter, request timeout/cancel/session/capture/suspend integration incomplete |
| Shell / IPC | readiness-only native Tk shell and bounded inherited-pipe worker; Linux pipe tests | full enrollment/verification UI and protected encrypted content not implemented; Windows shell UNVERIFIED-ON-TARGET |
| Acceptance | checklist and target-inventory PowerShell script | not run; no zero-network acceptance claim |

## Conflicts, deviations and component stops
1. Initial provisioning temporary-directory mistake disclosed above. Subsequent downloads/install/test temporaries restricted to offline-prototype/tmp; no intentional outside source writes. Cannot claim literal zero outside-path creation for initial tool invocation.
2. Native Tk shell is an implementation proposal differing from spec 04's HTML/JS asset inventory. The shell is therefore restricted to readiness; full UI component STOPPED pending specification decision (native Tk versus an HTML desktop shell). No spec rewritten to hide this difference.
3. No qualified ECAPA export/model manifest is available in this package. Real inference/provisioning remains INCOMPLETE, not a spec impossibility and not a reason to use synthetic verification in the app. Model sizes and parity gates have not been demonstrated. Missing-asset tests pass only because the package correctly stays locked.
4. ASR adapter currently rejects multiple nonempty Vosk endpoint segments rather than concatenating them. This could reject a valid five-digit utterance split by endpointing; policy choice needs correction/qualification before integration. Component is NOT production-ready; no automatic fallback.
5. Service error response currently groups operational errors as LOCAL_VERIFICATION_ERROR; this does not yet meet all specified component-specific visible failure diagnostics. Readiness worker gives explicit missing-asset failure. Service is not connected to live shell.
6. Native library socket behavior is not prevented/proven by Python audit hooks. Full target monitoring and deployment controls remain required; zero-socket claim is NOT established.
7. Work followed component order for initial core construction but did not finish each packaging/inference gate before scaffolding independent later interfaces. This is a partial build, NOT completion of the 12-task sequence.
8. All crash-transition combinations, enrollment confirmation/replacement lifecycle integration, encrypted identity content, evalCapture retention UI, fault-time cleanup and full deadline enforcement remain incomplete. Do not mistake exposed core methods or green synthetic tests for implemented acceptance behavior.

## Final preservation and next steps
All 201 existing tracked files match before hashes; HEAD unchanged. evidence/preservation-after.json reports PASS. Specification baseline integrity was not reopened. phase1-spec/04 was appended ONLY with authorized provisioning inventory; specification rules were not changed. Existing code/config/dependencies remain untouched.

Phase 1 is NOT complete. Immediate user decision: approve native Tk UI via a separate spec amendment, or require HTML shell as inventoried (no change applied). Exact Windows build/i5 model and target access still needed for target execution. Consent/fixtures needed before participant recordings or acoustic testing. Engineering work remaining is not represented as user-blocked where it can proceed independently.

## Continuation — 2026-11-01
Native Tk approved by user; dated amendments appended to phase1-spec/02 and 04 without deleting superseded text. No change to strict AND, thresholds, five digits or zero-socket policy.

- Preservation rechecked before continuation: 201 tracked paths match original snapshot.
- Temp audit: no current-user /tmp/pip-* remnants found; original command exited, so no active provisioning process remains from it. Exact historical filenames were not recorded; exhaustive removal cannot be proven. No unrelated temp files deleted. Every provisioning invocation in this continuation uses TMPDIR and PIP_CACHE_DIR under offline-prototype; installed dependencies stay in its .venv.
- Added whole-utterance endpoint combination with conservative alternative-product bound (overflow rejects as ASR_AMBIGUOUS), encrypted identity content, explicit per-recording research-consent plumbing, allowlisted component diagnostics, lifecycle worker and native Tk enrollment/confirmation/re-enrollment/delete/content UI.
- Added inherited-pipe timeout/cancellation, identity-change locking, worker EOF cleanup, Windows capture cancellation, Windows current-user ACL setup and single-instance file lock. All Windows execution UNVERIFIED-ON-TARGET; Linux timeout tests cover direct worker termination, not Windows descendant cleanup.
- Added persistent local inference adapter: explicit local face detector/recognizer, waveform-input ECAPA ONNX contract, full-waveform digit ASR, baseline frame selection and area/count gates, ffmpeg/ffprobe local decoding. The adapter is implemented but end-to-end execution remains blocked by an unqualified/missing speaker export, Vosk model and InsightFace runtime; it cannot claim parity or completed inference gate. Runtime does NOT download assets.
- Provisioned Linux ONNX Runtime 1.23.2, OpenCV-headless 4.11.0.86, Vosk 0.3.45 and transitive dependencies into isolated environment. Initial offline install correctly failed for absent setuptools build dependency; added setuptools 80.9.0/wheel 0.45.1 to wheelhouse and retried successfully. Downloads during provisioning are not application runtime networking.
- Copied ten PRETRAINED face/ECAPA source asset files into assets/ from local caches, with byte hashes and source provenance; no participant recordings accessed. Face detector and recognizer load successfully in CPU ONNX Runtime under Python network audit hook. This is MODEL-LOAD SMOKE ONLY, not biometric parity, accuracy, native-library no-network proof or a Windows result. GPU discovery warning was emitted despite CPU provider selection; no accuracy result inferred.
- Development suite: 27/27 tests PASS (evidence/continuation-tests.txt). Includes prior 20 plus segment composition/ambiguity, encrypted content and cross-identity tamper, consent retention, worker timeout, synthetic complete enrollment-confirmation/re-enrollment/content/delete flow, specific error code. Real media tests remain not run. New aggregation differs from B0 and remains separately reported.

## Current deviation register (supersedes prior status labels, preserves history)
| ID | Status | Item |
|---|---|---|
| D1 | CLOSED operationally; historical limitation retained | Initial temp-path mistake accepted by user. No matching remnants observed; no active original command. Current provisioning confined. Historical full removal cannot be conclusively reconstructed. |
| D2 | CLOSED | Tk versus HTML conflict resolved by explicit user approval and dated amendments. |
| D3 | OPEN | Windows release/model provisioning and real-inference/parity gates incomplete; no qualified release manifest or installer. |
| D4 | CLOSED at code/unit level | ASR multi-segment handling fixed and tested. Acoustic qualification awaits consented recordings. |
| D5 | CLOSED at code/unit level | Allowlisted component-specific verification diagnostics replace blanket LOCAL_VERIFICATION_ERROR; tested unknown-identity path. Target UX unverified. |
| D6 | OPEN | Zero native-library/child-process sockets not proven. Python guard and CPU model loading are not target acceptance. |
| D7 | OPEN | Sequence deviation remains until packaging/inference gates complete. It is NOT closed by adapter code or synthetic tests. |
| D8 | OPEN (reduced) | Full Windows lifecycle/ACL/suspend/crash/backup and physical capture tests pending; all-transition crash injection incomplete. Synthetic lifecycle, content and consent plumbing now implemented. |
| D9 | OPEN release item | Runtime uses package-local state for development to respect current write boundary. Installed LocalAppData layout, installer and protection of installed/runtime paths still require release packaging. |
| D10 | OPEN | Inference adapter decodes PCM16 directly; exact pinned librosa/ffmpeg preprocessing parity remains unmeasured. This is reported separately from matching parity, never silently treated as equivalent. |

User-blocked only: exact Windows target and access; consented recordings for acoustic/real-media compatibility. Engineering qualification of export/runtime/package is still our work, not a request for user permission or data beyond those items. No new spec change proposed or applied apart from approved Tk amendment and artifact inventory.

### Import-network failure (2026-11-02, retained evidence)
Strict socket event counting exposed urllib3's import-time IPv6 capability probe (InsightFace -> Requests -> urllib3): one socket.__new__ attempt, blocked by the guard. Model smoke stopped with failure; evidence/import-network-audit.json records the stack. The previous guard-only smoke was insufficient to establish zero attempted sockets because urllib3 caught PermissionError internally. Fix under test: disable the unused IPv6 capability flag in this no-network process before third-party imports. No socket constructor is mocked, no event is whitelisted, and the guard remains active. This is not a specification relaxation. Native networking still requires target monitoring.

## Continuation — 2026-11-02 (current status)
- Before work, all 201 tracked v1 files matched the original snapshot and pinned HEAD. Final results are recorded in evidence/nov02-preservation-after.json. Frozen baseline integrity was not reopened.
- Local inference integration now executes real InsightFace detector/recognizer, Vosk small English 0.15 and locally exported waveform ECAPA. Development-only assets are distinct from production qualification. The app remains NOT_READY without a qualified release manifest.
- Export uses trained checkpoint weights, equivalent real-DFT preprocessing for ONNX compatibility, and original filterbank/encoder. Three generated-waveform comparisons and four additional dynamic-length comparisons pass; minimum cosine in the extended set is 0.999999821. This is not real-speaker parity or model qualification. Tracing warnings are retained in evidence/ecapa-export-log.txt.
- Three generated audio formats (16 kHz mono, 44.1 kHz stereo, 48 kHz mono) produce exactly equal decoded arrays versus the pinned librosa path with the same Linux ffmpeg. Windows capture/codecs and real-media parity remain unverified. Matcher comparisons and ASR differences remain separate; B0 enrollment is unchanged, new enrollment uses three recordings.
- Real-model smoke: blank frame yields no faces, silence fails challenge, speaker output finite [1,192], generated no-face video fails closed and is removed. Python socket audit is empty after the import-probe fix. No native networking/target claim.
- urllib3 import-time IPv6 probe fix: set socket.has_ipv6=False before third-party imports in the no-network worker; actual socket constructor and audit denial remain intact. Added fresh-process regression test. Original blocked attempt remains documented above and in import-network-audit.json.
- Improved allowlisted diagnostics without leaking raw exceptions; Vosk model-load failures map to explicit invalid-asset errors. Library stdout is redirected to stderr to protect JSON pipe framing.
- Added actual process-death tests at five challenge boundaries; restart rejects persisted attempts. Added cleanup-failure rejection, failed enrollment confirmation, and development/production asset separation tests. Full suite: **34/34 PASS**, evidence/nov02-tests.txt. Runtime and export environment pip checks pass. All results are Ubuntu/i9 development results.
- Added Windows candidate assembly script with overlap/path checks and explicit NOT-QUALIFIED marker; no Windows runtime supplied or assembly run. Added Windows administrative key-loss deletion/re-enrollment recovery utility; UNVERIFIED-ON-TARGET.
- Rebuilt provisioning inventory: 47,869 file records with name/version/source/SHA-256. Runtime/export environments, model archives/extracted assets and local Linux codec tools remain inside offline-prototype/. Current invocation temporaries/caches are package-local. No current-user /tmp/pip-* remnants were observed and original provisioning command has ended; historical filenames cannot be reconstructed, so exhaustive historical removal is not claimed. Any historical leftovers are inert with respect to current provisioning.

### Current deviation register (supersedes earlier status labels)
| ID | Status | Remaining scope |
|---|---|---|
| D1 | CLOSED operationally; historical limitation disclosed | Initial external temp creation accepted; original process ended, no matching remnants observed; current provisioning confined. |
| D2 | CLOSED | Approved native Tk amendment recorded with superseded text retained. |
| D3 | OPEN | Linux real-model smoke/export complete; Windows package, real-recording parity and qualified release manifest still absent. |
| D4 | CLOSED at code/unit level | Multi-segment ASR fixed; acoustic qualification pending. |
| D5 | CLOSED at code/unit level | Safe component diagnostics integrated; target UX unverified. |
| D6 | OPEN | Native-library/child-process socket absence requires target monitoring; Python audit is insufficient. |
| D7 | OPEN | Sequence deviation cannot close until packaging/inference qualification gates complete. |
| D8 | OPEN, reduced | Five process-death boundaries and synthetic lifecycle pass; Windows crash/ACL/suspend/backup/capture matrix incomplete. |
| D9 | OPEN | Development state package-local; installed LocalAppData layout and installer protections outstanding. |
| D10 | OPEN, reduced | Three generated audio formats exactly match pinned decode; real-media and Windows capture/frame/timing parity outstanding. |
| D11 | CLOSED at Python regression level | Import-time IPv6 socket attempt identified and prevented; native verification remains D6. |

No thresholds, decision rules or enrollment representation were changed. No Phase 2–5 implementation or evaluation. No additional specification relaxation applied. Phase 1 is not complete. Target acceptance must still cover fresh offline install, enrollment, at least five verifications, re-enrollment/deletion, blocked-egress and disabled-interface runs, missing assets on a separate copy, and retained network/process evidence. Windows results are UNVERIFIED-ON-TARGET.

User inputs genuinely outstanding: exact Windows version/build and i5 model plus target execution/access; consented recordings for real-media/acoustic compatibility. Remaining packaging engineering is not presented as a user decision blocker.

## Packaging continuation — 2026-11-02
- Before work: 201 tracked v1 files and pinned HEAD PASS (evidence/packaging-before.json).
- Production payload selection now excludes export environments, Linux runtime/wheels/codecs, source checkpoints, unused face age/landmark graphs, tests and data. Selected inference model bytes are unchanged. packaging/target-run/production-inventory.json records each selected file; production-inputs.zip is explicitly NOT an installer. Full Windows dependency closure remains absent; an exhaustive production release inventory cannot be claimed yet.
- Measured ZIP/Deflate model sizes: face 175,905,370 bytes compressed (191,307,687 raw); ECAPA 78,253,792 compressed (84,145,149 raw); Vosk 41,114,357 compressed (70,898,967 raw). Application/ZIP overhead is additional; see current production-size.json for totals. Windows runtime/Tk, inference DLLs and codecs are not included. <300 MB has not been established. No model substitution or quantization.
- Installed layout implemented: OS API resolves current-user LocalAppData/MultimodalOffline; vault/logs/transient/research-capture/acceptance-evidence directories, per-directory ACL hook, vault DBs in vault/, transient temp variables, no portable fallback. Recovery utility follows same layout and root lock. None of these Windows paths was created on development host. Versioned Program Files installer source applies admin/system full access and standard-user read/execute, checks input/output hashes, refuses overwrites/reparse points/uninventoried files.
- Candidate builder now requires an exhaustive, hashed Windows runtime inventory with provenance, separate safe output and safe unique asset destinations. No completed Windows installer was fabricated.
- Production Assets gate now additionally requires hashed target acceptance proof bound to the asset file list, with all required coverage fields true. Missing, partial or mismatched evidence fails closed. No real qualified manifest was created.
- Target-run pack contains single-session instructions/preflight, checklist, installer source, target inventory script, DPAPI smoke tool, two-condition case ledger and NOT_RUN evidence templates. PowerShell is unavailable on development host; all PowerShell and Windows APIs UNVERIFIED-ON-TARGET.
- Tests: first invocation from repository root failed test discovery/import resolution; rerun from package root PASS 38/38 (evidence/packaging-tests.txt). Added state layout/ACL invocation, symlink rejection, missing target-proof rejection and payload/coverage binding tests. Tests use own temporary folder; no installed Windows state touched.
- Conflict STOP: target acceptance requires end-to-end candidate execution, but production cannot launch before acceptance. Proposed separately marked acceptance-only runner with disposable evaluation state is NOT implemented. The production gate remains intact. This is a specification/workflow decision, not permission to synthesize qualification.
- D7 remains OPEN: requested closure cannot be asserted before packaging and real-inference qualification gates complete. packaging/target-run/GATES.md records actual order and pending gates. D9 implemented at code level, but full resolution remains target-unverified.

### Current deviation register
| ID | Status | Current scope |
|---|---|---|
| D1 | CLOSED operationally | Historical temp caveat retained; provisioning confined to package. |
| D2 | CLOSED | Approved native Tk amendment. |
| D3 | OPEN | Selected production inventory/size evidence available; full Windows payload, installer and parity qualification incomplete. |
| D4 | CLOSED code/unit | ASR segments; acoustic qualification pending. |
| D5 | CLOSED code/unit | Diagnostics; target UX unverified. |
| D6 | OPEN | Native/child-process sockets require target evidence. |
| D7 | OPEN | Ordered packaging/inference qualification gates not complete; cannot close by relabeling preparation. |
| D8 | OPEN | Windows lifecycle/crash/storage/capture matrix. |
| D9 | OPEN target verification; code implemented | Installed read-only versioned app and LocalAppData state layout implemented; actual ACL/path/install execution unverified. |
| D10 | OPEN | Real-media/Windows parity. |
| D11 | CLOSED Python regression | Import probe prevented; native networking remains D6. |
| D12 | OPEN — component STOP | Acceptance-before-production circularity; separate acceptance runner proposed, not implemented. |

Final packaging continuation evidence: lossless LZMA subset measured 288,336,577 bytes (11,663,423 bytes headroom before all Windows dependencies). Deflate subset 295,297,309 bytes. Candidate builder negative test correctly exits 2 for missing Windows runtime. Python source compile check PASS without bytecode writes. Final preservation PASS: all 201 tracked files and pinned HEAD unchanged (evidence/packaging-after.json). Pack inventory hashes prepared artifacts; no completed Windows installer or target pass claimed.

## Windows payload and approved acceptance runner — 2026-11-02
- Before work: all 201 tracked v1 files and pinned HEAD PASS (evidence/windows-build-before.json). Only offline-prototype/ and authorized inventory notes in phase1-spec/ are changed.
- D12 approval/design recorded BEFORE code in packaging/target-run/ACCEPTANCE-RUNNER-DESIGN.md. Acceptance and production entry points share UI, worker loop, Runtime dispatch, capture, store, ASR, models and matcher. Acceptance uses the same frozen candidate manifest without mutating it; fixed entry-point classes bypass only the production qualification prerequisite for evaluation. No mode/config/IPC switch can select production state. Production qualification/target-proof gate logic is unchanged.
- Acceptance state is under OS-resolved acceptance-evidence/runs/<random-id>/state only. All ancestor directories inside that namespace reject links/junctions. Run descriptors bind the entire candidate inventory. Normal exit archives or destroys evaluation state; a fixed recovery utility finalizes crash remnants. Completed runs cannot reopen. Neither operation addresses the production vault. Consented plaintext research capture retention is disclosed on archive.
- Shared-code development tests: 44/44 PASS (evidence/acceptance-runner-tests.txt), including production rejection of the unchanged candidate manifest, candidate tamper/extra-file rejection, safe run paths, redirected-parent rejection, archive/delete preservation of production data, and completed-run rejection. All original gate tests still pass. These are Ubuntu/i9 tests, not Windows ACL/DPAPI or target acceptance.
- Real pretrained model smoke rerun after shared-code refactoring: generated no-face media fails closed and is removed, silence challenge fails, speaker output finite [1,192], Python socket attempt ledger empty. evidence/acceptance-refactor-smoke.json. No participant recordings or headline evaluation.
- Windows provisioning completed: CPython standalone 3.12.16+20261026 includes Tk/Tcl; official Windows wheels pinned in provisioning/windows/requirements-windows.lock; local build of pure-Python srt 3.5.3; Windows-only colorama/pyreadline3 added after explicit Windows marker audit; app-local Microsoft VCLibs Desktop 14.0.33321.0 DLLs; BtbN FFmpeg/ffprobe 8.1 LGPL branch, exact archive/file hashes pinned. Model bytes remain unchanged.
- Network acquisition failures were retried only as authorized provisioning: initial sandbox DNS failure, Gyan host timeout, transient GitHub timeout. Initial SRT wheel build lacked setuptools; isolated build dependencies from the existing local wheelhouse resolved it. All provisioning temporaries/caches/artifacts stayed inside offline-prototype/; no global installation. Download logs retained. The historical D1 caveat remains; no new external temp writes are known.
- Python and FFmpeg archive hashes matched publisher release metadata; Microsoft archive SHA matched Microsoft's winget manifest. Archive and installed per-file inventories record source/version/SHA. Models remain the same local pinned assets. Target codec support floor is Windows 10 22H2 per publisher; exact target version remains unknown.
- Windows metadata dependency audit: no missing distribution requirements. Static PE imports initially found missing MSVCP140/140_1; app-local VC DLLs added. Final runtime PE scan has no unparsed binaries and remaining external imports are Windows OS/API-set DLLs. Codec PE imports recorded separately. DLL search behavior, dynamic loads, Media Foundation availability, capture drivers and native networking still require target execution.
- Production payload excludes package/build/export environments, headers/static-link libraries, tests, pip/ensurepip and unused face/source checkpoint assets. It includes two codec executables and license notices. Python isolated path config prevents user-site/environment import paths; both launchers point Tcl/Tk at bundled assets. No model quantization/substitution or template slimming.
- Complete candidate assembled at packaging/target-run/payload with 6,823 inventoried files (inventory itself separately hashed). Core/app sources match working source exactly; acceptance validates full payload closure. Production Assets rejects CANDIDATE. Final transfer bundle is packaging/windows-target-run.zip with offline install.cmd/PowerShell installer, payload, acceptance/preflight launchers, target inventory, evidence templates and monitoring/acceptance procedures. Installer uses a new versioned Program Files directory and does not install global runtimes. All Windows execution remains UNVERIFIED-ON-TARGET.
- Target preflight is a separate fixed entry point: candidate hash verification, Tk, local DPAPI roundtrip, actual local model load, generated-input checks and camera/microphone device listing. It grants no session, uses disposable evaluation state and never creates PASSED qualification evidence.

### Current deviation register
| ID | Status | Evidence / remaining scope |
|---|---|---|
| D1 | CLOSED operationally | Historical initial temp caveat retained; all current provisioning confined. |
| D2 | CLOSED | Native Tk approved. |
| D3 | OPEN target qualification | Complete Windows payload/installer bundle assembled and inventoried; target load/installation and real-media parity unverified. |
| D4 | CLOSED code/unit | Acoustic qualification pending. |
| D5 | CLOSED code/unit | Target diagnostic UX unverified. |
| D6 | OPEN | Native/child-process zero-socket acceptance requires target monitoring and validated monitor sensitivity. |
| D7 | OPEN | Packaging execution and inference parity evidence must complete in order; no development result closes it. |
| D8 | OPEN | Target DPAPI/ACL/storage/crash/capture/lifecycle matrix remains unrun. |
| D9 | OPEN target verification | Installed paths and read-only app layout implemented; Windows installation/ACL behavior unverified. |
| D10 | OPEN | Consented real-media and Windows preprocessing/ASR parity. |
| D11 | CLOSED Python regression | Native verification remains D6. |
| D12 | CLOSED design/code conflict; target verification OPEN | User-approved separate fixed acceptance runner built and tested; production gate unchanged. |

The final size decision remains the user's after the measured complete-bundle number in SIZE-BUDGET.md. No size target was silently amended. Remaining user inputs: exact Windows target/details/access and consented recordings. Phase 1 is not qualified or complete; no claim that the first Windows sitting will pass every test.

Final artifact: windows-target-run.zip = 611,266,399 bytes (611.266399 MB), SHA-256 c1cd542c5c7630e686b53836f5ada8bcc591ee1dcb8ce043a183851093006e0f. Target miss = 311,266,399 bytes. Final payload has 6,825 inventoried files plus candidate inventory. Added a fixed evaluation-only resume entry point for full application restart tests; it accepts only an ACTIVE run ID bound to the same payload and has no production mode. Source compile checks pass. Final ZIP/static validation and preservation evidence are in windows-payload-validation.json and windows-build-after.json. No Windows result is reported.

## Production-only size audit correction — 2026-11-02
User requested removal of build-only dependencies before size decision. Torch, SpeechBrain and export environments were absent, but unused wheel-bundled ONNX/ORT conversion/quantization/transformer tools, testing/benchmark code, CFFI build adapters, ONNX build sources and InsightFace GUI/dataset utilities were present. This was a packaging defect, now corrected. 599 shipped files were removed (6,825 to 6,226 inventoried payload files); required runtime helpers retained. The initial removal pass deleted 431 files / 5,403,159 bytes; subsequent removal evidence is in build-tool-removal.json. No model bytes, matcher or thresholds changed.

Production-only filtering is now part of stage_windows.py through production_exclusions.py/prune_build_tools.py, including filtered distribution RECORD metadata. Both staging runtime and candidate were corrected; provenance/hashes regenerated. An initial smoke command used an incorrect relative path and failed before execution; corrected invocation passed. Real-model generated-input smoke with excluded namespaces blocked passes, with no Python socket attempts. The actual ZIP audit verifies every packaged file hash, rejects forbidden distributions/tool paths and reports zero violations. Windows execution is still unverified. No need to infer quality/accuracy from these development checks.

Final ZIP: 608,646,900 bytes; SHA-256 1559c08cc0ce7281ba1b3649ee06054bfb231253db2d9fbaf81d87e7843d6d27. This replaces 611,266,399 bytes for the user's size decision. D13 packaging defect CLOSED at static packaging/development-smoke level; target qualification remains open under D3/D7/D9. Existing user blockers and all other statuses stand.
