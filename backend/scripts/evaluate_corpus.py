"""Score an extracted corpus and compute recognition-accuracy metrics.

Invoked by run_evaluation.mjs; not meant to be run directly. Everything here is
deliberately identical to the DEPLOYED matchers, so the reported operating point
is the one the system actually uses:

  face  - median over the probe's per-frame embeddings of the dot product with
          the reference template embedding   (matchFaceTemplate.py:41-42)
  voice - dot product of the two L2-normalized ECAPA embeddings
          (matchVoiceTemplate.py)

Both are cosine similarities, accepted at >= threshold.

Pair labelling:
  genuine  - same subject, DIFFERENT sessions. Never a recording against itself:
             a self-comparison scores 1.0 and would flatter the FRR.
  impostor - different subjects.

What is produced
----------------
  scores.csv      every pair, its type, device relation, and both scores
  metrics.json    FAR/FRR sweep, EER, EER threshold, AUC, per modality;
                  the fused AND rule measured against the paper's independence
                  approximation; the within-device / cross-device split
  results.tex     newcommand macros and table bodies to \\input into the paper,
                  so no number is ever retyped by hand
  fig_roc.png     ROC curves (true accept against false accept)
  fig_det.png     DET curves (false reject against false accept)
  fig_score_dist.png  genuine and impostor score histograms per modality

Scoring the third factor
------------------------
The challenge factor is not a biometric trial and has no genuine/impostor pair
structure, so it is measured separately by evaluate_challenge.mjs. If that ran
first and left challenge_metrics.json in the output directory, its false
rejection rate is folded into the three-factor independence comparison here.

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

MODALITIES = (("face", "face_cosine", TAU_FACE), ("voice", "voice_cosine", TAU_VOICE))


def load(manifest_path):
    entries = json.load(open(manifest_path))
    for e in entries:
        doc = json.load(open(e["template"]))
        e["face_emb"] = np.asarray(doc["face"]["embedding"], float)
        e["face_frames"] = [np.asarray(f, float) for f in doc["face"]["frames"]]
        v = np.asarray(doc["voice"]["embedding"], float)
        n = np.linalg.norm(v)
        e["voice_emb"] = v / n if n else v
        e.setdefault("device", None)
    return entries


def face_score(ref, probe):
    """Median per-frame cosine, exactly as matchFaceTemplate.py computes it."""
    if not probe["face_frames"]:
        return float("nan")
    return float(np.median([float(np.dot(ref["face_emb"], f)) for f in probe["face_frames"]]))


def voice_score(ref, probe):
    return float(np.dot(ref["voice_emb"], probe["voice_emb"]))


def _clean(xs):
    return np.asarray([x for x in xs if np.isfinite(x)], float)


def auc_score(genuine, impostor):
    """AUC as P(genuine > impostor) + 0.5 P(tie) -- the Mann-Whitney identity.

    Computed from the ranks rather than by integrating the ROC polygon: the
    trapezoid of a step curve built from duplicate thresholds is sensitive to
    how ties are broken, and duplicate cosines are common on a small corpus.
    """
    if genuine.size == 0 or impostor.size == 0:
        return None
    allv = np.concatenate([genuine, impostor])
    order = allv.argsort(kind="mergesort")
    ranks = np.empty(allv.size, float)
    ranks[order] = np.arange(1, allv.size + 1)
    # Average the ranks within each tied group so a tie contributes exactly 0.5.
    _, inv, counts = np.unique(allv, return_inverse=True, return_counts=True)
    sums = np.zeros(counts.size)
    np.add.at(sums, inv, ranks)
    ranks = (sums / counts)[inv]
    n, m = genuine.size, impostor.size
    return float((ranks[:n].sum() - n * (n + 1) / 2) / (n * m))


def sweep(genuine, impostor):
    """FAR/FRR across every distinct score, plus EER, the EER threshold, and AUC."""
    genuine, impostor = _clean(genuine), _clean(impostor)
    if genuine.size == 0 or impostor.size == 0:
        return None
    thresholds = np.unique(np.concatenate([genuine, impostor]))
    thresholds = np.concatenate([[-1.0], thresholds, [1.0]])
    far = np.array([(impostor >= t).mean() for t in thresholds])   # accept an impostor
    frr = np.array([(genuine < t).mean() for t in thresholds])     # reject a genuine
    idx = int(np.argmin(np.abs(far - frr)))
    return {
        "thresholds": thresholds.tolist(),
        "far": far.tolist(),
        "frr": frr.tolist(),
        "eer": float((far[idx] + frr[idx]) / 2),
        "eer_threshold": float(thresholds[idx]),
        "eer_gap": float(abs(far[idx] - frr[idx])),
        "auc": auc_score(genuine, impostor),
        "n_genuine": int(genuine.size),
        "n_impostor": int(impostor.size),
        "genuine_mean": float(genuine.mean()),
        "genuine_min": float(genuine.min()),
        "impostor_mean": float(impostor.mean()),
        "impostor_max": float(impostor.max()),
    }


def operating_point(genuine, impostor, tau):
    genuine, impostor = _clean(genuine), _clean(impostor)
    return {
        "threshold": tau,
        "far": float((impostor >= tau).mean()) if impostor.size else None,
        "frr": float((genuine < tau).mean()) if genuine.size else None,
    }


def build_rows(entries):
    """Every admissible pair, labelled. Device relation is kept for the split."""
    rows = []
    for a, b in itertools.combinations(entries, 2):
        same = a["subject"] == b["subject"]
        # Same subject AND same session would be a recording against itself.
        if same and a["session"] == b["session"]:
            continue
        rows.append({
            "reference": a.get("recording") or f'{a["subject"]}_s{a["session"]}',
            "probe": b.get("recording") or f'{b["subject"]}_s{b["session"]}',
            "type": "genuine" if same else "impostor",
            # None when the corpus carried no device labels: reported as unknown
            # rather than silently counted as within-device.
            "same_device": (
                None if a["device"] is None or b["device"] is None
                else a["device"] == b["device"]
            ),
            "face_cosine": round(face_score(a, b), 6),
            "voice_cosine": round(voice_score(a, b), 6),
        })
    return rows


def fused(rows, tau_face, tau_voice):
    """The paper's conjunctive rule over the two biometric factors."""
    gen = [r for r in rows if r["type"] == "genuine"]
    imp = [r for r in rows if r["type"] == "impostor"]
    if not gen or not imp:
        return None

    def passes(r):
        return r["face_cosine"] >= tau_face and r["voice_cosine"] >= tau_voice

    return {
        "tau_face": tau_face,
        "tau_voice": tau_voice,
        "far": float(np.mean([passes(r) for r in imp])),
        "frr": float(np.mean([not passes(r) for r in gen])),
        "n_genuine": len(gen),
        "n_impostor": len(imp),
    }


def independence_check(metrics, fused_measured, challenge):
    """Measured AND-fusion error against the paper's (6) and (7).

      (6) FAR_sys ~ FAR_f * FAR_a * FAR_c
      (7) FRR_sys ~ 1 - (1 - FRR_f)(1 - FRR_a)(1 - FRR_c)

    Both assume the factors fail independently. They need not: the same degraded
    recording drives the face, the voice and the spoken challenge, so errors are
    plausibly correlated and the prediction can be wrong in either direction.
    Reporting the comparison is the point -- it is evidence about the modelling
    assumption, not a check that the code is right.
    """
    if fused_measured is None:
        return None
    face_op = metrics.get("face", {}).get("deployed_operating_point")
    voice_op = metrics.get("voice", {}).get("deployed_operating_point")
    if not face_op or not voice_op:
        return None
    if face_op["far"] is None or voice_op["far"] is None:
        return None

    terms_far = [face_op["far"], voice_op["far"]]
    terms_frr = [face_op["frr"], voice_op["frr"]]
    factors = ["face", "voice"]
    # The challenge factor's own FRR, when evaluate_challenge.mjs measured it.
    # Its FAR is not estimated from data: accepting a wrong spoken answer means
    # transcribing it as the issued code, which the challenge-space argument in
    # the security analysis bounds rather than measures.
    if challenge and challenge.get("frr") is not None:
        terms_frr.append(challenge["frr"])
        factors.append("challenge")

    pred_far = float(np.prod(terms_far))
    pred_frr = float(1 - np.prod([1 - x for x in terms_frr]))
    return {
        "factors_included": factors,
        "predicted_far": pred_far,
        "predicted_frr": pred_frr,
        "measured_far": fused_measured["far"],
        "measured_frr": fused_measured["frr"],
        "far_delta": fused_measured["far"] - pred_far,
        "frr_delta": fused_measured["frr"] - pred_frr,
        "note": (
            "Equations (6) and (7) assume the factors fail independently. A measured "
            "value above the prediction indicates positively correlated failures "
            "(one bad recording degrades several factors at once); below indicates "
            "the factors are catching different failures than the model assumes."
        ),
    }


def device_split(rows):
    """Within-device against cross-device genuine performance.

    Only genuine pairs are split. A cross-device impostor pair says nothing about
    device robustness -- two different people do not match regardless of what
    recorded them -- so the impostor set stays pooled and the FAR is common to
    both columns.
    """
    labelled = [r for r in rows if r["same_device"] is not None]
    if not labelled:
        return {"available": False, "reason": "corpus carried no device labels"}

    gen_within = [r for r in labelled if r["type"] == "genuine" and r["same_device"]]
    gen_cross = [r for r in labelled if r["type"] == "genuine" and not r["same_device"]]
    if not gen_within or not gen_cross:
        return {
            "available": False,
            "reason": (
                f"need genuine pairs of both kinds; have {len(gen_within)} within-device "
                f"and {len(gen_cross)} cross-device. A single-device corpus cannot "
                "support a cross-device claim."
            ),
        }

    imp = [r for r in labelled if r["type"] == "impostor"]
    out = {
        "available": True,
        "n_genuine_within": len(gen_within),
        "n_genuine_cross": len(gen_cross),
        "n_impostor": len(imp),
    }
    for mod, key, tau in MODALITIES:
        within = _clean([r[key] for r in gen_within])
        cross = _clean([r[key] for r in gen_cross])
        impostor = _clean([r[key] for r in imp])
        out[mod] = {
            "within_device": {
                "genuine_mean": float(within.mean()),
                "frr_at_deployed_tau": float((within < tau).mean()),
                "eer": (sweep(within, impostor) or {}).get("eer"),
            },
            "cross_device": {
                "genuine_mean": float(cross.mean()),
                "frr_at_deployed_tau": float((cross < tau).mean()),
                "eer": (sweep(cross, impostor) or {}).get("eer"),
            },
        }
    return out


# ------------------------------------------------------------------ LaTeX out
def _pct(x, nd=2):
    return "n/a" if x is None else f"{x * 100:.{nd}f}"


def _num(x, nd=4):
    return "n/a" if x is None else f"{x:.{nd}f}"


def write_latex(metrics, out_dir):
    """Emit macros and table bodies for \\input into the paper.

    Every number the paper quotes comes from here, so a re-run updates the paper
    and a quoted value can never drift from the run that produced it.
    """
    corpus = metrics.get("corpus") or {}
    face, voice = metrics.get("face", {}), metrics.get("voice", {})
    fus, ind = metrics.get("fused_and_rule"), metrics.get("independence_check")
    ch = metrics.get("challenge")

    def cmd(name, value):
        return "\\newcommand{\\%s}{%s}\n" % (name, value)

    tex = [
        "% Generated by backend/scripts/evaluate_corpus.py -- do not edit by hand.\n",
        "% Re-run the evaluation to refresh; \\input this file in the preamble.\n",
        "%% corpus: %s\n\n" % corpus.get("dataset", "unspecified"),
    ]
    tex.append(cmd("EvalCorpusName", corpus.get("dataset", "unspecified")))
    tex.append(cmd("EvalSubjects", corpus.get("subjects", "n/a")))
    tex.append(cmd("EvalSessions", corpus.get("sessions_per_subject", "n/a")))
    tex.append(cmd("EvalGenuinePairs", metrics.get("counts", {}).get("genuine", "n/a")))
    tex.append(cmd("EvalImpostorPairs", metrics.get("counts", {}).get("impostor", "n/a")))

    for name, obj in (("Face", face), ("Voice", voice)):
        tex.append(cmd("Eval%sEER" % name, _pct(obj.get("eer"))))
        tex.append(cmd("Eval%sAUC" % name, _num(obj.get("auc"))))
        tex.append(cmd("Eval%sEERTau" % name, _num(obj.get("eer_threshold"), 3)))
        op = obj.get("deployed_operating_point", {})
        tex.append(cmd("Eval%sFAR" % name, _pct(op.get("far"))))
        tex.append(cmd("Eval%sFRR" % name, _pct(op.get("frr"))))

    if fus:
        tex.append(cmd("EvalFusedFAR", _pct(fus.get("far"))))
        tex.append(cmd("EvalFusedFRR", _pct(fus.get("frr"))))
    if ind:
        tex.append(cmd("EvalPredFusedFAR", _pct(ind.get("predicted_far"))))
        tex.append(cmd("EvalPredFusedFRR", _pct(ind.get("predicted_frr"))))
    if ch and ch.get("frr") is not None:
        tex.append(cmd("EvalChallengeFRR", _pct(ch.get("frr"))))
        tex.append(cmd("EvalChallengeTrials", ch.get("n_trials", "n/a")))

    # Table body: per-modality accuracy. Column order matches the paper's
    # planned-evaluation table so the placeholder table swaps in directly.
    tex.append("\n% --- recognition accuracy table body ---\n")
    tex.append("\\newcommand{\\EvalAccuracyRows}{%\n")
    for label, obj in (
        ("Face, median per-frame cosine", face),
        ("Voice, ECAPA-TDNN cosine", voice),
    ):
        op = obj.get("deployed_operating_point", {})
        tex.append(
            "  %s & %s & %s & %s & %s & %s & %s & %s \\\\\n"
            % (
                label, obj.get("n_genuine", "n/a"), obj.get("n_impostor", "n/a"),
                _pct(obj.get("eer")), _num(obj.get("auc")),
                _pct(op.get("far")), _pct(op.get("frr")),
                _num(obj.get("eer_threshold"), 3),
            )
        )
    if ch and ch.get("frr") is not None:
        tex.append(
            "  Challenge, STT versus $C$ & -- & -- & n/a & n/a & n/a & %s & n/a \\\\\n"
            % _pct(ch.get("frr"))
        )
    if fus:
        tex.append(
            "  Fused, $b_f \\wedge b_a$ & %s & %s & n/a & n/a & %s & %s & n/a \\\\\n"
            % (fus.get("n_genuine"), fus.get("n_impostor"), _pct(fus.get("far")), _pct(fus.get("frr")))
        )
    tex.append("}\n")

    if ind:
        tex.append("\n% --- independence-approximation comparison body ---\n")
        tex.append("\\newcommand{\\EvalIndependenceRows}{%\n")
        tex.append(
            "  FAR & %s & %s & %s \\\\\n"
            % (_pct(ind["predicted_far"]), _pct(ind["measured_far"]), _pct(ind["far_delta"]))
        )
        tex.append(
            "  FRR & %s & %s & %s \\\\\n"
            % (_pct(ind["predicted_frr"]), _pct(ind["measured_frr"]), _pct(ind["frr_delta"]))
        )
        tex.append("}\n")

    dev = metrics.get("cross_device", {})
    if dev.get("available"):
        tex.append("\n% --- cross-device genuine-performance body ---\n")
        tex.append("\\newcommand{\\EvalCrossDeviceRows}{%\n")
        for mod in ("face", "voice"):
            d = dev.get(mod, {})
            w, c = d.get("within_device", {}), d.get("cross_device", {})
            tex.append(
                "  %s & %s & %s & %s & %s \\\\\n"
                % (
                    mod.capitalize(),
                    _num(w.get("genuine_mean"), 3), _pct(w.get("frr_at_deployed_tau")),
                    _num(c.get("genuine_mean"), 3), _pct(c.get("frr_at_deployed_tau")),
                )
            )
        tex.append("}\n")

    with open(os.path.join(out_dir, "results.tex"), "w") as f:
        f.writelines(tex)


# -------------------------------------------------------------------- figures
def write_figures(metrics, rows, out_dir):
    colours = {"face": "#12395c", "voice": "#b3261e"}

    # ROC: true accept against false accept.
    fig, ax = plt.subplots(figsize=(5.2, 4.2))
    for mod in ("face", "voice"):
        m = metrics.get(mod, {})
        if "far" not in m:
            continue
        ax.plot(
            np.array(m["far"]) * 100,
            (1 - np.array(m["frr"])) * 100,
            color=colours[mod],
            label="%s (AUC %s)" % (mod, _num(m.get("auc"))),
        )
    ax.plot([0, 100], [0, 100], ls=":", color="#888", lw=0.8, label="chance")
    ax.set_xlabel("False acceptance rate (%)")
    ax.set_ylabel("True acceptance rate (%)")
    ax.set_title("ROC curves")
    ax.grid(alpha=0.3)
    ax.legend(loc="lower right")
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, "fig_roc.png"), dpi=200)
    plt.close(fig)

    # DET: false reject against false accept, with the EER line marked.
    fig, ax = plt.subplots(figsize=(5.2, 4.2))
    for mod in ("face", "voice"):
        m = metrics.get(mod, {})
        if "far" not in m:
            continue
        ax.plot(
            np.array(m["far"]) * 100,
            np.array(m["frr"]) * 100,
            color=colours[mod],
            label="%s (EER %s%%)" % (mod, _pct(m.get("eer"))),
        )
    ax.plot([0, 100], [0, 100], ls=":", color="#888", lw=0.8, label="EER line")
    ax.set_xlabel("False acceptance rate (%)")
    ax.set_ylabel("False rejection rate (%)")
    ax.set_title("DET curves")
    ax.grid(alpha=0.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, "fig_det.png"), dpi=200)
    plt.close(fig)

    # Score distributions, with both the deployed threshold and the EER
    # threshold drawn -- the gap between the two lines is the threshold
    # re-justification the reviewer asked for, visible at a glance.
    fig, axes = plt.subplots(1, 2, figsize=(9, 3.6))
    for ax, (mod, key, tau) in zip(axes, MODALITIES):
        gen = [r[key] for r in rows if r["type"] == "genuine"]
        imp = [r[key] for r in rows if r["type"] == "impostor"]
        ax.hist(imp, bins=40, alpha=0.65, label="impostor", color="#b3261e", density=True)
        ax.hist(gen, bins=40, alpha=0.65, label="genuine", color="#0a7d3f", density=True)
        ax.axvline(tau, ls="--", color="#1a1a1a", label="deployed $\\tau$ = %s" % tau)
        eer_tau = metrics.get(mod, {}).get("eer_threshold")
        if eer_tau is not None:
            ax.axvline(eer_tau, ls="-.", color="#5b3fa8", label="EER $\\tau$ = %.3f" % eer_tau)
        ax.set_title("%s cosine similarity" % mod)
        ax.set_xlabel("score")
        ax.set_ylabel("density")
        ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, "fig_score_dist.png"), dpi=200)
    plt.close(fig)


def main():
    if len(sys.argv) < 3:
        print("usage: evaluate_corpus.py <manifest.json> <out_dir>", file=sys.stderr)
        return 2
    manifest_path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    entries = load(manifest_path)

    rows = build_rows(entries)
    if not rows:
        print("no comparable pairs in corpus", file=sys.stderr)
        return 1

    with open(os.path.join(out_dir, "scores.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    # Provenance and the third-factor result, when they exist. Both are written
    # by other stages; neither is required for the biometric metrics.
    def maybe(name):
        p = os.path.join(out_dir, name)
        return json.load(open(p)) if os.path.exists(p) else None

    corpus = maybe("corpus_meta.json")
    challenge = maybe("challenge_metrics.json")

    metrics = {
        "n_pairs": len(rows),
        "counts": {
            "genuine": sum(1 for r in rows if r["type"] == "genuine"),
            "impostor": sum(1 for r in rows if r["type"] == "impostor"),
        },
    }
    if corpus:
        metrics["corpus"] = {
            k: corpus[k]
            for k in (
                "dataset", "profile", "consent_basis", "device_conditions",
                "speaker_model_overlap", "subjects", "sessions_per_subject", "recordings",
            )
            if k in corpus
        }

    print("pairs: %d genuine, %d impostor" % (metrics["counts"]["genuine"], metrics["counts"]["impostor"]))

    for mod, key, tau in MODALITIES:
        gen = [r[key] for r in rows if r["type"] == "genuine"]
        imp = [r[key] for r in rows if r["type"] == "impostor"]
        s = sweep(gen, imp)
        if s is None:
            metrics[mod] = {"error": "need at least one genuine and one impostor pair"}
            continue
        s["deployed_operating_point"] = operating_point(gen, imp, tau)
        metrics[mod] = s
        op = s["deployed_operating_point"]
        print(
            "%s: EER=%.2f%% at tau=%.3f  AUC=%.4f  (n_genuine=%d, n_impostor=%d)"
            % (mod, s["eer"] * 100, s["eer_threshold"], s["auc"], s["n_genuine"], s["n_impostor"])
        )
        print("  at deployed tau=%s: FAR=%.2f%%  FRR=%.2f%%" % (tau, op["far"] * 100, op["frr"] * 100))
        # The threshold re-justification, stated rather than left to the reader:
        # if the deployed point sits far from the EER point, say which way.
        drift = tau - s["eer_threshold"]
        if abs(drift) >= 0.02:
            direction = "more permissive than" if drift < 0 else "stricter than"
            print(
                "  note: the deployed tau is %.3f %s the EER threshold (%.3f); "
                "either re-justify it or move it" % (abs(drift), direction, s["eer_threshold"])
            )

    fus = fused(rows, TAU_FACE, TAU_VOICE)
    if fus:
        fus["note"] = (
            "Biometric factors only. The challenge factor is not a biometric trial and "
            "is measured separately by evaluate_challenge.mjs."
        )
        metrics["fused_and_rule"] = fus
        print(
            "fused (AND, face>=%s & voice>=%s): FAR=%.2f%%  FRR=%.2f%%"
            % (TAU_FACE, TAU_VOICE, fus["far"] * 100, fus["frr"] * 100)
        )

    if challenge:
        metrics["challenge"] = challenge

    ind = independence_check(metrics, fus, challenge)
    if ind:
        metrics["independence_check"] = ind
        print(
            "independence approximation (%s): predicted FAR=%.3f%% vs measured %.3f%%; "
            "predicted FRR=%.2f%% vs measured %.2f%%"
            % (
                "+".join(ind["factors_included"]),
                ind["predicted_far"] * 100, ind["measured_far"] * 100,
                ind["predicted_frr"] * 100, ind["measured_frr"] * 100,
            )
        )

    dev = device_split(rows)
    metrics["cross_device"] = dev
    if dev.get("available"):
        for mod in ("face", "voice"):
            w, c = dev[mod]["within_device"], dev[mod]["cross_device"]
            print(
                "%s cross-device: genuine mean %.3f within vs %.3f across; "
                "FRR %.2f%% vs %.2f%%"
                % (
                    mod, w["genuine_mean"], c["genuine_mean"],
                    w["frr_at_deployed_tau"] * 100, c["frr_at_deployed_tau"] * 100,
                )
            )
    else:
        print("cross-device split not reported: %s" % dev.get("reason"))

    json.dump(metrics, open(os.path.join(out_dir, "metrics.json"), "w"), indent=2)
    write_latex(metrics, out_dir)
    print("wrote metrics.json and results.tex to %s" % out_dir)

    if not matplotlib_ok:
        print("matplotlib unavailable; metrics written, figures skipped", file=sys.stderr)
        return 0

    write_figures(metrics, rows, out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
