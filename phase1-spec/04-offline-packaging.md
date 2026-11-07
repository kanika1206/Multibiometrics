Status: proposed Phase 1 specification, 1 November 2026. Documents only; implementation is NOT authorized. Submitted v1 revision: **5df0ecd0a5cb2ed8fbf6e1f8211671534189034d** (user-designated HEAD; no uncommitted submission changes). Existing files outside phase1-spec/ remain untouched. Fixed target: Windows, i5-class CPU, 8 GB RAM; phone work deferred.

# Offline packaging and provisioning manifest

## Honest manifest status
Manifest schema version: P1-PROVISION-1. Package release/version and artifact SHA-256 values are **UNRESOLVED — implementation provisioning required**, not verified hashes. Source lineage is resolved to pinned HEAD; exact distributed model binary provenance remains subject to asset inventory (a commit does not establish hashes of untracked model caches). This is a complete required-category specification, not a claim an installable package already exists. No model/library is installed or downloaded now. A release cannot pass readiness with placeholders, mutable identifiers such as latest, or unchecked transitive dependencies.

Each shipped file requires: relative path, component/purpose, exact version/build, upstream revision/source and license, CPU/Windows architecture, byte size, SHA-256, dependencies, local load path, required/optional status and missing/corrupt error. Hash every model shard, tokenizer, config, DLL, wheel, codec, runtime and UI asset, plus installer and manifest. Aggregate component labels do not replace per-file rows. Acquisition belongs to an explicit provisioning/build stage; offline installer contains all prerequisites and never bootstraps them from the Internet.

| Required inventory category | Proposed content / status |
|---|---|
| Desktop shell and UI | Non-network-IPC desktop shell selected; framework/version remains an engineering selection; bundled HTML/JS/CSS/fonts/icons, no CDN; shell runtime and Windows redistributables pinned |
| Inference runtime | Isolated Python 3.12-compatible build or packaged equivalent; exact patch/wheels pending qualification; no use of existing venv |
| CPU numerical stack | NumPy, ONNX Runtime and dependent native DLLs; exact compatible Windows builds to be recorded |
| Face pipeline | InsightFace buffalo_l detector/recognizer plus actually loaded support models, configs/alignment assets; source configuration resolved to pinned HEAD; exact files require provisioning inventory |
| Speaker pipeline | ECAPA-TDNN VoxCeleb checkpoint, preprocessing/config/normalization assets; ONNX export plus all external tensor files, provenance to source checkpoint |
| Reference export/testing tools | SpeechBrain, torch, torchaudio, librosa and dependencies in separate build/reference environment if needed; not assumed required in production |
| ASR | Proposed Vosk English digit-capable model, runtime DLLs, vocabulary/graph/config files and fixed grammar; exact build/model pending qualification |
| Media | ffmpeg and demux/codec/resampler DLLs, OpenCV if used; explicit supported capture containers; no system-PATH assumptions |
| Storage/security | SQLite and chosen crypto/Windows DPAPI bindings; SQLCipher only if separately selected; all libraries pinned |
| Operating prerequisites | Exact supported Windows build, camera/mic drivers and required redistributable versions; drivers provisioned before offline tests |
| Application policy | Versioned thresholds, candidate rule, challenge policy, model-to-template compatibility map and local-only configuration |
| Acceptance assets | Consented fixture inventory and checksums, separate from normal production payload; no private keys or participant templates in distributable |

## Observed current-checkout fetch/fallback surfaces (submitted source lineage resolved to pinned HEAD)
- extractTemplate.py FaceAnalysis(name=buffalo_l) can obtain absent model assets; replace with validated absolute bundled paths, no acquisition code at runtime.
- SpeechBrain from_hparams(source=speechbrain/spkrec-ecapa-voxceleb) uses remote source/cache machinery; deployment uses checked local assets/export only.
- speechToTextLocal.py constructs faster-whisper by model name (small.en default), enabling initial fetch; prototype recognizer loads only an explicit bundled directory.
- speechToTexty.py selects Google explicitly or falls back when faster-whisper is unavailable; neither network engine nor fallback is allowed in the new package.
- MongoMemoryServer application/vault fallbacks may acquire Mongo binaries; MongoDB, server vault and memory-server dependencies are absent from the new runtime.
- Browser capture UI calls server-domain endpoints for challenge, upload, enrollment and verification; new UI uses selected local IPC, never these endpoints.
- npm/pip/model-hub downloads are build provisioning only; no installer self-download, model update, crash upload, telemetry or browser remote assets in operation.
- ffmpeg via PATH and missing Python/native imports are implicit host dependencies; bundle verified binaries or explicitly provision prerequisites, otherwise fail readiness visibly.

At startup verify manifest, files and compatibility before capture/enrollment is enabled. Missing/invalid asset => ASSET_MISSING/ASSET_INVALID with component name and offline repair instructions; no automatic engine/model downgrade. Independently selected local alternative is a new explicit package configuration requiring tests, never an error-triggered runtime fallback.

Targets, not results: warm processing <=3 s, cold start <=10 s, installer <300 MB. Record measured footprint rather than silently replacing models to meet estimates. Current requirements.txt is observational evidence, not a proven compatible Windows lockfile. Full closure requires recursive dependency/native-load inventory and first-launch monitoring on a clean machine; no claim that static inspection alone proves absence of egress.

## Authorized Phase 1 provisioning record

Development-only artifacts added inside offline-prototype; no global install. Machine-readable per-file SHA-256 inventory: `../offline-prototype/provisioning-manifest.json`. This is NOT a qualified Windows release manifest. No model assets have been added. Source and versions of downloaded wheels:

| Name | Version | SHA-256 | Source |
|---|---|---|---|
| cffi | 2.1.1 | c1453022f490d2459a11819d83ad1d586e9ff65a12ac3e705ffebd46d3685dcf | https://pypi.org/project/cffi/2.1.1/ |
| cryptography | 46.0.3 | 10b01676fc208c3e6feeb25a8b83d81767e8059e1fe86e1dc62d10a3018fa926 | https://pypi.org/project/cryptography/46.0.3/ |
| numpy | 2.4.6 | 90f9849678c75fe7afa2d348ac842c168b0a4d3d61919687216dfc547976d853 | https://pypi.org/project/numpy/2.4.6/ |
| pycparser | 3.12 | a076f3f489b39b43ed13563a1dafe42447445bec2e294154ec5c57fcdda4c85e | https://pypi.org/project/pycparser/3.12/ |

The isolated venv also contains Python/ensurepip tooling; individual regular files are inventoried in the manifest. No existing venv was modified. Windows artifacts and model hashes remain unprovisioned; application readiness must fail. This records additions only and does not relax any specification.

## Amendment — 2026-11-01: native Tk shell approved

User decision: native Tk replaces the earlier HTML/JS desktop-shell asset assumption. Earlier text is retained above as superseded on that point only. Reason: smaller zero-socket audit surface; UI fidelity is not a research claim. Full native UI integration is authorized. Inherited pipes/named pipes only; no sockets or loopback exception. All other constraints and Windows-target verification requirements remain unchanged.

## Continuation provisioning — 2026-11-01

Per-file source/version/SHA-256 inventory updated in `../offline-prototype/provisioning-manifest.json`; installed development versions in `../offline-prototype/requirements-dev.lock`. All additions are inside offline-prototype; no global installs. Added ONNX Runtime 1.23.2, OpenCV-headless 4.11.0.86, Vosk 0.3.45, their transitive/build dependencies, and ten copied pretrained face/ECAPA source files. The table below identifies archive/model bytes; .venv individual-file hashes are in the manifest. Copies are not qualified exports or permission to redistribute pretrained models. No participant recordings added. Windows packaging and actual model parity remain open.

| Artifact | Version | SHA-256 | Source |
|---|---|---|---|
| wheelhouse/certifi-2026.10.23-py3-none-any.whl | 2026.10.23 | e9b54de76e530bb6cf0ccd036787103acb58fd42ba930ea8bf948ddbaa2f61d1 | https://pypi.org/project/certifi/2026.10.23/ |
| wheelhouse/cffi-2.1.1-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.whl | 2.1.1 | c1453022f490d2459a11819d83ad1d586e9ff65a12ac3e705ffebd46d3685dcf | https://pypi.org/project/cffi/2.1.1/ |
| wheelhouse/charset_normalizer-3.5.2-cp312-cp312-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl | 3.5.2 | 3d31298449090ab8d47b7b1b2a555ff73cac7ed438a08b7ac160980c7ebed649 | https://pypi.org/project/charset_normalizer/3.5.2/ |
| wheelhouse/coloredlogs-15.0.1-py2.py3-none-any.whl | 15.0.1 | 612ee75c546f53e92e70049c9dbfcc18c935a2b9a53b66085ce9ef6a6e5c0934 | https://pypi.org/project/coloredlogs/15.0.1/ |
| wheelhouse/cryptography-46.0.3-cp311-abi3-manylinux_2_34_x86_64.whl | 46.0.3 | 10b01676fc208c3e6feeb25a8b83d81767e8059e1fe86e1dc62d10a3018fa926 | https://pypi.org/project/cryptography/46.0.3/ |
| wheelhouse/flatbuffers-25.12.19-py2.py3-none-any.whl | 25.12.19 | 7634f50c427838bb021c2d66a3d1168e9d199b0607e6329399f04846d42e20b4 | https://pypi.org/project/flatbuffers/25.12.19/ |
| wheelhouse/humanfriendly-10.0-py2.py3-none-any.whl | 10.0 | 1697e1a8a8f550fd43c2865cd84542fc175a61dcb779b6fee18cf6b6ccba1477 | https://pypi.org/project/humanfriendly/10.0/ |
| wheelhouse/idna-3.20-py3-none-any.whl | 3.20 | ab7ae7122974553370f0bdb919e1a960b2cd1bc1ef0276416d896db81c14582c | https://pypi.org/project/idna/3.20/ |
| wheelhouse/mpmath-1.3.0-py3-none-any.whl | 1.3.0 | a0b2b9fe80bbcd81a6647ff13108738cfb482d481d826cc0e02f5b35e5c88d2c | https://pypi.org/project/mpmath/1.3.0/ |
| wheelhouse/numpy-2.4.6-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl | 2.4.6 | 90f9849678c75fe7afa2d348ac842c168b0a4d3d61919687216dfc547976d853 | https://pypi.org/project/numpy/2.4.6/ |
| wheelhouse/numpy-2.5.4-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl | 2.5.4 | fbde6962867ee75b48b0ee29b2b9372ec5d617799dbaf38e82dc0596f2f7738a | https://pypi.org/project/numpy/2.5.4/ |
| wheelhouse/onnxruntime-1.23.2-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl | 1.23.2 | 0f9b4ae77f8e3c9bee50c27bc1beede83f786fe1d52e99ac85aa8d65a01e9b77 | https://pypi.org/project/onnxruntime/1.23.2/ |
| wheelhouse/opencv_python_headless-4.11.0.86-cp37-abi3-manylinux_2_17_x86_64.manylinux2014_x86_64.whl | 4.11.0.86 | 0e0a27c19dd1f40ddff94976cfe43066fbbe9dfbb2ec1907d66c19caef42a57b | https://pypi.org/project/opencv_python_headless/4.11.0.86/ |
| wheelhouse/packaging-26.3-py3-none-any.whl | 26.3 | d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c | https://pypi.org/project/packaging/26.3/ |
| wheelhouse/protobuf-7.36.2-cp310-abi3-manylinux2014_x86_64.whl | 7.36.2 | 89f23aa53c24553a2416fd4fd1ec06f74fa42b14b546d8883128813f775bbfd2 | https://pypi.org/project/protobuf/7.36.2/ |
| wheelhouse/pycparser-3.12-py3-none-any.whl | 3.12 | a076f3f489b39b43ed13563a1dafe42447445bec2e294154ec5c57fcdda4c85e | https://pypi.org/project/pycparser/3.12/ |
| wheelhouse/requests-2.34.2-py3-none-any.whl | 2.34.2 | 2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0 | https://pypi.org/project/requests/2.34.2/ |
| wheelhouse/setuptools-80.9.0-py3-none-any.whl | 80.9.0 | 062d34222ad13e0cc312a4c02d73f059e86a4acbfbdea8f8f76b28c99f306922 | https://pypi.org/project/setuptools/80.9.0/ |
| wheelhouse/srt-3.5.3.tar.gz | 3.5.3 | 4884315043a4f0740fd1f878ed6caa376ac06d70e135f306a6dc44632eed0cc0 | https://pypi.org/project/srt/3.5.3/ |
| wheelhouse/sympy-1.14.0-py3-none-any.whl | 1.14.0 | e091cc3e99d2141a0ba2847328f5479b05d94a6635cb96148ccb3f34671bd8f5 | https://pypi.org/project/sympy/1.14.0/ |
| wheelhouse/tqdm-4.70.1-py3-none-any.whl | 4.70.1 | c293e525e6fef9c20e8728fd4612df02a0aa31bb5fe91ecd93e123b1b7bffa73 | https://pypi.org/project/tqdm/4.70.1/ |
| wheelhouse/urllib3-2.8.0-py3-none-any.whl | 2.8.0 | 0cf3cae568d36aa9576b28dfb35f11328f1cb974ca7647d9475ebb86c75ac6e3 | https://pypi.org/project/urllib3/2.8.0/ |
| wheelhouse/vosk-0.3.45-py3-none-manylinux_2_12_x86_64.manylinux2010_x86_64.whl | 0.3.45 | 25e025093c4399d7278f543568ed8cc5460ac3a4bf48c23673ace1e25d26619f | https://pypi.org/project/vosk/0.3.45/ |
| wheelhouse/websockets-17.4-cp312-cp312-manylinux1_x86_64.manylinux_2_28_x86_64.manylinux_2_5_x86_64.whl | 17.4 | 9ae1429ee9e52b139167ed0169757806a27ed7307e942e8c62037a9184e9843b | https://pypi.org/project/websockets/17.4/ |
| wheelhouse/wheel-0.45.1-py3-none-any.whl | 0.45.1 | 708e7481cc80179af0e556bbf0cc00b8444c7321e2700b8d8580231d13017248 | https://pypi.org/project/wheel/0.45.1/ |
| assets/face/genderage.onnx | buffalo_l; exact version = file SHA-256 | 4fde69b1c810857b88c64a335084f1c3fe8f01246c9a191b48c7bb756d6652fb | https://github.com/deepinsight/insightface |
| assets/face/2d106det.onnx | buffalo_l; exact version = file SHA-256 | f001b856447c413801ef5c42091ed0cd516fcd21f2d6b79635b1e733a7109dbf | https://github.com/deepinsight/insightface |
| assets/face/1k3d68.onnx | buffalo_l; exact version = file SHA-256 | df5c06b8a0c12e422b2ed8947b8869faa4105387f199c477af038aa01f9a45cc | https://github.com/deepinsight/insightface |
| assets/face/det_10g.onnx | buffalo_l; exact version = file SHA-256 | 5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91 | https://github.com/deepinsight/insightface |
| assets/face/w600k_r50.onnx | buffalo_l; exact version = file SHA-256 | 4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43 | https://github.com/deepinsight/insightface |
| assets/ecapa-source/embedding_model.ckpt | spkrec-ecapa-voxceleb; exact version = file SHA-256 | 0575cb64845e6b9a10db9bcb74d5ac32b326b8dc90352671d345e2ee3d0126a2 | https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb |
| assets/ecapa-source/mean_var_norm_emb.ckpt | spkrec-ecapa-voxceleb; exact version = file SHA-256 | cd70225b05b37be64fc5a95e24395d804231d43f74b2e1e5a513db7b69b34c33 | https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb |
| assets/ecapa-source/label_encoder.ckpt | spkrec-ecapa-voxceleb; exact version = file SHA-256 | e13c3a167bb4112685670ee896d20e2b565af16b3a4ceeaa8689fa4d22adb8b9 | https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb |
| assets/ecapa-source/hyperparams.yaml | spkrec-ecapa-voxceleb; exact version = file SHA-256 | 6f78854fa04ba59e761437b76a2575d3aba5e5016de3e9b69f0c9a5077fb1a41 | https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb |
| assets/ecapa-source/classifier.ckpt | spkrec-ecapa-voxceleb; exact version = file SHA-256 | fd9e3634fe68bd0a427c95e354c0c677374f62b3f434e45b78599950d860d535 | https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb |

### Development provisioning update — 2026-11-02
The current per-file inventory is `../offline-prototype/provisioning-manifest.json` (P1-PROVISION-2), SHA-256 `b084411fbeb7d209596d76380caf5982ec2a6257df57b62b2fe482ac3fb58cf3`, containing 47,869 entries with name, version, source and SHA-256. It supersedes the earlier inventory snapshot only, not the packaging requirements. Copied runtime/export dependency provenance is also retained in `evidence/runtime-local-dependencies.json` and `evidence/export-dependencies.json`. Linux OS shared-library closure is not claimed.

New assets include Vosk English small 0.15 from the official alphacephei model archive; a locally generated opset-17 waveform ECAPA export from the inventoried SpeechBrain checkpoint; and local Linux ffmpeg/ffprobe copies for development checks only. Every archive/extracted model file and installed distribution file is listed in the inventory. Export script and generated-signal parity evidence are retained inside the package. No Windows redistributable/runtime/codec qualification or real-recording model parity is implied. Development inventory is explicitly separate from the required production release manifest; the application cannot use the development switch through IPC.

### Production qualification groundwork — 2026-11-02
Selected production inputs only: `../offline-prototype/packaging/target-run/production-inventory.json`, SHA-256 `dd5fcc5bb5fc1989c3060fc0fff9ee46a0c6bebfc73cba847017c0cd16340301`. Its 36 per-file rows exclude build/export environments and unused model assets. This is INCOMPLETE: Windows runtime/Tk/native inference/codec closure and redistribution notices remain absent. Deflate archive: 295,297,309 bytes; lossless LZMA archive: 288,336,577 bytes, both before Windows dependencies. Neither is a completed installer. Requirements and the <300 MB target are unchanged; no model substitution/quantization. See SIZE-BUDGET.md for options and GATES.md for the blocked acceptance workflow.

### Complete Windows candidate provisioning — 2026-11-02

Windows Python/Tk 3.12.16+20261026, pinned Windows inference wheels, app-local Microsoft VC runtime DLLs and FFmpeg/ffprobe 8.1 LGPL branch are provisioned. No global runtime installation. The selected model bytes are unchanged; no quantization/substitution. Per-file name/version/source/SHA inventories (build/export environments excluded from the candidate):

- `../offline-prototype/provisioning/windows/archive-inventory.json` — SHA-256 `366547b7ac86e1232920811681549fa5642811588de72914014911a5b8e80474`.
- `../offline-prototype/provisioning/windows/runtime/runtime-inventory.json` — SHA-256 `7643cca766d3dee04667914d9fbb6315e4c629dba482ee4239af71ffe4ab6434`.
- `../offline-prototype/packaging/target-run/payload/candidate-inventory.json` — SHA-256 `bd158817a1dc7d07311897cd770fa59645e4b55436876e689a954cf639df5703`.

Complete offline installer/run ZIP: **611,266,399 bytes**, SHA-256 `c1cd542c5c7630e686b53836f5ada8bcc591ee1dcb8ce043a183851093006e0f`. The <300 MB target is missed; no specification target is changed here. Candidate status is CANDIDATE, never QUALIFIED. Acceptance-only execution is user-approved and isolated; production gate remains unchanged. All Windows execution is UNVERIFIED-ON-TARGET.

### Packaging defect correction — 2026-11-02

Previous Windows candidate inventory/ZIP hashes are superseded after removal of unused build/export/test utilities from runtime wheels. Models and authentication source are unchanged. Required runtime import helpers remain; no torch/SpeechBrain/build environments are shipped.

- `../offline-prototype/provisioning/windows/runtime/runtime-inventory.json`: SHA-256 `7324ffb046c923dda66350057862489979e671ab14003dd58e57e7a9a3c9c095`.
- `../offline-prototype/packaging/target-run/payload/candidate-inventory.json`: SHA-256 `8aba9dedeb42b2dd5775bd4a8d11b487656aa8d7d762a3718b46f83d0d9409ec`.

Rebuilt ZIP: 608,646,900 bytes; SHA-256 `1559c08cc0ce7281ba1b3649ee06054bfb231253db2d9fbaf81d87e7843d6d27`. Target remains <300 MB and is not changed here. Static final-archive audit and import-blocking inference smoke passed; Windows unverified.


## Amendment — 2026-11-02: installer size decision (CLOSED)

User decision: the original **installer <300 MB** target was a **pre-build estimate** and is superseded by this amendment. Earlier target text and statements that a size decision was pending remain visible above as historical, superseded wording; they no longer define a Phase 1 acceptance gate.

The measured final bundle is **608,646,900 bytes (608.65 MB)** with the specified models unmodified. A real packaging defect—build-only utilities included in runtime wheels—was removed before this decision, reducing the measured bundle from **611.27 MB to 608.65 MB**. This amendment does not excuse or reinstate that defect.

Installer size is henceforth a **reported metric for Phase 1, not a pass/fail gate**. Footprint reduction, including a minimal FFmpeg build, belongs to **Phase 3 under parity gates**; this decision does not authorize that work now. **The size item is closed as decided.**

All other statuses stand: production remains gated; Windows verification remains UNVERIFIED-ON-TARGET pending user-provided target details/access, and consented recordings remain pending from the user. This documentation amendment changes neither the bundle nor its hashes, models, code or other acceptance requirements.
