# Windows acceptance — NOT RUN / NOT READY

The Windows candidate is assembled; real inference/lifecycle code and dependencies are bundled. Target qualification is incomplete. Use the approved acceptance-only runner; production remains gated.

1. Record Windows build, CPU, RAM, drivers, adapters, installer and model hashes. Complete the per-file Windows release manifest; Linux wheelhouse is not a Windows bundle.
2. Fresh offline installation with empty caches. Instrument process creation, Windows Filtering Platform allowed/blocked events, DNS, packet capture and loopback/listener creation. Validate monitor sensitivity with a labeled probe outside the trial interval. Packet silence alone is insufficient.
3. Interfaces enabled: block application AND child-process egress at OS firewall. Retain blocked events. Any attempted connection, including loopback, fails. Attribute unrelated OS traffic explicitly.
4. Clean equivalent installation with ALL external adapters/tunnels disabled: repeat complete lifecycle and monitoring.
5. In each condition: three-sample enrollment plus confirmation; restart; at least five genuine verifications (retain failures); wrong identity/face/voice/challenge; all 64 factor combinations; re-enroll after authentication; deletion; replay, expiry, clock rollback, suspend, concurrency and interrupted storage.
6. Separate installed copy: remove/corrupt required models/runtime/codecs. Visible local failure, no grant or fallback/fetch.
7. DPAPI user binding, lost key, ACLs, backup/restore, media timing, crash/transient/journal audit and consented capture on/off. No unconditional snapshot erasure claim.
8. Retain ledgers, package hashes, process/network records, storage audit, resource timings and before/after preservation evidence. Only target runs count. Nothing here establishes a pass.

Continuation additions: native Tk shell is now approved. Verify OS ACL creation and second-instance exclusion; test content encryption, lock/identity change, failed verification, cancellation, worker timeout, suspend/resume, child-process cleanup and content deletion. Consent checkbox applies to one recording and resets. Confirm research retention is local and clearly disclosed. Installed state now resolves through Windows LocalAppData into MultimodalOffline; path/ACL execution is UNVERIFIED-ON-TARGET. Do not infer target pass from synthetic lifecycle tests.
