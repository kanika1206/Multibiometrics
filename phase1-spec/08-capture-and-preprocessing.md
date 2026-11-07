Status: proposed Phase 1 specification, 1 November 2026. Documents only; implementation is NOT authorized. Submitted v1 revision: **5df0ecd0a5cb2ed8fbf6e1f8211671534189034d** (user-designated HEAD; no uncommitted submission changes). Existing files outside phase1-spec/ remain untouched. Fixed target: Windows, i5-class CPU, 8 GB RAM; phone work deferred.

# Windows capture and preprocessing

## Capture contract
One synchronized camera-plus-microphone recording per attempt; bind handle and start/stop timestamps to attempt and identity. Negotiate supported container/codec from the bundled manifest (actual content, not filename extension); reject unsupported/corrupt media locally. Record actual resolution, rate, channel count, codec, dropped frames and track offsets. UI may request 1280x720 at 30 fps as current code does, but record actual negotiated values and disclose fallback. User permissions/capture failures deny; no uploaded external recording in normal live flow (file-fed fixtures use separate test entry).

Preserve original audio/video presentation timestamps and their common origin through demux; save time-mapping metadata in memory for later lip-sync. Do not reconstruct synchrony from frame indices alone or discard audio offset. Phase 1 does not claim sensor authenticity or lip-sync validation.

## Face and speaker baseline path
Observed current extraction: up to 12 evenly spaced indices from 0 to total_frames-1; missing frame count uses every fifth decoded frame until 12 detected faces; largest face selected; buffalo_l CPU with detector size 640x640. Per-frame normalized embedding; enrollment normalized mean; probe face score median of per-frame cosine against enrollment mean. This extraction behavior is source-confirmed against pinned HEAD; runtime fixture verification remains future work. Never substitute median embeddings for median scores.

Observed voice path: ffmpeg mono 16 kHz WAV then librosa load at 16 kHz, full waveform to ECAPA, normalized 192-d vector; less than one second rejected. Pinned source uses ffmpeg WAV conversion, librosa loading and a float-converted normalized embedding; actual codec/library-version effects require the baseline environment inventory and future fixture runs. ONNX conversion must preserve preprocessing; no unmeasured VAD, denoise, chunk aggregation or resampling shortcut. ASR may consume lossless 16 kHz audio; v1's MP3 extraction is a separate compatibility condition, not silently treated as identical.

## New enrollment proposal (distinct from v1)
Three independently prompted samples, each with at least six usable detected frames and adequate audio. Current code's face-size gate is bounding-box AREA >=6400 square pixels, not necessarily width>=80 AND height>=80: preserve these pinned-source semantics in parity fixtures; report the PDF's 80x80 shorthand. Do not silently discard additional frames differently in the baseline path.

Proposed aggregation: normalize each sample's mean face vector; equal-weight mean of three sample vectors then normalize. Likewise equal-weight mean of three normalized speaker embeddings then normalize. Preserve frame arrays in baseline-style payload; record sample partition/provenance separately. Zero aggregate norm => reject enrollment. Require >=1 s decoded audio, finite waveform, nonzero signal and successful valid embedding per sample; quantitative SNR/clipping thresholds remain engineering qualification items, not invented calibrated gates. Re-record rejected samples. Complete with a separate fresh-challenge verification against the provisional template before activation.

This aggregation is proposed here because the PDF leaves exact weighting unspecified. It does not alter v1. New quality/confirmation rules are enrollment changes and must be separated from detector effects in later comparisons.

## Parity fixtures
Consented fixtures include known/unknown frame-count containers, multiple faces, marginal face area, fewer than six usable frames, different frame rates, stereo/mono, silence/short audio, offset tracks, corrupt files and variable frame rate. Record decoded frame indices/timestamps, bounding boxes, waveforms/duration/sample counts, embeddings and scores in restricted test evidence. Compare old and new preprocessing before comparing models; baseline source expectations are resolved to pinned HEAD; measured oracle outputs await authorized fixture execution. Preserve continuous source timing for future lip-sync rather than treating 12 sparse recognition frames as sufficient temporal input.
