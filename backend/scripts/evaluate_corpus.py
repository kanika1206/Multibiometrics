"""Score an extracted corpus and compute recognition-accuracy metrics.

Invoked by run_evaluation.mjs; not meant to be run directly. Everything here is
deliberately identical to the DEPLOYED matchers, so the reported operating point
is the one the system actually uses:

  face  - median over the probe's per-frame embeddings of the dot product with
          the reference template embedding   (matchFaceTemplate.py)
  voice - dot product of the two L2-normalized ECAPA embeddings
          (matchVoiceTemplate.py)

Both are cosine similarities, accepted at >= threshold.

Pair labelling:
  genuine  - same subject, DIFFERENT sessions. Never a recording against itself:
             a self-comparison scores 1.0 and would flatter the FRR.
  impostor - different subjects.

Outputs scores.csv, metrics.json (FAR/FRR sweep, EER, AUC), and DET plus
score-distribution figures.

Usage: evaluate_corpus.py <manifest.json> <out_dir>
"""
import csv
import itertools
import json
import os
import sys

import numpy as np

matplotlib_ok = True
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except Exception:  # figures are optional; metrics are not
    matplotlib_ok = False

# The deployed operating points, quoted so the plots can mark them.
TAU_FACE = 0.35
TAU_VOICE = 0.30


def load(manifest_path):
    entries = json.load(open(manifest_path))
    for e in entries:
        doc = json.load(open(e["template"]))
        e["face_emb"] = np.asarray(doc["face"]["embedding"], float)
        e["face_frames"] = [np.asarray(f, float) for f in doc["face"]["frames"]]
        v = np.asarray(doc["voice"]["embedding"], float)
        n = np.linalg.norm(v)
        e["voice_emb"] = v / n if n else v
    return entries


def face_score(ref, probe):
    """Median per-frame cosine, exactly as matchFaceTemplate.py computes it."""
    if not probe["face_frames"]:
        return float("nan")
    return float(np.median([float(np.dot(ref["face_emb"], f)) for f in probe["face_frames"]]))


def voice_score(ref, probe):
    return float(np.dot(ref["voice_emb"], probe["voice_emb"]))


def sweep(genuine, impostor):
    """FAR/FRR across every distinct score, plus EER and AUC."""
    genuine = np.asarray([g for g in genuine if np.isfinite(g)])
    impostor = np.asarray([i for i in impostor if np.isfinite(i)])
    if genuine.size == 0 or impostor.size == 0:
        return None
    thresholds = np.unique(np.concatenate([genuine, impostor]))
    thresholds = np.concatenate([[-1.0], thresholds, [1.0]])
    far = np.array([(impostor >= t).mean() for t in thresholds])   # accept an impostor
    frr = np.array([(genuine < t).mean() for t in thresholds])     # reject a genuine
    idx = int(np.argmin(np.abs(far - frr)))
    eer = float((far[idx] + frr[idx]) / 2)
    order = np.argsort(far)
    # np.trapz was removed in numpy 2.0; np.trapezoid replaces it. Resolve
    # lazily — getattr's default is evaluated eagerly and would raise on 2.x.
    trapz = np.trapezoid if hasattr(np, "trapezoid") else np.trapz
    auc = float(trapz((1 - frr)[order], far[order]))
    return {
        "thresholds": thresholds.tolist(),
        "far": far.tolist(),
        "frr": frr.tolist(),
        "eer": eer,
        "eer_threshold": float(thresholds[idx]),
        "auc": abs(auc),
        "n_genuine": int(genuine.size),
        "n_impostor": int(impostor.size),
    }


def operating_point(genuine, impostor, tau):
    genuine = np.asarray([g for g in genuine if np.isfinite(g)])
    impostor = np.asarray([i for i in impostor if np.isfinite(i)])
    return {
        "threshold": tau,
        "far": float((impostor >= tau).mean()) if impostor.size else None,
        "frr": float((genuine < tau).mean()) if genuine.size else None,
    }


def main():
    if len(sys.argv) < 3:
        print("usage: evaluate_corpus.py <manifest.json> <out_dir>", file=sys.stderr)
        return 2
    manifest_path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    entries = load(manifest_path)

    rows = []
    for a, b in itertools.combinations(entries, 2):
        same = a["subject"] == b["subject"]
        # Same subject AND same session would be a recording against itself.
        if same and a["session"] == b["session"]:
            continue
        rows.append({
            "reference": f'{a["subject"]}_s{a["session"]}',
            "probe": f'{b["subject"]}_s{b["session"]}',
            "type": "genuine" if same else "impostor",
            "face_cosine": round(face_score(a, b), 6),
            "voice_cosine": round(voice_score(a, b), 6),
        })

    if not rows:
        print("no comparable pairs in corpus", file=sys.stderr)
        return 1

    with open(os.path.join(out_dir, "scores.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    metrics = {"n_pairs": len(rows)}
    for mod, key, tau in (("face", "face_cosine", TAU_FACE), ("voice", "voice_cosine", TAU_VOICE)):
        gen = [r[key] for r in rows if r["type"] == "genuine"]
        imp = [r[key] for r in rows if r["type"] == "impostor"]
        s = sweep(gen, imp)
        if s is None:
            metrics[mod] = {"error": "need at least one genuine and one impostor pair"}
            continue
        s["deployed_operating_point"] = operating_point(gen, imp, tau)
        metrics[mod] = s
        print(f"{mod}: EER={s['eer']*100:.2f}%  AUC={s['auc']:.4f}  "
              f"(n_genuine={s['n_genuine']}, n_impostor={s['n_impostor']})")
        op = s["deployed_operating_point"]
        print(f"  at deployed threshold {tau}: FAR={op['far']*100:.2f}%  FRR={op['frr']*100:.2f}%")

    # Fused decision: the conjunctive rule of the paper (both factors must pass).
    gen_rows = [r for r in rows if r["type"] == "genuine"]
    imp_rows = [r for r in rows if r["type"] == "impostor"]
    if gen_rows and imp_rows:
        def passes(r):
            return r["face_cosine"] >= TAU_FACE and r["voice_cosine"] >= TAU_VOICE
        fused_frr = float(np.mean([not passes(r) for r in gen_rows]))
        fused_far = float(np.mean([passes(r) for r in imp_rows]))
        metrics["fused_and_rule"] = {
            "tau_face": TAU_FACE, "tau_voice": TAU_VOICE,
            "far": fused_far, "frr": fused_frr,
            "note": "biometric factors only; the CAPTCHA factor is not a biometric trial",
        }
        print(f"fused (AND, face>={TAU_FACE} & voice>={TAU_VOICE}): "
              f"FAR={fused_far*100:.2f}%  FRR={fused_frr*100:.2f}%")

    json.dump(metrics, open(os.path.join(out_dir, "metrics.json"), "w"), indent=2)

    if not matplotlib_ok:
        print("matplotlib unavailable; metrics written, figures skipped", file=sys.stderr)
        return 0

    fig, ax = plt.subplots(figsize=(5.2, 4.2))
    for mod, colour in (("face", "#12395c"), ("voice", "#b3261e")):
        m = metrics.get(mod, {})
        if "far" not in m:
            continue
        ax.plot(np.array(m["far"]) * 100, np.array(m["frr"]) * 100, color=colour,
                label=f"{mod} (EER {m['eer']*100:.2f}%)")
    ax.set_xlabel("False acceptance rate (%)")
    ax.set_ylabel("False rejection rate (%)")
    ax.set_title("DET curves")
    ax.grid(alpha=0.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, "fig_det.png"), dpi=200)

    fig, axes = plt.subplots(1, 2, figsize=(9, 3.6))
    for ax, (mod, key, tau) in zip(axes, (("face", "face_cosine", TAU_FACE),
                                          ("voice", "voice_cosine", TAU_VOICE))):
        gen = [r[key] for r in rows if r["type"] == "genuine"]
        imp = [r[key] for r in rows if r["type"] == "impostor"]
        ax.hist(imp, bins=25, alpha=0.65, label="impostor", color="#b3261e")
        ax.hist(gen, bins=25, alpha=0.65, label="genuine", color="#0a7d3f")
        ax.axvline(tau, ls="--", color="#1a1a1a", label=f"threshold {tau}")
        ax.set_title(f"{mod} cosine similarity")
        ax.set_xlabel("score")
        ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, "fig_score_dist.png"), dpi=200)
    return 0


if __name__ == "__main__":
    sys.exit(main())
