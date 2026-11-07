# Phase 1 offline core — Windows candidate, UNVERIFIED-ON-TARGET

The complete offline Windows candidate and installer/run pack are in `packaging/windows-target-run.zip`. Read `packaging/target-run/README.md` before target execution. The bundle contains Python/Tk, pinned local inference dependencies, app-local VC DLLs, models, Windows codecs, installation scripts, acceptance-only entry points and evidence templates. No global runtime installation or runtime downloading is required.

Production remains locked on the CANDIDATE manifest. The separate acceptance runner uses the same frozen payload and only disposable evaluation state under acceptance-evidence; it cannot select production state. Exit archives/destroys the run, and interrupted ACTIVE runs may be resumed only by their validated evaluation ID. No script generates a passed qualification artifact.

Development suite: 44 tests pass on Ubuntu/i9, plus real-model generated-input smoke and static payload validation. These do not establish Windows behavior, biometric accuracy, native zero-network compliance or real-recording parity. B0 enrollment stays single-recording; new enrollment uses three recordings plus confirmation.

Measured full installer size and exact hashes are in `packaging/windows-target-run.metrics.json` and `packaging/target-run/SIZE-BUDGET.md`. The size target is not silently amended, and no models were substituted or quantized. See BUILD-LOG.md for open deviations. Windows installation/DPAPI/capture/ACL/lifecycle/network acceptance and consented real-media tests remain outstanding. No PAD, slimming, headline evaluation or threshold changes.
