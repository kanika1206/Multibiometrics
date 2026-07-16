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

Usage:  extractTemplate.py <video> <out.json>
Exits 0 on success, 2 on error (no face found, unreadable video, no audio).
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
ECAPA_MODEL = "speechbrain/spkrec-ecapa-voxceleb"
ECAPA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "ecapa")
ECAPA_SR = 16000    # the sample rate the model was trained at


def _largest(faces):
    """One person is expected; if several are detected, take the closest (largest)."""
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


def face_embeddings(video_path):
    """Evenly sample frames, return one embedding per frame that contains a face."""
    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=-1, det_size=(640, 640))

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
    if indices is None:
        i = 0
        while len(embeddings) < SAMPLE_FRAMES:
            ok, frame = cap.read()
            if not ok:
                break
            if i % 5 == 0:
                faces = app.get(frame)
                if faces:
                    embeddings.append(_largest(faces).normed_embedding)
            i += 1
    else:
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
            ok, frame = cap.read()
            if not ok:
                continue
            faces = app.get(frame)
            if faces:
                embeddings.append(_largest(faces).normed_embedding)

    cap.release()
    return embeddings


def voice_embedding(video_path):
    """Demux the audio and return the 192-d ECAPA speaker embedding, L2-normalized.

    ECAPA wants 16 kHz mono; ffmpeg resamples. The embedding is normalized here so
    the matcher's dot product is a cosine similarity.
    """
    # Imported lazily: torch takes seconds to import, and the face stage runs first.
    import torch
    from speechbrain.inference.speaker import EncoderClassifier

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

    encoder = EncoderClassifier.from_hparams(
        source=ECAPA_MODEL, savedir=ECAPA_DIR, run_opts={"device": "cpu"}
    )
    with torch.no_grad():
        emb = encoder.encode_batch(torch.from_numpy(audio).unsqueeze(0))
    emb = emb.squeeze().cpu().numpy().astype(float)
    emb /= np.linalg.norm(emb)
    return emb, int(audio.size)


def main():
    if len(sys.argv) < 3:
        print("usage: extractTemplate.py <video> <out.json>", file=sys.stderr)
        return 2

    video_path, out_path = sys.argv[1], sys.argv[2]

    try:
        embeddings = face_embeddings(video_path)
    except Exception as e:
        print("face extraction failed: %s" % e, file=sys.stderr)
        return 2
    if not embeddings:
        print("no face found in video", file=sys.stderr)
        return 2

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
        "template: face_frames=%d voice_seconds=%.1f"
        % (len(embeddings), n_samples / ECAPA_SR),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
