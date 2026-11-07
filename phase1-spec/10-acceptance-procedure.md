Status: proposed Phase 1 specification, 1 November 2026. Documents only; implementation is NOT authorized. Submitted v1 revision: **5df0ecd0a5cb2ed8fbf6e1f8211671534189034d** (user-designated HEAD; no uncommitted submission changes). Existing files outside phase1-spec/ remain untouched. Fixed target: Windows, i5-class CPU, 8 GB RAM; phone work deferred.

# Phase 1 acceptance procedure

Future procedure only; no application, installation or tests executed this round. Reference machine exact Windows build/CPU pending user confirmation; fixed class i5/8 GB. Baseline source oracle is pinned; fixture execution is future work. IPC is desktop shell with non-network IPC; localhost/loopback exception rejected. Requirements below are not relaxed by a successful single demo.

## Setup and evidence
1. Obtain explicit implementation/test authorization later. Use the separate package and evidence directories; inventory and hash existing files per 02 before/after work.
2. Complete offline package manifest: exact version, every file hash, models, native prerequisites, supported codecs and settings. Provision/download at build time only. Copy installer to a fresh Windows test machine/VM with no application/model caches. VM tests supplement, not replace, target hardware/camera timing.
3. Record Windows edition/build, exact CPU, usable RAM, camera/mic/driver, network interfaces, package hash and local security configuration. Record cold/warm timings separately from capture; do not substitute Linux host figures.
4. Prepare process-attributed Windows connection/egress logging (including blocked events and child processes), packet capture and listener/loopback observation. Validate monitor sensitivity with a known benign probe outside the acceptance interval and label it. Packet silence alone cannot prove no connection attempts. Record unavoidable OS noise with process attribution, never silently whitelist application requests.

## Two independent network conditions
5. Block application/child-process external egress at OS firewall while interfaces remain enabled; monitor attempted DNS/TCP/UDP, listeners and background fetches. Install offline, first-launch, enroll, restart and verify. Blocked attempts count as violations, even if the application succeeds. No model cache prepared by a previous online run.
6. Repeat on a clean equivalent test instance with external network interfaces disabled at OS level; monitoring remains active. Test installer, first launch and full lifecycle. Disable alternative adapters/tunnels too. A disconnected successful run without monitoring is insufficient.
7. Strict non-network IPC is selected: application loopback sockets/listeners are failures too. No loopback exception is permitted. Monitor all application and child-process networking, including localhost.

## Functional sequence in both conditions
8. Enroll a new local identity with three accepted samples and confirmation verification; close/restart the app and verify persisted enrollment. Complete at least FIVE genuine verification attempts and retain each outcome (do not discard failures until five passes appear). Acceptance demonstration requires five successful genuine verifications; any failures remain reported and trigger investigation/retest with a new complete ledger.
9. Verify wrong identity, wrong face, wrong speaker and wrong challenge cases; include missing/error factors and all 64 truth-table harness cases. Selected fixtures must produce intended factor failures. A matching transcript by chance is recorded, not concealed.
10. Re-enroll only after existing full authentication, verify atomic new enrollment, test interruption, then delete identity; subsequent verification must fail. Test consented research capture on/off separately, recording the plaintext exception.
11. Execute challenge tests from 05, template/key tests from 06, wrong-digit/ambiguity cases from 07 and capture cases from 08. Test restart before/after consumption and backward clock. Snapshot restoration outcomes are reported outside the guarantee, never called durable-state proof.
12. On a SEPARATE installed test copy only, omit one required model/runtime/codec or corrupt an asset. Expect visible local failure, no grant, no download or alternate engine. Restore by offline reprovisioning that copy, not by modifying v1. Include a first-run empty-cache test.

## Retained artifacts and exit gate
Retain installer/component hashes, machine inventory, connection/blocked-event logs, packet captures, process tree, listener records, timestamped trial ledger, lifecycle/crash outcomes, storage/privacy audit, compatibility report and before/after preservation comparison. Restrict access: captures/logs may contain identifying metadata. Routine logs contain no expected challenge, transcript or embeddings. Test labels/score diagnostics reside only in separately consented evidence.

Pass requires zero attempted external connections in BOTH modes throughout install/enroll/verify/re-enroll/delete; the selected IPC policy also requires zero application network sockets. All missing-asset cases fail locally and loudly. Identity thresholds remain 0.35/0.30 with mandatory AND and five digits. Existing files remain unchanged. No orphan active enrollment or replay acceptance under intact-store lifecycle tests. Report all failed trials, no selective success-only ledger. Resource targets (warm <=3 s, cold <=10 s, install <300 MB) are measured separately and deviations reported; they cannot justify changing thresholds or hiding first-load fetches. Phase 1 is offline-core evidence, not deepfake resistance or headline evaluation.

Reference-result rule: the Ubuntu/i9 host is development-only. The user supplied Windows [version/build] and [exact i5 model] as placeholders, not identified hardware. Populate those details before reference-target acceptance. Produce new target timings; historical 6.8/13.3-second i9/62 GB-class figures are not target comparisons.
