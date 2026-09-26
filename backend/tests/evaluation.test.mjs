// Verifies the recognition-accuracy metrics on a corpus whose answer is known.
//
// The paper quotes EER, AUC, FAR/FRR and the independence comparison straight
// out of evaluate_corpus.py, so the arithmetic has to be checked against a case
// where the right answer can be worked out by hand rather than trusted.
//
// The synthetic corpus is built from orthogonal basis vectors: every subject
// gets its own axis, so genuine cosines are ~1 and impostor cosines are exactly
// 0. That is perfect separation, which pins down every metric:
//
//   EER = 0, AUC = 1, FAR at any positive threshold = 0, FRR = 0
//
// A harness that cannot reproduce those numbers on a separable corpus cannot be
// trusted on a real one.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const FACE_DIM = 512;
const VOICE_DIM = 192;
const SUBJECTS = 6;
const SESSIONS = 3; // s1,s2 on one device and s3 on another, for the device split
const FRAMES = 3;

// The deployed thresholds, duplicated here on purpose: if someone changes
// evaluate_corpus.py's constants without changing the matchers, this test
// should notice rather than silently follow along.
const TAU_FACE = 0.35;
const TAU_VOICE = 0.3;

/** normalize(a*e_i + b*e_j) -- a unit vector a known angle away from e_i. */
function tilted(dim, i, j, a, b) {
  const v = new Array(dim).fill(0);
  v[i] = a;
  v[j] = b;
  const n = Math.hypot(a, b);
  return v.map((x) => x / n);
}

/** Resolve a python that can import numpy, or null when there is none. */
function findPython() {
  for (const p of [process.env.PYTHON, "python3", "python"].filter(Boolean)) {
    if (spawnSync(p, ["-c", "import numpy"], { stdio: "ignore" }).status === 0) return p;
  }
  return null;
}

function buildCorpus(dir) {
  const manifest = [];
  for (let s = 0; s < SUBJECTS; s++) {
    for (let sess = 1; sess <= SESSIONS; sess++) {
      // Each session sits slightly off the subject's own axis, so genuine pairs
      // are close but never identical -- an exact self-match would score 1.0 and
      // hide an off-by-one in the pairing logic. The tilt axis is unique to the
      // RECORDING, not shared across subjects: a shared tilt axis leaks a common
      // component into every embedding and impostor cosines stop being exactly 0.
      const tilt = 0.02 * sess;
      const axis = SUBJECTS + s * SESSIONS + sess;
      const face = tilted(FACE_DIM, s, axis, 1, tilt);
      const voice = tilted(VOICE_DIM, s, axis, 1, tilt);
      const doc = {
        version: 2,
        face: {
          embedding: face,
          frames: Array.from({ length: FRAMES }, () => face),
          n_frames: FRAMES,
        },
        voice: { embedding: voice, model: "ecapa-voxceleb", n_samples: 16000 },
      };
      const file = path.join(dir, `p${s + 1}_s${sess}.json`);
      fs.writeFileSync(file, JSON.stringify(doc));
      manifest.push({
        subject: `p${s + 1}`,
        session: sess,
        template: file,
        nFrames: FRAMES,
        device: sess === SESSIONS ? "deviceB" : "deviceA",
      });
    }
  }
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

/** scores.csv rows, CRLF-normalised (Python's csv module always writes \r\n). */
function readRows(file) {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((l) => l.replace(/\r$/, ""));
}

function runMetrics(python, manifestPath, dir) {
  return spawnSync(python, [path.join("scripts", "evaluate_corpus.py"), manifestPath, dir], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
  });
}

const python = findPython();
const skip = python ? false : "no python with numpy on PATH";

test("metrics are exact on a perfectly separable corpus", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evaltest-"));
  try {
    const manifestPath = buildCorpus(dir);
    // A measured third-factor rejection rate, so the independence comparison
    // exercises its three-factor branch rather than the two-factor one.
    fs.writeFileSync(
      path.join(dir, "challenge_metrics.json"),
      JSON.stringify({ frr: 0.08, n_trials: 50 })
    );

    const r = runMetrics(python, manifestPath, dir);
    assert.equal(r.status, 0, `evaluate_corpus.py failed:\n${r.stderr}`);

    const m = JSON.parse(fs.readFileSync(path.join(dir, "metrics.json"), "utf8"));

    // Pair counts: genuine = subjects * C(sessions,2); impostor = C(subjects,2) * sessions^2.
    const expectedGenuine = SUBJECTS * ((SESSIONS * (SESSIONS - 1)) / 2);
    const expectedImpostor = ((SUBJECTS * (SUBJECTS - 1)) / 2) * SESSIONS * SESSIONS;
    assert.equal(m.counts.genuine, expectedGenuine);
    assert.equal(m.counts.impostor, expectedImpostor);
    assert.equal(m.n_pairs, expectedGenuine + expectedImpostor);

    for (const mod of ["face", "voice"]) {
      assert.equal(m[mod].eer, 0, `${mod} EER should be 0 on a separable corpus`);
      assert.equal(m[mod].auc, 1, `${mod} AUC should be 1 on a separable corpus`);
      assert.equal(m[mod].impostor_max, 0, `${mod} impostor cosine should be exactly 0`);
      assert.ok(m[mod].genuine_min > 0.99, `${mod} genuine floor unexpectedly low`);
      assert.equal(m[mod].deployed_operating_point.far, 0);
      assert.equal(m[mod].deployed_operating_point.frr, 0);
      // The EER threshold must fall in the gap between the two populations.
      assert.ok(
        m[mod].eer_threshold > 0 && m[mod].eer_threshold <= m[mod].genuine_min,
        `${mod} EER threshold ${m[mod].eer_threshold} is outside the impostor/genuine gap`
      );
    }

    // Conjunctive rule over both biometric factors.
    assert.equal(m.fused_and_rule.far, 0);
    assert.equal(m.fused_and_rule.frr, 0);
    assert.equal(m.fused_and_rule.tau_face, TAU_FACE);
    assert.equal(m.fused_and_rule.tau_voice, TAU_VOICE);

    // Independence approximation, (6) and (7). With per-factor FAR = 0 and
    // FRR = 0 the predicted FAR is 0, and the predicted FRR is driven entirely
    // by the challenge factor: 1 - (1-0)(1-0)(1-0.08) = 0.08.
    const ind = m.independence_check;
    assert.deepEqual(ind.factors_included, ["face", "voice", "challenge"]);
    assert.equal(ind.predicted_far, 0);
    assert.ok(Math.abs(ind.predicted_frr - 0.08) < 1e-12);
    assert.equal(ind.measured_far, 0);
    assert.equal(ind.measured_frr, 0);
    // The measured value sitting BELOW the prediction is exactly the kind of
    // finding the comparison exists to surface.
    assert.ok(ind.frr_delta < 0);

    // Cross-device split: s1,s2 share deviceA and s3 is deviceB, so every
    // subject contributes one within-device and two cross-device genuine pairs.
    assert.equal(m.cross_device.available, true);
    assert.equal(m.cross_device.n_genuine_within, SUBJECTS);
    assert.equal(m.cross_device.n_genuine_cross, SUBJECTS * 2);
    for (const mod of ["face", "voice"]) {
      assert.equal(m.cross_device[mod].within_device.frr_at_deployed_tau, 0);
      assert.equal(m.cross_device[mod].cross_device.frr_at_deployed_tau, 0);
    }

    // The paper \input{}s results.tex, so the macros it relies on must exist.
    const tex = fs.readFileSync(path.join(dir, "results.tex"), "utf8");
    for (const macro of [
      "\\newcommand{\\EvalFaceEER}",
      "\\newcommand{\\EvalVoiceEER}",
      "\\newcommand{\\EvalFaceAUC}",
      "\\newcommand{\\EvalFaceEERTau}",
      "\\newcommand{\\EvalGenuinePairs}",
      "\\newcommand{\\EvalImpostorPairs}",
      "\\newcommand{\\EvalAccuracyRows}",
      "\\newcommand{\\EvalIndependenceRows}",
      "\\newcommand{\\EvalCrossDeviceRows}",
    ]) {
      assert.ok(tex.includes(macro), `results.tex is missing ${macro}`);
    }
    assert.ok(tex.includes(`{${expectedGenuine}}`), "genuine pair count not emitted to LaTeX");

    // scores.csv is the artefact a reviewer asks to see; it must carry one row
    // per pair and the device relation used for the split.
    // Python's csv module terminates rows with CRLF per RFC 4180, on every
    // platform, so the rows are split on \n and the \r trimmed.
    const csv = readRows(path.join(dir, "scores.csv"));
    assert.equal(csv.length, expectedGenuine + expectedImpostor + 1);
    assert.equal(csv[0], "reference,probe,type,same_device,face_cosine,voice_cosine");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a recording is never paired with itself", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evalself-"));
  try {
    const manifestPath = buildCorpus(dir);
    const r = runMetrics(python, manifestPath, dir);
    assert.equal(r.status, 0, r.stderr);

    // A self-comparison scores 1.0 and would silently deflate the FRR, so the
    // pairing must never emit one. This is the single assumption the whole
    // genuine-pair protocol rests on.
    const rows = readRows(path.join(dir, "scores.csv")).slice(1);
    for (const row of rows) {
      const [reference, probe] = row.split(",");
      assert.notEqual(reference, probe, `self-pair emitted: ${row}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
