# Corrected final Windows bundle size — 2026-11-02

Artifact: `../windows-target-run.zip`. Measured **608,646,900 bytes (608.646900 decimal MB)**. This supersedes 611,266,399 bytes: a packaging audit found unused build/export/test utilities bundled inside runtime wheels. Those files were removed and the archive rebuilt. The <300 MB target is still missed by **308,646,900 bytes**; its disposition remains the user's decision.

SHA-256: `1559c08cc0ce7281ba1b3649ee06054bfb231253db2d9fbaf81d87e7843d6d27`

Candidate inventory SHA-256: `8aba9dedeb42b2dd5775bd4a8d11b487656aa8d7d762a3718b46f83d0d9409ec`

## Top five components by actual compressed ZIP contribution

| Component | Compressed bytes | Raw bytes |
|---|---:|---:|
| Face models (detector + recognizer) | 175,905,370 | 191,307,687 |
| Windows FFmpeg + ffprobe | 108,868,516 | 263,368,163 |
| ECAPA ONNX model | 78,253,792 | 84,145,149 |
| Vosk ASR model | 41,114,357 | 70,898,967 |
| opencv-python | 39,274,231 | 113,498,866 |

## Complete group breakdown

| Group | Compressed bytes | Raw bytes |
|---|---:|---:|
| application_and_run_pack | 12,843,493 | 47,887,233 |
| models_and_codecs | 404,143,714 | 609,725,053 |
| runtime | 190,454,591 | 587,731,315 |

ZIP headers account for the difference between compressed-entry totals and archive bytes. Decimal MB = 1,000,000 bytes.

Torch, SpeechBrain, torchaudio, pytest, pip, setuptools, wheel, export/build environments and source checkpoints are not in the production payload. Removed unused ONNX Runtime conversion/quantization/transformer tooling, ONNX tools/build sources, optional testing/benchmark utilities, CFFI build adapters and unused InsightFace GUI/dataset commands. This is file packaging only: no model conversion, substitution or quantization occurred.

ONNX itself is required at runtime by ArcFace's `onnx.load`. NumPy/SciPy eagerly import small test-API helper stubs; these are retained to avoid breaking normal imports, with no pytest installation or test suites. Distribution WHEEL files are provenance metadata, not the wheel build dependency. The actual final archive audit and import-blocking real-model smoke pass on development Linux. Windows remains UNVERIFIED-ON-TARGET.

The initial 611.27 MB number is superseded. Earlier 295.30/288.34 MB subset archives also are not valid complete-installer decision figures. Current metrics and final-production-audit.json are authoritative. The production launcher remains gated.


## Amendment — 2026-11-02: installer size decision (CLOSED)

User decision: the original **installer <300 MB** target was a **pre-build estimate** and is superseded by this amendment. Earlier target text and statements that a size decision was pending remain visible above as historical, superseded wording; they no longer define a Phase 1 acceptance gate.

The measured final bundle is **608,646,900 bytes (608.65 MB)** with the specified models unmodified. A real packaging defect—build-only utilities included in runtime wheels—was removed before this decision, reducing the measured bundle from **611.27 MB to 608.65 MB**. This amendment does not excuse or reinstate that defect.

Installer size is henceforth a **reported metric for Phase 1, not a pass/fail gate**. Footprint reduction, including a minimal FFmpeg build, belongs to **Phase 3 under parity gates**; this decision does not authorize that work now. **The size item is closed as decided.**

All other statuses stand: production remains gated; Windows verification remains UNVERIFIED-ON-TARGET pending user-provided target details/access, and consented recordings remain pending from the user. This documentation amendment changes neither the bundle nor its hashes, models, code or other acceptance requirements.
