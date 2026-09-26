// Reproducible biometric evaluation harness.
//
// This exists because the paper reports NO recognition-accuracy metric: the
// enrolment corpus that survived template-only storage holds three distinct
// identities, which admits one genuine pairing and three impostor pairings —
// far too few for an error-rate estimate. Rather than fabricate one, the study
// is automated here so it runs end to end the moment real recordings exist.
//
// Corpus layout (one directory, flat):
//
//     <corpus>/<subject>_s<session>.mp4
//
// e.g. p01_s1.mp4, p01_s2.mp4, p02_s1.mp4, ...  Subject id must match
// [A-Za-z0-9-]+ and session must be an integer. Two sessions per subject is the
// minimum: genuine pairs are BETWEEN sessions, never within one recording, so a
// single session per subject yields no genuine pairs at all.
//
// Usage (from backend/):
//   node scripts/run_evaluation.mjs <corpus_dir> [out_dir]
//
// Produces in <out_dir> (default ../evaluation_out):
//   templates/            one extracted template per recording
//   scores.csv            every pair, its type, and both similarity scores
//   metrics.json          FAR/FRR at each threshold, EER, AUC per modality
//   fig_det.png,          DET and score-distribution figures, publication ready
//   fig_score_dist.png
//
// The harness refuses to emit metrics from a corpus too small to support them.

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import crypto from "crypto";
import { runExtractTemplate } from "../templateStore.js";
import ENV from "../config.js";

const MIN_SUBJECTS = 5; // below this an EER is not meaningfully estimable
const MIN_SESSIONS = 2; // genuine pairs require two recordings of one person

const [corpusDir, outDir = "../evaluation_out"] = process.argv.slice(2);

if (!corpusDir) {
  console.error("usage: run_evaluation.mjs <corpus_dir> [out_dir]");
  process.exit(2);
}
if (!fs.existsSync(corpusDir)) {
  console.error(`corpus directory not found: ${corpusDir}`);
  process.exit(2);
}

// Subject may itself contain '_' (usernames allow it), so match the LAST
// _s<digits> as the session separator rather than a restrictive subject class.
// This is the naming evalCapture.js writes: <username>_s<session>.mp4.
const NAME = /^(.+)_s(\d+)\.mp4$/;

const recordings = fs
  .readdirSync(corpusDir)
  .map((f) => {
    const m = NAME.exec(f);
    return m ? { file: path.join(corpusDir, f), subject: m[1], session: Number(m[2]) } : null;
  })
  .filter(Boolean);

if (recordings.length === 0) {
  console.error(
    `no recordings matched <subject>_s<session>.mp4 in ${corpusDir}\n` +
      "example: p01_s1.mp4, p01_s2.mp4, p02_s1.mp4"
  );
  process.exit(2);
}

// Provenance and per-recording device labels, when the corpus was built by
// scripts/ingest_public_corpus.mjs. The device label is what lets the metrics
// stage split genuine pairs into within-device and cross-device, which is the
// only honest basis for a cross-device robustness claim. A hand-assembled
// corpus has no sidecar; the run proceeds and the split is simply not reported.
const metaPath = path.join(corpusDir, "corpus_meta.json");
const corpusMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : null;
const deviceOf = Object.fromEntries(
  (corpusMeta?.recordings_index ?? []).map((r) => [r.recording, r.device])
);
if (corpusMeta) {
  console.log(`corpus provenance: ${corpusMeta.dataset} (${corpusMeta.profile})`);
  if (corpusMeta.speaker_model_overlap?.startsWith("TRAINING-SET OVERLAP")) {
    console.warn(`!! ${corpusMeta.speaker_model_overlap}`);
  }
} else {
  console.log(
    "no corpus_meta.json: provenance and device labels unknown. " +
      "Build the corpus with scripts/ingest_public_corpus.mjs to record them."
  );
}

const subjects = [...new Set(recordings.map((r) => r.subject))].sort();
const sessionsPerSubject = Object.fromEntries(
  subjects.map((s) => [
    s,
    new Set(recordings.filter((r) => r.subject === s).map((r) => r.session)).size,
  ])
);
const shortSubjects = subjects.filter((s) => sessionsPerSubject[s] < MIN_SESSIONS);

console.log(`corpus: ${recordings.length} recordings, ${subjects.length} subjects`);
for (const s of subjects) console.log(`  ${s}: ${sessionsPerSubject[s]} session(s)`);

const fatal = [];
if (subjects.length < MIN_SUBJECTS) {
  fatal.push(
    `only ${subjects.length} subject(s); at least ${MIN_SUBJECTS} are required before an ` +
      "error rate is worth reporting (impostor pairs grow as n(n-1)/2)"
  );
}
if (shortSubjects.length) {
  fatal.push(
    `subject(s) with fewer than ${MIN_SESSIONS} sessions: ${shortSubjects.join(", ")}. ` +
      "Genuine pairs must come from DIFFERENT recordings of the same person; " +
      "comparing a recording against itself is not a genuine trial."
  );
}

// ---------------------------------------------------------------- extraction
const templatesDir = path.join(outDir, "templates");
fs.mkdirSync(templatesDir, { recursive: true });

const extracted = [];
for (const r of recordings) {
  const out = path.join(templatesDir, `${r.subject}_s${r.session}.json`);
  process.stdout.write(`extracting ${path.basename(r.file)} ... `);
  const { code, stderr } = await runExtractTemplate(r.file, out);
  if (code !== 0) {
    console.log(`FAILED (${stderr.trim()})`);
    continue;
  }
  const doc = JSON.parse(fs.readFileSync(out, "utf8"));
  console.log(`ok (${doc.face.n_frames} face frames)`);
  extracted.push({
    ...r,
    template: out,
    nFrames: doc.face.n_frames,
    sha: crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex"),
  });
}

if (extracted.length === 0) {
  console.error("no recording yielded a template; nothing to evaluate");
  process.exit(1);
}

// ------------------------------------------------- duplicate-enrolment check
// The corpus is invalid if two recordings produce an identical template: that
// means the same file was enrolled twice under different names, which silently
// turns impostor trials into genuine ones. This is exactly what happened to the
// original corpus, so it is checked every run and treated as fatal.
const bySha = {};
for (const e of extracted) (bySha[e.sha] ??= []).push(`${e.subject}_s${e.session}`);
const dupes = Object.values(bySha).filter((g) => g.length > 1);

console.log(`\nduplicate-template check: ${dupes.length === 0 ? "PASS" : "FAIL"}`);
for (const g of dupes) console.log(`  identical templates: ${g.join(", ")}`);
if (dupes.length) {
  fatal.push(`duplicate templates detected (${dupes.length} group(s)) — corpus is invalid`);
}

const thin = extracted.filter((e) => e.nFrames < 4);
if (thin.length) {
  console.log(
    "\nwarning: thin enrolment(s) with <4 usable face frames: " +
      thin.map((e) => `${e.subject}_s${e.session}(${e.nFrames})`).join(", ")
  );
}

if (fatal.length) {
  console.error("\nEVALUATION NOT RUN — the corpus cannot support the reported metrics:");
  for (const f of fatal) console.error(`  - ${f}`);
  console.error(
    "\nTemplates were still written, so extraction can be inspected. " +
      "Add the missing recordings and re-run; no metrics are emitted from an inadequate corpus."
  );
  process.exit(1);
}

// ------------------------------------------------------- scoring and metrics
const manifest = path.join(outDir, "manifest.json");
fs.writeFileSync(
  manifest,
  JSON.stringify(
    extracted.map(({ subject, session, template, nFrames }) => ({
      subject,
      session,
      template,
      nFrames,
      device: deviceOf[`${subject}_s${session}`] ?? null,
    })),
    null,
    2
  )
);

// Hand the provenance to the metrics stage so metrics.json is self-describing:
// a results file that cannot say which corpus produced it is not citable.
if (corpusMeta) {
  fs.writeFileSync(path.join(outDir, "corpus_meta.json"), JSON.stringify(corpusMeta, null, 2));
}

console.log("\nscoring pairs and computing metrics ...");
const py = spawn(ENV.PYTHON, ["./scripts/evaluate_corpus.py", manifest, outDir], {
  stdio: "inherit",
});
py.on("close", (code) => {
  if (code === 0) {
    console.log(
      `\ndone. Results in ${outDir}/ (scores.csv, metrics.json, fig_det.png, fig_score_dist.png)`
    );
  }
  process.exit(code ?? 1);
});
