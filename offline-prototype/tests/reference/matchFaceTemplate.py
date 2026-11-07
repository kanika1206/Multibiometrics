"""Face factor, template-only: compare a stored registration template against the
template extracted from the login recording. No video is read here.

Same arithmetic as the old matchFaces.py, which embedded both videos on the fly:
score each login-frame embedding against the enrolled mean embedding and take the
median, so a few bad frames (blur, motion, half-turned head) cannot swing the
verdict. Threshold unchanged, so the migration does not move the operating point.

Usage:  matchFaceTemplate.py <registration_template.json> <login_template.json>
Prints "yes"/"no"; exits 0 on match, 1 on mismatch, 2 on error.
"""
import json
import sys

import numpy as np

MATCH_THRESHOLD = 0.35  # cosine similarity; buffalo_l separates identities well above this


def main():
    if len(sys.argv) < 3:
        print("usage: matchFaceTemplate.py <reg_template> <login_template>", file=sys.stderr)
        return 2

    try:
        with open(sys.argv[1]) as f:
            reg = json.load(f)
        with open(sys.argv[2]) as f:
            login = json.load(f)

        template = np.asarray(reg["face"]["embedding"], dtype=float)
        frames = [np.asarray(e, dtype=float) for e in login["face"]["frames"]]
    except Exception as e:
        print("error: %s" % e, file=sys.stderr)
        return 2

    if template.size == 0 or not frames:
        print("empty face template", file=sys.stderr)
        return 2

    scores = [float(np.dot(template, e)) for e in frames]
    score = float(np.median(scores))

    print(
        "similarity=%.4f threshold=%.2f login_frames=%d"
        % (score, MATCH_THRESHOLD, len(frames)),
        file=sys.stderr,
    )

    if score >= MATCH_THRESHOLD:
        print("yes")
        return 0
    print("no")
    return 1


if __name__ == "__main__":
    sys.exit(main())
