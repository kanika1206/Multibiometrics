"""Voice factor: cosine similarity between two ECAPA-TDNN speaker embeddings.

Why not the paper's MFCC distance
---------------------------------
The previous matcher (and the paper's Algorithm 2) compared the two recordings'
13-coefficient MFCC matrices with the MEAN pairwise Euclidean distance and
accepted below a fixed threshold. That statistic does not measure who is
speaking. Measured on the four enrolled templates (two distinct humans):

    genuine  (same speaker, different recording)  172.8 - 178.8
    impostor (different speaker)                  153.7 - 193.0

The impostor range spans the genuine one, and the closest pair of all was an
impostor pair, so no threshold on this statistic separates speakers — the factor
was accepting anybody. The distance is driven by frame energy (C0 is an order of
magnitude larger than the other coefficients) and by the spread of the two frame
clouds, i.e. by loudness and recording conditions.

Text-independent speaker verification needs a discriminative embedding, so the
template now carries a 192-d ECAPA-TDNN embedding (SpeechBrain, VoxCeleb) and
this script scores it with cosine similarity — structurally the same decision the
face factor already makes with InsightFace.

THRESHOLD is chosen from the MEASURED cosine distribution, not guessed. On a
labelled set built from the available recordings (two real human speakers,
segmented into overlapping windows, plus synthetic negatives), genuine same-
speaker pairs and real cross-speaker (impostor) pairs separate cleanly:

    real-vs-real impostor cosine   max  = 0.256
    genuine same-speaker cosine    floor = 0.345 (excluding one near-silent
                                                   4 s window artifact)

0.30 sits in that empirical gap: it gives FAR = 0 on the real impostor pairs and
FRR driven only by the degenerate silent window (which cannot occur at login,
where the full recording is embedded, not a 4 s slice). This is the EER-region
threshold for the measured data. See docs/voice-verification.md for the full
distribution study. Synthetic espeak "speakers" are NOT used to set the
threshold — they share a synthesis timbre and are not distinct speakers to ECAPA.

Exit code is the authoritative signal (0 = match, 1 = no match, 2 = error);
stdout is informational only.

Usage:  matchVoiceTemplate.py <registration_template.json> <login_template.json>
"""
import json
import sys

import numpy as np

THRESHOLD = 0.30  # measured EER-region operating point; see module docstring


def voice_embedding(doc, label):
    voice = doc.get("voice", {})
    if "embedding" not in voice:
        # A v1 (MFCC) template. It cannot be upgraded — the recording it was made
        # from was discarded at enrollment — and the old comparison is not
        # speaker-discriminative, so there is no safe way to score it. Fail closed;
        # the account must re-enroll.
        raise ValueError(
            "%s uses the old MFCC template (version %s); re-enrollment required"
            % (label, doc.get("version"))
        )
    emb = np.asarray(voice["embedding"], dtype=float)
    norm = np.linalg.norm(emb)
    if emb.size == 0 or norm == 0:
        raise ValueError("empty voice embedding in %s" % label)
    return emb / norm


def main():
    if len(sys.argv) < 3:
        print("usage: matchVoiceTemplate.py <reg_template> <login_template>", file=sys.stderr)
        return 2

    try:
        with open(sys.argv[1]) as f:
            reg = json.load(f)
        with open(sys.argv[2]) as f:
            login = json.load(f)

        similarity = float(
            voice_embedding(reg, "registration template")
            @ voice_embedding(login, "login template")
        )
    except Exception as e:
        print("error: %s" % e, file=sys.stderr)
        return 2

    print(f"voice_cosine={similarity:.3f} threshold={THRESHOLD}")
    if similarity >= THRESHOLD:
        print("yes")
        return 0
    print("no")
    return 1


if __name__ == "__main__":
    sys.exit(main())
