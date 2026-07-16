# Paper reference implementation (NOT part of the active pipeline)

These four scripts are the original face-matching pipeline exactly as specified in
`Research_paper.pdf` (Fig. 11): frame extraction with OpenCV, perceptual hash (pHash)
of whole frames, and Hamming-distance comparison at threshold 25.

- `extractFrames.py` — extract frames from the registration video
- `extractFrameslogin.py` — extract frames from the login video
- `matchFrames.py` — pHash + Hamming comparison over positionally aligned frames
- `hamming.py` — Hamming distance helper

They were removed from the active pipeline on 2026-07-11 and replaced by
`backend/matchFaces.py` (InsightFace ArcFace embeddings + cosine similarity,
threshold 0.35).

## Why the replacement (enhancement record)

- **Original paper approach:** pHash of whole frames + Hamming distance, threshold 25.
- **Enhanced implementation:** face detection + ArcFace embedding + cosine similarity.
- **Reason:** pHash hashes the whole frame (background, lighting, pose), not face
  identity, and false-rejects a genuine user on this repo's own data.
- **Experimental evidence** (measured on the repo's test videos, paper's threshold 25):

  | pair | Hamming | paper verdict | correct? |
  |---|---|---|---|
  | genuine 123 vs 123_l | 26.0 | reject | **false reject** |
  | genuine aditi vs aditi_l | 22.0 | accept | ok |
  | impostor 123 vs impostor | 32.0 | reject | ok |
  | impostor aditi vs impostor | 30.0 | reject | ok |

  Same pairs under InsightFace (threshold 0.35): genuine 0.7265 / 0.6194 (accept),
  impostor 0.2247 / 0.1838 (reject) — all four correct. Note: measured on the
  available dataset only (one person across two accounts + one impostor); broader
  validation requires a larger multi-person dataset.

These files are kept for research reproducibility and comparison. Do not wire them
back into `appController.js`.
