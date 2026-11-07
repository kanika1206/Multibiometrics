# Ordered qualification gates — current evidence, 2026-11-02

| Order | Gate | Current evidence | State |
|---|---|---|---|
| 1 | Production input inventory | Complete assembled candidate per-file inventory with runtime/code/model hashes and provenance | Static assembly complete; Windows load closure unverified |
| 2 | Windows packaging / size / first-use closure | Self-contained ZIP + offline installer script; Python/Tk/native dependencies/codecs provisioned | Assembly complete; installer/first-use execution UNVERIFIED-ON-TARGET; size measured separately |
| 3 | Inference parity qualification | Real local models run; generated-signal/audio checks pass | OPEN: consented real-media/source-model and Windows preprocessing/ASR parity |
| 4 | Target candidate execution | Approved acceptance-only runner shares production code/models/manifest, disposable isolated state; 44 development tests | D12 design conflict resolved; execution UNVERIFIED-ON-TARGET |
| 5 | Target acceptance and production qualification | No target result | OPEN; production launcher remains gated |

D7 remains OPEN until packaging execution and inference qualification evidence exists in this order. D9 code now implements versioned read-only Program Files installation and OS-resolved LocalAppData state; actual ACL/path/installation behavior remains UNVERIFIED-ON-TARGET. Neither is closed by development results.

Production manifest target_acceptance references a relative evidence file and SHA-256. Its payload_sha256 is SHA-256 of compact sorted-key JSON for manifest.files. Every required acceptance condition must be true and status PASSED. The accepted gate implementation is unchanged. Candidate acceptance additionally binds the whole candidate-inventory.json SHA-256; qualification must preserve the evaluated code/runtime/model bytes, changing only qualification metadata/evidence. There is no automated qualification command or production mode on the acceptance runner. Malicious-administrator manifest forgery is outside this local-verifier integrity mechanism's guarantee.
