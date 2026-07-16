"""Face factor: does the person in the login video match the person who registered?

Replaces matchFrames.py, which perceptual-hashed frame N of one video against
frame N of the other by filename. That compared whole frames -- background,
lighting, pose -- and only lined up if both recordings happened to be identically
timed, so it rejected genuine users.

Here we detect the face in sampled frames, embed each one, and compare embeddings
by cosine similarity. Nothing is written to disk, so concurrent logins cannot
collide.

Usage:  matchFaces.py <registration_video> <login_video>
Prints "yes"/"no"; exits 0 on match, 1 on mismatch, 2 on error.
"""
import sys
import cv2
import numpy as np
from insightface.app import FaceAnalysis

SAMPLE_FRAMES = 12       # frames sampled evenly across each clip
MATCH_THRESHOLD = 0.35   # cosine similarity; buffalo_l separates identities well above this


def sample_embeddings(app, video_path):
    """Evenly sample frames, return one embedding per frame that contains a face."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("cannot open video: %s" % video_path)

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        # Some browser-produced containers do not report a frame count.
        indices = None
    else:
        indices = np.linspace(0, total - 1, num=min(SAMPLE_FRAMES, total), dtype=int)

    embeddings = []
    if indices is None:
        # Fall back to walking the stream and taking every Nth frame.
        i = 0
        while len(embeddings) < SAMPLE_FRAMES:
            ok, frame = cap.read()
            if not ok:
                break
            if i % 5 == 0:
                faces = app.get(frame)
                if faces:
                    largest = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
                    embeddings.append(largest.normed_embedding)
            i += 1
    else:
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
            ok, frame = cap.read()
            if not ok:
                continue
            faces = app.get(frame)
            if faces:
                # One person is expected; if several, take the closest (largest) face.
                largest = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
                embeddings.append(largest.normed_embedding)

    cap.release()
    return embeddings


def main():
    if len(sys.argv) < 3:
        print("usage: matchFaces.py <registration_video> <login_video>", file=sys.stderr)
        return 2

    reg_path, login_path = sys.argv[1], sys.argv[2]

    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=-1, det_size=(640, 640))

    reg = sample_embeddings(app, reg_path)
    login = sample_embeddings(app, login_path)

    if not reg:
        print("no face found in registration video", file=sys.stderr)
        return 2
    if not login:
        print("no face found in login video", file=sys.stderr)
        return 2

    # Average the registration embeddings into a single template, then score each
    # login frame against it. The median score resists a few bad frames (blur,
    # motion, half-turned head) in either direction.
    template = np.mean(reg, axis=0)
    template /= np.linalg.norm(template)

    scores = [float(np.dot(template, e)) for e in login]
    score = float(np.median(scores))

    print("similarity=%.4f threshold=%.2f reg_frames=%d login_frames=%d"
          % (score, MATCH_THRESHOLD, len(reg), len(login)), file=sys.stderr)

    if score >= MATCH_THRESHOLD:
        print("yes")
        return 0
    print("no")
    return 1


if __name__ == "__main__":
    sys.exit(main())
