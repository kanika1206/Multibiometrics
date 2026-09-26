// Build an evaluation corpus from a PUBLIC audio-visual dataset.
//
// Why this exists
// ---------------
// The recognition-accuracy evaluation needs genuine pairs formed across
// DIFFERENT sessions of the same person and impostor pairs formed across
// different people. Template-only storage means the deployed system's own
// enrolment recordings are destroyed and can never be re-scored, so the corpus
// has to come from somewhere else. Collecting one from human subjects needs
// consent and ethics approval; a public, already-consented dataset does not.
//
// This script is the adapter: it maps a downloaded public dataset's directory
// layout onto the flat `<subject>_s<session>.mp4` layout run_evaluation.mjs
// expects, and writes a corpus_meta.json recording the provenance, the device
// each recording came from, and the licence/consent basis -- the three things a
// reviewer asks for first.
//
// It does NOT download anything. Datasets carry their own licences and access
// forms; you accept those yourself and point this at the extracted tree.
//
// Usage (from backend/):
//   node scripts/ingest_public_corpus.mjs --profile <name> --src <dir> --out <dir> [options]
//
//   --profile          one of: voxceleb2 voxceleb1 ravdess cremad mobio generic
//   --src              root of the extracted dataset
//   --out              corpus directory to create (feed this to run_evaluation.mjs)
//   --max-subjects N   cap the number of subjects (default 40)
//   --sessions N       sessions to keep per subject (default 3, minimum 2)
//   --clip-seconds N   trim each recording to N seconds (default 8, 0 = no trim)
//   --link             copy without re-encoding instead of trimming
//   --dry-run          report the planned corpus without writing it
//
// A note on which dataset to pick
// -------------------------------
// The deployed voice factor is SpeechBrain's spkrec-ecapa-voxceleb, which is
// TRAINED on the VoxCeleb1+2 development sets. Evaluating it on VoxCeleb2-dev
// therefore scores a model on its own training data and reports an EER that is
// not honest. Two acceptable choices:
//
//   * a corpus outside that training set entirely (RAVDESS, CREMA-D, MOBIO) --
//     this is the safe default and what --profile ravdess/cremad/mobio give you;
//   * VoxCeleb1 *test* identities only (id10270-id10309), which are held out of
//     the training set -- --profile voxceleb1 warns unless the identities it
//     finds fall in that range.
//
// The script refuses to stay silent about this: every corpus_meta.json records
// a `speaker_model_overlap` verdict that belongs in the paper's evaluation
// section.

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

// ----------------------------------------------------------------- arguments
function parseArgs(argv) {
  const out = { maxSubjects: 40, sessions: 3, clipSeconds: 8, link: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--profile") out.profile = next();
    else if (a === "--src") out.src = next();
    else if (a === "--out") out.out = next();
    else if (a === "--max-subjects") out.maxSubjects = Number(next());
    else if (a === "--sessions") out.sessions = Number(next());
    else if (a === "--clip-seconds") out.clipSeconds = Number(next());
    else if (a === "--pattern") out.pattern = next();
    else if (a === "--link") out.link = true;
    else if (a === "--dry-run") out.dryRun = true;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (!args.profile || !args.src || !args.out) {
  console.error(
    "usage: ingest_public_corpus.mjs --profile <name> --src <dir> --out <dir>\n" +
      "profiles: voxceleb2 voxceleb1 ravdess cremad mobio generic\n" +
      "see the header of this file for options and for which dataset to choose"
  );
  process.exit(2);
}
if (!fs.existsSync(args.src)) {
  console.error(`source directory not found: ${args.src}`);
  process.exit(2);
}
if (args.sessions < 2) {
  console.error(
    "--sessions must be at least 2: genuine pairs are formed BETWEEN sessions, " +
      "so one session per subject yields no genuine trials at all"
  );
  process.exit(2);
}

// ------------------------------------------------------------------ profiles
//
// A profile turns a dataset-relative file path into { subject, session, device }
// or null when the file is not a usable recording. `session` is a STRING key
// here (a source-video id, a take number); it is mapped to a dense integer per
// subject below, because the harness names files `<subject>_s<integer>`.

const VIDEO_EXT = new Set([".mp4", ".flv", ".avi", ".mov", ".mkv", ".webm", ".m4v"]);

const PROFILES = {
  // <src>/<id01234>/<source-video-id>/<00001>.mp4
  // A different source video is a genuinely different session: different day,
  // different room, different camera, often years apart.
  voxceleb2: {
    label: "VoxCeleb2",
    consent: "Public dataset of interview footage; released for research use under its own terms.",
    devices: "Uncontrolled: each source video is a distinct, unknown capture device.",
    overlap: "TRAINING-SET OVERLAP: spkrec-ecapa-voxceleb is trained on VoxCeleb2-dev.",
    map(rel) {
      const parts = rel.split(path.sep);
      if (parts.length < 3) return null;
      return { subject: parts[0], session: parts[1], device: `source-video:${parts[1]}` };
    },
  },

  // Same layout as VoxCeleb2. Only the test identities (id10270-id10309) are
  // held out of the speaker model's training data.
  voxceleb1: {
    label: "VoxCeleb1",
    consent: "Public dataset of interview footage; released for research use under its own terms.",
    devices: "Uncontrolled: each source video is a distinct, unknown capture device.",
    overlap: null, // decided per-corpus below, from the identities actually found
    map(rel) {
      const parts = rel.split(path.sep);
      if (parts.length < 3) return null;
      return { subject: parts[0], session: parts[1], device: `source-video:${parts[1]}` };
    },
  },

  // <src>/Actor_01/02-01-06-01-02-01-01.mp4
  // Fields: modality-vocalChannel-emotion-intensity-statement-repetition-actor.
  // A session is one (statement, repetition) take. All takes are one studio
  // sitting, so RAVDESS supports genuine/impostor pairing but NOT a cross-device
  // or cross-day claim; corpus_meta.json says so.
  ravdess: {
    label: "RAVDESS",
    consent: "Public dataset (Zenodo, CC BY-NC-SA 4.0); actors consented to open release.",
    devices: "Single controlled studio capture; no device variation.",
    overlap: "No overlap: the speaker model is not trained on RAVDESS.",
    map(rel) {
      const f = path.basename(rel, path.extname(rel)).split("-");
      if (f.length !== 7) return null;
      const [modality, , emotion, intensity, statement, repetition, actor] = f;
      if (modality === "03") return null; // audio-only: no face to verify
      return {
        subject: `rav${actor}`,
        session: `st${statement}r${repetition}e${emotion}i${intensity}`,
        device: "studio",
      };
    },
  },

  // <src>/VideoFlash/1001_DFA_ANG_XX.flv
  cremad: {
    label: "CREMA-D",
    consent: "Public dataset (Open Database License); actors consented to open release.",
    devices: "Single controlled studio capture; no device variation.",
    overlap: "No overlap: the speaker model is not trained on CREMA-D.",
    map(rel) {
      const f = path.basename(rel, path.extname(rel)).split("_");
      if (f.length < 3) return null;
      const [actor, sentence, emotion] = f;
      if (!/^\d{4}$/.test(actor)) return null;
      return { subject: `crema${actor}`, session: `${sentence}_${emotion}`, device: "studio" };
    },
  },

  // MOBIO ships mobile-phone and laptop captures of the same subjects across
  // twelve sessions. It is the only listed option that supports a real
  // cross-device claim, which is why the harness keeps the device label.
  mobio: {
    label: "MOBIO",
    consent: "Licensed research dataset; subjects consented under the dataset's own protocol.",
    devices: "Two device classes (mobile phone, laptop) across twelve sessions.",
    overlap: "No overlap: the speaker model is not trained on MOBIO.",
    map(rel) {
      const lower = rel.toLowerCase();
      const device = lower.includes("mobile") ? "mobile" : lower.includes("laptop") ? "laptop" : null;
      if (!device) return null;
      const parts = rel.split(path.sep);
      // .../<device>/<subject>/<session>/<clip>.mp4 -- take the two path
      // components directly above the file as subject and session.
      if (parts.length < 3) return null;
      return {
        subject: parts[parts.length - 3],
        session: `${device}_${parts[parts.length - 2]}`,
        device,
      };
    },
  },

  // Escape hatch: --pattern is a JS regex with named groups over the path
  // relative to --src, e.g.
  //   --pattern "(?<subject>[^/\\\\]+)[/\\\\](?<session>[^/\\\\]+)[/\\\\].*"
  generic: {
    label: "user-supplied",
    consent: "Recorded in corpus_meta.json by the operator; state it in the paper.",
    devices: "Unknown unless the pattern captures a <device> group.",
    overlap: "Not assessed: confirm the speaker model was not trained on this data.",
    map(rel) {
      if (!args.pattern) {
        console.error("--profile generic requires --pattern with (?<subject>) and (?<session>)");
        process.exit(2);
      }
      const m = new RegExp(args.pattern).exec(rel);
      if (!m?.groups?.subject || !m.groups.session) return null;
      return {
        subject: m.groups.subject,
        session: m.groups.session,
        device: m.groups.device ?? "unknown",
      };
    },
  },
};

const profile = PROFILES[args.profile];
if (!profile) {
  console.error(`unknown profile: ${args.profile} (have: ${Object.keys(PROFILES).join(", ")})`);
  process.exit(2);
}

// --------------------------------------------------------------- collection
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (VIDEO_EXT.has(path.extname(entry.name).toLowerCase())) yield full;
  }
}

console.log(`scanning ${args.src} as ${profile.label} ...`);

const found = [];
for (const file of walk(args.src)) {
  const info = profile.map(path.relative(args.src, file));
  if (info) found.push({ ...info, file });
}

if (found.length === 0) {
  console.error(
    `no recordings matched the ${args.profile} layout under ${args.src}.\n` +
      "Check that you pointed --src at the extracted dataset root, not at an archive."
  );
  process.exit(1);
}

// Group by subject, then by session, keeping one clip per session. Sorting
// before slicing makes the selection deterministic: the same --src and the same
// caps always produce the same corpus, so a reported EER is reproducible.
const bySubject = new Map();
for (const r of found.sort((a, b) => a.file.localeCompare(b.file))) {
  if (!bySubject.has(r.subject)) bySubject.set(r.subject, new Map());
  const sessions = bySubject.get(r.subject);
  if (!sessions.has(r.session)) sessions.set(r.session, r);
}

// Only subjects that actually have enough distinct sessions can contribute a
// genuine pair. Dropping the rest here (rather than letting run_evaluation.mjs
// fail) keeps the reported subject count equal to the count that was scored.
const eligible = [...bySubject.entries()]
  .filter(([, sessions]) => sessions.size >= args.sessions)
  .sort((a, b) => a[0].localeCompare(b[0]))
  .slice(0, args.maxSubjects);

const dropped = bySubject.size - eligible.length;
console.log(
  `found ${found.length} recordings, ${bySubject.size} subjects; ` +
    `${eligible.length} have >= ${args.sessions} sessions` +
    (dropped > 0 ? ` (${dropped} dropped as too few sessions)` : "")
);

if (eligible.length < 5) {
  console.error(
    `\nonly ${eligible.length} subject(s) qualify. run_evaluation.mjs requires at least 5 ` +
      "before an error rate is worth reporting. Lower --sessions or use a larger dataset."
  );
  if (!args.dryRun) process.exit(1);
}

// Expected trial counts, so the operator knows the size of the evaluation
// before spending an hour extracting templates. These are the numbers the paper
// must report as "genuine pairs" and "impostor pairs".
const k = args.sessions;
const nGenuine = eligible.length * ((k * (k - 1)) / 2);
const nImpostor = ((eligible.length * (eligible.length - 1)) / 2) * k * k;
console.log(
  `planned corpus: ${eligible.length} subjects x ${k} sessions = ${eligible.length * k} recordings\n` +
    `  genuine pairs (same subject, different session): ${nGenuine}\n` +
    `  impostor pairs (different subjects):             ${nImpostor}`
);

// --------------------------------------------- speaker-model overlap verdict
let overlap = profile.overlap;
if (args.profile === "voxceleb1") {
  const ids = eligible.map(([s]) => s);
  const heldOut = (id) => {
    const n = Number(/^id(\d+)$/.exec(id)?.[1]);
    return Number.isFinite(n) && n >= 10270 && n <= 10309;
  };
  const leaked = ids.filter((id) => !heldOut(id));
  overlap = leaked.length
    ? `TRAINING-SET OVERLAP: ${leaked.length} of ${ids.length} identities fall outside the ` +
      "held-out VoxCeleb1 test range (id10270-id10309) and are in the speaker model's " +
      "training data. Restrict --src to the test identities before reporting an EER."
    : "No overlap: every identity is in the held-out VoxCeleb1 test range (id10270-id10309).";
}
if (overlap?.startsWith("TRAINING-SET OVERLAP")) {
  console.warn(`\n!! ${overlap}`);
  console.warn("!! An EER measured this way flatters the voice factor and a reviewer will say so.\n");
}

if (args.dryRun) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

// --------------------------------------------------------------- materialise
fs.mkdirSync(args.out, { recursive: true });

const haveFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
if (args.clipSeconds > 0 && !args.link && !haveFfmpeg) {
  console.error(
    "ffmpeg not found on PATH; cannot trim or transcode. Re-run with --link to copy " +
      "the source files unchanged (slower extraction, larger corpus)."
  );
  process.exit(2);
}

const recordingsIndex = [];
let written = 0;
let failed = 0;

for (const [subject, sessions] of eligible) {
  // Dense 1..N session numbering, in the same deterministic order as above.
  const chosen = [...sessions.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, args.sessions);

  chosen.forEach(([sessionKey, rec], i) => {
    const target = path.join(args.out, `${subject}_s${i + 1}.mp4`);
    process.stdout.write(`  ${path.basename(target)} <- ${path.basename(rec.file)} ... `);

    if (args.link || args.clipSeconds === 0) {
      // Copy rather than hard-link: a hard link across volumes fails, and the
      // harness must never be able to mutate the source dataset.
      fs.copyFileSync(rec.file, target);
    } else {
      // Normalise to a container the deployed pipeline reads happily, trim to a
      // fixed length, and force 16 kHz mono audio -- the rate extractTemplate.py
      // resamples to anyway. Video is re-encoded because several of these
      // datasets ship codecs OpenCV cannot seek reliably.
      const r = spawnSync(
        "ffmpeg",
        [
          "-y", "-loglevel", "error",
          "-i", rec.file,
          "-t", String(args.clipSeconds),
          "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-ar", "16000", "-ac", "1",
          target,
        ],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      if (r.status !== 0) {
        console.log(`FAILED (${String(r.stderr).trim().split("\n").pop()})`);
        failed++;
        return;
      }
    }
    console.log("ok");
    written++;
    recordingsIndex.push({
      recording: `${subject}_s${i + 1}`,
      subject,
      session: i + 1,
      sessionKey,
      device: rec.device,
      source: path.relative(args.src, rec.file),
    });
  });
}

// corpus_meta.json is the provenance record the evaluation section cites: which
// dataset, on what consent basis, how many subjects and sessions, which device
// each recording came from, and whether the speaker model has seen any of it.
// run_evaluation.mjs picks up the device labels from here for the cross-device
// breakdown.
fs.writeFileSync(
  path.join(args.out, "corpus_meta.json"),
  JSON.stringify(
    {
      dataset: profile.label,
      profile: args.profile,
      source_root: path.resolve(args.src),
      generated: new Date().toISOString(),
      consent_basis: profile.consent,
      device_conditions: profile.devices,
      speaker_model: "speechbrain/spkrec-ecapa-voxceleb",
      speaker_model_overlap: overlap,
      face_model: "insightface buffalo_l (ArcFace)",
      clip_seconds: args.link ? null : args.clipSeconds || null,
      subjects: eligible.length,
      sessions_per_subject: args.sessions,
      recordings: written,
      expected_genuine_pairs: nGenuine,
      expected_impostor_pairs: nImpostor,
      pairing_protocol:
        "Genuine pairs are formed only between different sessions of the same subject; " +
        "impostor pairs are formed between different subjects. A recording is never " +
        "compared with itself.",
      recordings_index: recordingsIndex,
    },
    null,
    2
  )
);

console.log(
  `\nwrote ${written} recording(s)${failed ? `, ${failed} failed` : ""} to ${args.out}\n` +
    `provenance: ${path.join(args.out, "corpus_meta.json")}\n\n` +
    `next: node scripts/run_evaluation.mjs ${args.out} ../evaluation_out`
);
process.exit(failed && written === 0 ? 1 : 0);
