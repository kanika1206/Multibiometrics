"""Reduce one recording to the biometric templates the matchers actually need.

Reviewer comment 2 asked why the raw `username.mp4` is stored at all. It no
longer is: registration extracts the templates below, encrypts them, and deletes
the video. This script is the single point where a video becomes a template.

The templates are exactly the intermediate values the old matchers computed
internally, so scores and thresholds are unchanged by the migration:

  face  - matchFaces.py averaged the registration frame embeddings into one
          normalized 512-d vector and scored login frames against it. We store
          that vector, plus the per-frame embeddings, because the face score is
          the MEDIAN over the login recording's frames.
  voice - a 192-d ECAPA-TDNN speaker embedding (SpeechBrain, VoxCeleb-trained).

The voice template used to be the raw 13-coefficient MFCC matrix, compared with
mean pairwise Euclidean distance (the paper's method). That statistic is not
speaker-discriminative: measured on the enrolled templates, impostor pairs scored
*closer* than genuine pairs (impostor 153.7-193.0, genuine 172.8-178.8 — the
ranges overlap completely, so no threshold can separate them). It is dominated by
frame energy (C0 ~ -300..-430) and by the spread of the two frame clouds, not by
who is speaking. A discriminative speaker embedding replaces it, for the same
reason InsightFace replaced the paper's pHash for faces. See
docs/voice-verification.md.

An ENROLMENT-ONLY acquisition quality gate is applied with --enrollment. The
stored template is permanent (template-only storage: the recording is destroyed,
so a template can never be re-scored later), which means a poor enrolment is a
permanently poor reference, while the same recording at login merely produces a
low score on one attempt. The gate therefore rejects a capture that is too small
or too rarely usable to enrol from, and names WHY — clients can then say "move
closer" or "improve the lighting" instead of failing opaquely. It is deliberately
NOT applied at login, where tightening the input would only raise the false
rejection rate for users who are already enrolled.

Usage:  extractTemplate.py <video> <out.json> [--enrollment]
Exits 0 on success, 2 on error (no face found, unreadable video, no audio),
3 when the enrolment quality gate rejects the capture (stderr carries
QUALITY:<CODE>).
"""
import json
import os
import subprocess
import sys
import tempfile

import cv2
import librosa
import numpy as np
from insightface.app import FaceAnalysis

SAMPLE_FRAMES = 12  # frames sampled evenly across the clip (matches matchFaces.py)

# Enrolment quality gate (see the module docstring). Both floors are deliberately
# permissive: they exist to reject a capture that is unusable as a permanent
# reference, not to impose a capture standard.
#
# MIN_FACE_AREA_PX - the detector aligns and crops to a fixed recogniser input,
#   so a face smaller than this is being UPSCALED into it and the embedding is
#   computed on interpolated detail. 80x80 px is well below a normal webcam
#   face (~150-250 px across at arm's length) and above the size at which the
#   crop is mostly invention.
# MIN_USABLE_FRAMES - the enrolled reference is the mean of the per-frame
#   embeddings, so it is only as stable as the number of frames behind it. Half
#   the sampled frames is the floor; a single usable frame still enrolled before
#   this gate existed.
MIN_FACE_AREA_PX = 80 * 80
MIN_USABLE_FRAMES = 6

QUALITY_EXIT = 3
ECAPA_MODEL = "speechbrain/spkrec-ecapa-voxceleb"
ECAPA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "ecapa")
ECAPA_SR = 16000    # the sample rate the model was trained at


def _largest(faces):
    """One person is expected; if several are detected, take the closest (largest)."""
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


# Process-level model caches.
#
# Each login currently spawns a fresh interpreter, so within one authentication
# these are populated once and behaviour is exactly as before. They exist because
# model loading dominates extraction latency: a caller that processes many
# recordings in one process -- the warm-model measurement, the evaluation
# harness, or a future persistent extraction service -- then pays that cost once
# instead of once per recording.
_face_app = None
_encoder = None


def get_face_app():
    """The detector/recogniser, constructed once per process."""
    global _face_app
    if _face_app is None:
        app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        app.prepare(ctx_id=-1, det_size=(640, 640))
        _face_app = app
    return _face_app


def get_encoder():
    """The ECAPA speaker encoder, constructed once per process.

    Imported lazily: torch takes seconds to import and the face stage runs
    first, so a recording with no detectable face never pays for it.
    """
    global _encoder
    if _encoder is None:
        from speechbrain.inference.speaker import EncoderClassifier

        _encoder = EncoderClassifier.from_hparams(
            source=ECAPA_MODEL, savedir=ECAPA_DIR, run_opts={"device": "cpu"}
        )
    return _encoder


def face_embeddings(video_path):
    """Evenly sample frames; return (embeddings, bbox areas) per frame with a face.

    The areas are the detected face's bounding-box area in PIXELS of the source
    frame, so they measure how much real detail the capture actually carried —
    the one device-dependent quantity the rest of the pipeline normalises away.
    """
    app = get_face_app()

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("cannot open video: %s" % video_path)

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    # Some browser-produced containers do not report a frame count.
    indices = (
        np.linspace(0, total - 1, num=min(SAMPLE_FRAMES, total), dtype=int)
        if total > 0
        else None
    )

    embeddings = []
    areas = []

    def take(frame):
        faces = app.get(frame)
        if not faces:
            return
        face = _largest(faces)
        embeddings.append(face.normed_embedding)
        areas.append(
            float((face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1]))
        )

    if indices is None:
        i = 0
        while len(embeddings) < SAMPLE_FRAMES:
            ok, frame = cap.read()
            if not ok:
                break
            if i % 5 == 0:
                take(frame)
            i += 1
    else:
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
            ok, frame = cap.read()
            if not ok:
                continue
            take(frame)

    cap.release()
    return embeddings, areas


def check_enrollment_quality(embeddings, areas):
    """Enrolment-only gate. Returns a QUALITY code, or None when the capture passes.

    Frames whose face is below MIN_FACE_AREA_PX are not usable as enrolment
    evidence, so the two checks are ordered: if nothing at all was big enough,
    say that the face was too small (the user can act on it); otherwise, if too
    few frames survived, say that instead.
    """
    usable = sum(1 for a in areas if a >= MIN_FACE_AREA_PX)
    if usable == 0:
        return "FACE_TOO_SMALL"
    if usable < MIN_USABLE_FRAMES:
        return "TOO_FEW_USABLE_FRAMES"
    return None


def voice_embedding(video_path):
    """Demux the audio and return the 192-d ECAPA speaker embedding, L2-normalized.

    ECAPA wants 16 kHz mono; ffmpeg resamples. The embedding is normalized here so
    the matcher's dot product is a cosine similarity.
    """
    # Imported lazily: torch takes seconds to import, and the face stage runs first.
    import torch

    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "audio.wav")
        subprocess.run(
            ["ffmpeg", "-y", "-i", video_path, "-ac", "1", "-ar", str(ECAPA_SR), wav],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )
        audio, _ = librosa.load(wav, sr=ECAPA_SR, mono=True)

    if audio.size < ECAPA_SR:  # under a second of audio: too little to identify anyone
        raise ValueError("audio too short for speaker embedding")

    encoder = get_encoder()
    with torch.no_grad():
        emb = encoder.encode_batch(torch.from_numpy(audio).unsqueeze(0))
    emb = emb.squeeze().cpu().numpy().astype(float)
    emb /= np.linalg.norm(emb)
    return emb, int(audio.size)


def main():
    if len(sys.argv) < 3:
        print("usage: extractTemplate.py <video> <out.json> [--enrollment]", file=sys.stderr)
        return 2

    video_path, out_path = sys.argv[1], sys.argv[2]
    enrollment = "--enrollment" in sys.argv[3:]

    try:
        embeddings, areas = face_embeddings(video_path)
    except Exception as e:
        print("face extraction failed: %s" % e, file=sys.stderr)
        return 2
    if not embeddings:
        print("no face found in video", file=sys.stderr)
        return 2

    if enrollment:
        problem = check_enrollment_quality(embeddings, areas)
        if problem:
            print(
                "QUALITY:%s (usable_frames=%d/%d min_area=%d largest_area=%d)"
                % (
                    problem,
                    sum(1 for a in areas if a >= MIN_FACE_AREA_PX),
                    len(embeddings),
                    MIN_FACE_AREA_PX,
                    int(max(areas)) if areas else 0,
                ),
                file=sys.stderr,
            )
            return QUALITY_EXIT

    # The enrolled identity: the mean of the frame embeddings, re-normalized so
    # a dot product against it is a cosine similarity.
    template = np.mean(embeddings, axis=0)
    template /= np.linalg.norm(template)

    try:
        voice, n_samples = voice_embedding(video_path)
    except Exception as e:
        print("voice extraction failed: %s" % e, file=sys.stderr)
        return 2

    doc = {
        # v2: the voice template is a speaker embedding, not an MFCC matrix. A v1
        # template cannot be upgraded in place (the audio it came from is gone by
        # design), so the matcher rejects it and the account must re-enroll.
        "version": 2,
        "face": {
            "embedding": [float(x) for x in template],
            "frames": [[float(x) for x in e] for e in embeddings],
            "n_frames": len(embeddings),
        },
        "voice": {
            "embedding": [float(x) for x in voice],
            "model": "ecapa-voxceleb",
            "n_samples": n_samples,
        },
    }
    with open(out_path, "w") as f:
        json.dump(doc, f)

    print(
        "template: face_frames=%d face_area_px=%d voice_seconds=%.1f"
        % (len(embeddings), int(max(areas)) if areas else 0, n_samples / ECAPA_SR),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
