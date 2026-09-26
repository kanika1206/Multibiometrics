"""Measure how much of extraction latency is model loading.

Why this exists
---------------
Login template extraction dominates authentication latency, and the deployed
arrangement spawns a fresh interpreter per attempt, so every login pays the full
model load. That makes "extraction is slow" ambiguous: it does not say whether
the cost is loading the models or running them. This script separates the two.

It reports three things:

  model load        time to construct the face detector/recogniser and the
                    speaker encoder, once
  cold extraction   load + extract, i.e. what a login actually costs today
  warm extraction   extract only, with both models already resident, i.e. what a
                    login would cost behind a persistent extraction service

The warm figure is the upper bound on what persistent model loading can save.
If warm extraction is a small fraction of cold, a resident model service is the
single highest-value latency change available; if it is not, the time is going
somewhere else and the service would not help.

Usage (from backend/):
  python scripts/measure_warm_models.py <video> [<video> ...] [--repeat N] [--json out.json]

Pass several recordings, or one recording with --repeat, or both. Model loading
is measured on its own, so every extraction timed below is a warm one.
"""
import argparse
import json
import os
import statistics
import sys
import time

# Import the deployed extractor rather than reimplementing it, so the warm and
# cold paths are the same code the server runs.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import extractTemplate as et  # noqa: E402


def timed(fn, *args, **kwargs):
    t0 = time.perf_counter()
    result = fn(*args, **kwargs)
    return result, time.perf_counter() - t0


def extract_once(video):
    """One full extraction through the deployed functions."""
    embeddings, _areas = et.face_embeddings(video)
    if not embeddings:
        raise RuntimeError("no face found")
    voice, _ = et.voice_embedding(video)
    return len(embeddings), len(voice)


def main():
    ap = argparse.ArgumentParser(description="Warm vs cold template extraction timing.")
    ap.add_argument("videos", nargs="+", help="recordings to extract")
    ap.add_argument("--repeat", type=int, default=1, help="passes over the video list")
    ap.add_argument("--json", help="write the report to this file as JSON")
    args = ap.parse_args()

    missing = [v for v in args.videos if not os.path.exists(v)]
    if missing:
        print("not found: %s" % ", ".join(missing), file=sys.stderr)
        return 2

    # --- model load, measured on its own -------------------------------------
    # Constructed explicitly here rather than being triggered by the first
    # extraction, so the load cost is attributed to loading and not to whichever
    # recording happened to come first.
    print("loading models ...")
    _, face_load = timed(et.get_face_app)
    _, voice_load = timed(et.get_encoder)
    total_load = face_load + voice_load
    print("  face model:    %6.2f s" % face_load)
    print("  speaker model: %6.2f s" % voice_load)
    print("  total:         %6.2f s" % total_load)

    # --- warm extractions ----------------------------------------------------
    warm = []
    failures = []
    runs = [v for _ in range(args.repeat) for v in args.videos]
    print("\nextracting %d time(s) with models resident ..." % len(runs))
    for i, video in enumerate(runs, 1):
        name = os.path.basename(video)
        try:
            (n_frames, _), elapsed = timed(extract_once, video)
        except Exception as e:
            print("  %2d. %-38s FAILED (%s)" % (i, name, e))
            failures.append(name)
            continue
        warm.append(elapsed)
        print("  %2d. %-38s %6.2f s (%d face frames)" % (i, name, elapsed, n_frames))

    if not warm:
        print("\nno extraction succeeded; nothing to report", file=sys.stderr)
        return 1

    mean_warm = statistics.mean(warm)
    cold = total_load + mean_warm
    load_share = total_load / cold if cold else 0.0

    print("\n" + "=" * 64)
    print("model load (paid once per process)       %6.2f s" % total_load)
    print("warm extraction, mean of %-3d             %6.2f s  (min %.2f, max %.2f)"
          % (len(warm), mean_warm, min(warm), max(warm)))
    print("cold extraction = load + extract         %6.2f s" % cold)
    print("-" * 64)
    print("share of a cold extraction that is model loading:   %5.1f%%" % (load_share * 100))
    print("speed-up available from a persistent model service: %5.1fx" % (cold / mean_warm))
    print("=" * 64)
    if failures:
        print("failed recordings: %s" % ", ".join(failures))

    report = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model_load_seconds": {
            "face": round(face_load, 3),
            "voice": round(voice_load, 3),
            "total": round(total_load, 3),
        },
        "warm_extraction_seconds": {
            "mean": round(mean_warm, 3),
            "min": round(min(warm), 3),
            "max": round(max(warm), 3),
            "n": len(warm),
        },
        "cold_extraction_seconds": round(cold, 3),
        "model_load_share_of_cold": round(load_share, 4),
        "available_speedup": round(cold / mean_warm, 3),
        "failures": failures,
        "note": (
            "Cold is model load plus mean warm extraction, i.e. what a login costs "
            "when each attempt spawns a fresh interpreter. Warm is what it would "
            "cost behind a persistent extraction service holding both models."
        ),
    }
    if args.json:
        with open(args.json, "w") as f:
            json.dump(report, f, indent=2)
        print("\nwrote %s" % args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
