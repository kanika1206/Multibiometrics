// Presentation-attack harness: measured attack success rates against the
// deployed decision rule.
//
// Why this exists
// ---------------
// The paper claims resistance to straightforward replay of previously captured
// media. That is an empirical claim and it was never measured. This harness
// mounts each attack against the SAME code paths a real login uses -- the same
// template extractor, the same two matchers at the same thresholds, the same
// speech-to-text engine, the same normalization, and the conjunctive rule from
// decisionRule.js -- and reports how often each one is accepted.
//
// Every attack is reported four ways, because a system-level success rate of
// zero hides which factor actually did the work:
//
//   face ASR       the face factor accepted the attack medium
//   voice ASR      the speaker factor accepted it
//   challenge ASR  the spoken response matched the issued challenge
//   system ASR     all three, i.e. access was granted
//
// A face ASR of 1.0 with a system ASR of 0.0 is the interesting result: it says
// the face factor is defeated and the system survives only because of the other
// two. Reporting only the system number would hide that, and a security
// audience should see it.
//
// Corpus layout
// -------------
//   <corpus>/<subject>_s<session>__<code>.mp4
//
// e.g. p01_s1__93417.mp4 -- subject p01, session 1, in which the speaker reads
// the code 93417. The spoken code has to be known: the challenge factor cannot
// be scored against a recording when nobody knows what was said in it. Two
// sessions per subject are needed, because the enrolled reference and the
// attack medium must not be the same recording.
//
// Usage (from backend/):
//   node scripts/attack_suite.mjs --corpus ../attack_corpus [--out ../attack_out]
//        [--attacks replay,splice,photo,clone,faceswap]
//        [--clones <dir>] [--swaps <dir>] [--keep-media]
//
// Off-the-shelf attack tools are not invoked here and are not bundled. Produce
// the cloned audio or swapped video with whatever tool you are reporting on,
// name it as described under indexSupplied below, and this harness scores it.
// That keeps the measurement honest about which tool produced the attack.

import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { runExtractTemplate } from "../templateStore.js";
import { normalizeCaptcha } from "../captchaStore.js";
import { fuse, FUSION_RULE } from "../decisionRule.js";
import ENV from "../config.js";

// server.js issues svgCaptcha.create({ charPreset: "0123456789", size: 5 }).
// The harness mints challenges from the same alphabet and length, so the
// challenge-space argument in the security analysis describes these trials too.
const CHALLENGE_ALPHABET = "0123456789";
const CHALLENGE_LENGTH = 5;
const CHALLENGE_SPACE = CHALLENGE_ALPHABET.length ** CHALLENGE_LENGTH;

const ALL_ATTACKS = ["replay", "splice", "photo", "clone", "faceswap"];

// ----------------------------------------------------------------- arguments
function parseArgs(argv) {
  const out = { outDir: "../attack_out", attacks: ["replay", "splice", "photo"], keepMedia: false };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--corpus": out.corpus = next(); break;
      case "--out": out.outDir = next(); break;
      case "--attacks": out.attacks = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--clones": out.clones = next(); break;
      case "--swaps": out.swaps = next(); break;
      case "--keep-media": out.keepMedia = true; break;
      default:
        console.error(`unknown argument: ${argv[i]}`);
        process.exit(2);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.corpus) {
  console.error(
    "usage: attack_suite.mjs --corpus <dir> [--out <dir>] [--attacks a,b,c] " +
      "[--clones <dir>] [--swaps <dir>]\n" +
      `attacks: ${ALL_ATTACKS.join(", ")}\n` +
      "corpus files: <subject>_s<session>__<code>.mp4"
  );
  process.exit(2);
}
const unknown = args.attacks.filter((a) => !ALL_ATTACKS.includes(a));
if (unknown.length) {
  console.error(`unknown attack(s): ${unknown.join(", ")} (have: ${ALL_ATTACKS.join(", ")})`);
  process.exit(2);
}
if (args.attacks.includes("clone") && !args.clones) {
  console.error("--attacks clone requires --clones <dir> of cloned audio; see the header");
  process.exit(2);
}
if (args.attacks.includes("faceswap") && !args.swaps) {
  console.error("--attacks faceswap requires --swaps <dir> of swapped video; see the header");
  process.exit(2);
}
if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) {
  console.error("ffmpeg not found on PATH; attack media cannot be synthesised");
  process.exit(2);
}

// -------------------------------------------------------------------- corpus
const CORPUS_NAME = /^(.+)_s(\d+)__([A-Za-z0-9]+)\.(mp4|webm|mkv|mov)$/i;

const recordings = fs
  .readdirSync(args.corpus)
  .map((f) => {
    const m = CORPUS_NAME.exec(f);
    return m
      ? { subject: m[1], session: Number(m[2]), code: m[3], file: path.join(args.corpus, f) }
      : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.subject.localeCompare(b.subject) || a.session - b.session);

if (recordings.length === 0) {
  console.error(
    `no recordings matched <subject>_s<session>__<code>.mp4 in ${args.corpus}\n` +
      "example: p01_s1__93417.mp4"
  );
  process.exit(2);
}

const subjects = [...new Set(recordings.map((r) => r.subject))].sort();
const sessionsOf = (s) => recordings.filter((r) => r.subject === s);
const usable = subjects.filter((s) => sessionsOf(s).length >= 2);

console.log(`attack corpus: ${recordings.length} recording(s), ${subjects.length} subject(s)`);
if (usable.length < 2) {
  console.error(
    "\nneed at least 2 subjects with 2 sessions each: the enrolled reference and the " +
      "attack medium must be different recordings, and the impostor must be a different " +
      `person. Have ${usable.length} usable subject(s).`
  );
  process.exit(1);
}
if (usable.length < subjects.length) {
  console.log(`  ${subjects.length - usable.length} subject(s) dropped for having only one session`);
}

// ------------------------------------------------------------------ plumbing
const work = fs.mkdtempSync(path.join(os.tmpdir(), "attack-"));
const mediaDir = args.keepMedia ? path.join(args.outDir, "media") : path.join(work, "media");
fs.mkdirSync(mediaDir, { recursive: true });

function ffmpeg(cliArgs) {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...cliArgs], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  return { ok: r.status === 0, stderr: String(r.stderr ?? "").trim() };
}

function runPy(scriptArgs) {
  return new Promise((resolve) => {
    const child = spawn(ENV.PYTHON, scriptArgs, { cwd: path.resolve(import.meta.dirname, "..") });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ code: null, stdout, stderr: String(e) }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function freshChallenge(not) {
  // Rejection-sampled so the "new challenge" in a replay trial is genuinely
  // different from the one in the recording. A collision would score as a
  // successful replay when it is really a 1-in-100000 coincidence, and that
  // probability is argued analytically rather than sampled.
  for (;;) {
    let c = "";
    for (let i = 0; i < CHALLENGE_LENGTH; i++) {
      c += CHALLENGE_ALPHABET[Math.floor(Math.random() * CHALLENGE_ALPHABET.length)];
    }
    if (normalizeCaptcha(c) !== normalizeCaptcha(not ?? "")) return c;
  }
}

/** Media duration in seconds, or null. Used to length-match a still-image video. */
function duration(file) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" }
  );
  const d = Number(String(r.stdout ?? "").trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

// ----------------------------------------------------------------- enrolment
// The enrolled reference is each subject's session 1, extracted through the
// deployed extractor with the enrolment quality gate, exactly as registration
// would. An attack is then always mounted against a template the real system
// would have stored.
const enrolled = {};
console.log("\nenrolling reference templates ...");
for (const subject of usable) {
  const ref = sessionsOf(subject)[0];
  const out = path.join(work, `enrolled_${subject}.json`);
  process.stdout.write(`  ${subject} <- ${path.basename(ref.file)} ... `);
  const { code, stderr } = await runExtractTemplate(ref.file, out, { enrollment: true });
  if (code !== 0) {
    console.log(`FAILED (${stderr.trim().split("\n").pop()})`);
    continue;
  }
  console.log("ok");
  enrolled[subject] = { template: out, reference: ref };
}

const enrolledSubjects = Object.keys(enrolled);
if (enrolledSubjects.length < 2) {
  console.error(
    `\nonly ${enrolledSubjects.length} subject(s) enrolled; at least 2 are needed so an ` +
      "impostor is a different person. Check the corpus recordings show a usable face."
  );
  process.exit(1);
}

// ------------------------------------------------------------------- scoring
/**
 * Run one authentication attempt exactly as the server would, and return the
 * three factor verdicts plus the fused decision.
 */
async function authenticate(victim, mediaPath, issuedChallenge) {
  const stem = path.basename(mediaPath, path.extname(mediaPath));
  const probe = path.join(work, `probe_${stem}.json`);

  // Biometric branch: one extraction, then both matchers against the enrolled
  // template. Login extraction, so no quality gate -- same as a real login.
  const extract = await runExtractTemplate(mediaPath, probe);
  const extracted = extract.code === 0;
  let faceOk = false;
  let voiceOk = false;
  if (extracted) {
    const [face, voice] = await Promise.all([
      runPy(["./matchFaceTemplate.py", enrolled[victim].template, probe]),
      runPy(["./matchVoiceTemplate.py", enrolled[victim].template, probe]),
    ]);
    faceOk = face.code === 0;
    voiceOk = voice.code === 0;
  }

  // Challenge branch: demux and transcribe, then the deployed normalization.
  const audio = path.join(work, `${stem}.mp3`);
  let captchaOk = false;
  let nTranscripts = 0;
  if (ffmpeg(["-i", mediaPath, "-vn", "-ac", "1", "-ar", "16000", audio]).ok) {
    const speech = await runPy(["./speechToTexty.py", audio]);
    const transcripts =
      speech.code === 0
        ? [...speech.stdout.matchAll(/Captcha:\s*(.*)/g)].map((m) => m[1].trim())
        : [];
    nTranscripts = transcripts.length;
    const wanted = normalizeCaptcha(issuedChallenge);
    captchaOk = transcripts.some((t) => normalizeCaptcha(t) === wanted);
  }

  return {
    extracted,
    faceOk,
    voiceOk,
    captchaOk,
    transcripts: nTranscripts,
    granted: fuse({ faceOk, voiceOk, captchaOk }),
  };
}

// ----------------------------------------------------------- attack builders
//
// Each builder yields attempts of the shape
//   { victim, attack, description, media, issued }
// where `issued` is the challenge the server is taken to have issued for this
// attempt. Choosing `issued` is where the threat model shows up: an adversary
// holding only archived media faces a challenge it has never heard, while an
// adversary who can speak live answers the challenge it was just shown.

function otherSubject(subject) {
  const others = enrolledSubjects.filter((s) => s !== subject);
  return others[Math.floor(Math.random() * others.length)];
}

/** Mux one file's video with another file's audio. */
function splice(videoFrom, audioFrom, outName) {
  const out = path.join(mediaDir, outName);
  const { ok, stderr } = ffmpeg([
    "-i", videoFrom, "-i", audioFrom,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", out,
  ]);
  if (!ok) {
    console.error(`    splice failed: ${stderr.split("\n").pop()}`);
    return null;
  }
  return out;
}

/** A video of one still frame of `videoFrom`, carrying `audioFrom`'s audio. */
function photoVideo(videoFrom, audioFrom, outName) {
  const still = path.join(work, `${outName}.png`);
  // Sample a frame a little way in: the first frame of a capture is often
  // mid-exposure, which would make the attack look weaker than it is.
  if (!ffmpeg(["-ss", "1", "-i", videoFrom, "-frames:v", "1", still]).ok) {
    if (!ffmpeg(["-i", videoFrom, "-frames:v", "1", still]).ok) return null;
  }
  const out = path.join(mediaDir, outName);
  const { ok, stderr } = ffmpeg([
    "-loop", "1", "-framerate", "25", "-i", still,
    "-i", audioFrom,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-t", String(duration(audioFrom) ?? 8), "-c:a", "aac", "-shortest", out,
  ]);
  if (!ok) {
    console.error(`    photo build failed: ${stderr.split("\n").pop()}`);
    return null;
  }
  return out;
}

/** Index a supplied attack-media directory by subject: <subject>__<code>.<ext>. */
function indexSupplied(dir, label) {
  if (!fs.existsSync(dir)) {
    console.error(`${label} directory not found: ${dir}`);
    process.exit(2);
  }
  const rx = /^(.+)__([A-Za-z0-9]+)\.[A-Za-z0-9]+$/;
  const bySubject = {};
  for (const f of fs.readdirSync(dir)) {
    const m = rx.exec(f);
    if (m) (bySubject[m[1]] ??= []).push({ code: m[2], file: path.join(dir, f) });
  }
  const n = Object.values(bySubject).reduce((a, v) => a + v.length, 0);
  if (n === 0) {
    console.error(`no ${label} matched <subject>__<code>.<ext> in ${dir}`);
    process.exit(2);
  }
  console.log(`  ${label}: ${n} file(s) for ${Object.keys(bySubject).length} subject(s)`);
  return bySubject;
}

const BUILDERS = {
  // A1, the archived-media adversary. An old login recording of the victim,
  // complete and unmodified, submitted against a challenge issued now.
  replay: () =>
    enrolledSubjects.flatMap((victim) =>
      sessionsOf(victim)
        .slice(1)
        .map((rec) => ({
          victim,
          attack: "replay",
          description: "unmodified archived login recording against a fresh challenge",
          media: rec.file,
          issued: freshChallenge(rec.code),
        }))
    ),

  // The AND rule's justification: each splice satisfies some factors and not
  // others. The live-attacker variant sets the issued challenge to the code the
  // attacker speaks, modelling an adversary who reads the challenge off the
  // screen and answers it in real time.
  splice: () =>
    enrolledSubjects.flatMap((victim) => {
      const impostor = otherSubject(victim);
      const vRec = sessionsOf(victim)[1];
      const iRec = sessionsOf(impostor)[1] ?? sessionsOf(impostor)[0];
      const out = [];

      const a = splice(vRec.file, iRec.file, `splice_vface_iaudio_${victim}.mp4`);
      if (a) {
        out.push({
          victim,
          attack: "splice_victim_face",
          description: "victim's face with the attacker's live voice answering the challenge",
          media: a,
          issued: iRec.code, // the attacker speaks the challenge it was shown
        });
      }
      const b = splice(iRec.file, vRec.file, `splice_iface_vaudio_${victim}.mp4`);
      if (b) {
        out.push({
          victim,
          attack: "splice_victim_voice",
          description: "attacker's face with the victim's archived voice",
          media: b,
          issued: vRec.code, // the archived clip happens to carry this code
        });
      }
      return out;
    }),

  // A photograph or a screen held up to the camera. Two variants, because they
  // test different things: with the attacker's live voice the challenge is
  // answered and only the speaker factor stands in the way; with the victim's
  // archived audio the speaker factor passes and only the challenge stands.
  photo: () =>
    enrolledSubjects.flatMap((victim) => {
      const impostor = otherSubject(victim);
      const vRec = sessionsOf(victim)[1];
      const iRec = sessionsOf(impostor)[1] ?? sessionsOf(impostor)[0];
      const out = [];

      const live = photoVideo(vRec.file, iRec.file, `photo_live_${victim}.mp4`);
      if (live) {
        out.push({
          victim,
          attack: "photo_live_voice",
          description: "still photograph of the victim with the attacker's live spoken answer",
          media: live,
          issued: iRec.code,
        });
      }
      const archived = photoVideo(vRec.file, vRec.file, `photo_archived_${victim}.mp4`);
      if (archived) {
        out.push({
          victim,
          attack: "photo_archived_audio",
          description: "still photograph of the victim with the victim's archived audio",
          media: archived,
          issued: freshChallenge(vRec.code),
        });
      }
      return out;
    }),

  // Synthetic speech from an off-the-shelf cloning tool, carried on the
  // victim's own video so the face and challenge factors both pass and the
  // measurement isolates the speaker factor.
  clone: () => {
    const clones = indexSupplied(args.clones, "cloned audio");
    return enrolledSubjects.flatMap((victim) =>
      (clones[victim] ?? []).flatMap((clone) => {
        const vRec = sessionsOf(victim)[1];
        const media = splice(vRec.file, clone.file, `clone_${victim}_${clone.code}.mp4`);
        return media
          ? [{
              victim,
              attack: "voice_clone",
              description: "cloned voice answering the challenge, on the victim's video",
              media,
              issued: clone.code,
            }]
          : [];
      })
    );
  },

  // Swapped video from an off-the-shelf tool, carrying a spoken answer to the
  // challenge so the challenge factor passes and the measurement isolates the
  // face factor.
  faceswap: () => {
    const swaps = indexSupplied(args.swaps, "face-swapped video");
    return enrolledSubjects.flatMap((victim) =>
      (swaps[victim] ?? []).map((swap) => ({
        victim,
        attack: "face_swap",
        description: "face-swapped video of the victim with a spoken answer to the challenge",
        media: swap.file,
        issued: swap.code,
      }))
    );
  },
};

// ------------------------------------------------------------------- control
// A harness that rejects everything reports zero attack success whether or not
// it works. The control is a genuine attempt -- the victim's own second
// recording against the challenge it actually speaks -- and it must be granted.
// If it is not, every zero below is meaningless, and the run says so and exits
// non-zero.
function controlAttempts() {
  return enrolledSubjects.map((victim) => {
    const rec = sessionsOf(victim)[1];
    return {
      victim,
      attack: "control_genuine",
      description: "genuine login: the victim's own recording against the challenge it speaks",
      media: rec.file,
      issued: rec.code,
    };
  });
}

// ---------------------------------------------------------------------- run
console.log(`\nbuilding attack media (${args.attacks.join(", ")}) ...`);
const attempts = [...controlAttempts()];
for (const name of args.attacks) attempts.push(...BUILDERS[name]());

console.log(`\nscoring ${attempts.length} attempt(s) against the deployed decision rule ...`);
const results = [];
for (const a of attempts) {
  process.stdout.write(`  ${a.attack} / ${a.victim} ... `);
  const verdict = await authenticate(a.victim, a.media, a.issued);
  console.log(
    `${verdict.granted ? "GRANTED" : "denied"} ` +
      `(face=${verdict.faceOk} voice=${verdict.voiceOk} challenge=${verdict.captchaOk})`
  );
  results.push({
    attack: a.attack,
    description: a.description,
    victim: a.victim,
    media: path.basename(a.media),
    ...verdict,
  });
}

// ---------------------------------------------------------------- aggregate
function rate(rows, key) {
  return rows.length ? rows.filter((r) => r[key]).length / rows.length : null;
}

const byAttack = {};
for (const r of results) (byAttack[r.attack] ??= []).push(r);

const summary = Object.entries(byAttack).map(([attack, rows]) => ({
  attack,
  description: rows[0].description,
  attempts: rows.length,
  face_asr: rate(rows, "faceOk"),
  voice_asr: rate(rows, "voiceOk"),
  challenge_asr: rate(rows, "captchaOk"),
  system_asr: rate(rows, "granted"),
  n_granted: rows.filter((r) => r.granted).length,
}));

const control = summary.find((s) => s.attack === "control_genuine");
const controlValid = !!control && control.system_asr === 1;

const pctCell = (x) => (x === null ? "  n/a" : `${(x * 100).toFixed(1)}%`);
console.log("\n" + "=".repeat(78));
console.log(
  "attack".padEnd(26) + "n".padStart(4) + "face".padStart(9) + "voice".padStart(9) +
    "chall".padStart(9) + "system".padStart(9)
);
console.log("-".repeat(78));
for (const s of summary) {
  console.log(
    s.attack.padEnd(26) + String(s.attempts).padStart(4) + pctCell(s.face_asr).padStart(9) +
      pctCell(s.voice_asr).padStart(9) + pctCell(s.challenge_asr).padStart(9) +
      pctCell(s.system_asr).padStart(9)
  );
}
console.log("=".repeat(78));

if (!controlValid) {
  console.error(
    "\n!! CONTROL FAILED: a genuine attempt was not granted " +
      `(${control ? control.n_granted : 0} of ${control ? control.attempts : 0}). ` +
      "Every zero attack success rate above is therefore uninformative -- the harness " +
      "may simply be rejecting everything. Fix the corpus or the enrolment before " +
      "reporting these numbers."
  );
}

// ------------------------------------------------------------------- output
fs.mkdirSync(args.outDir, { recursive: true });

fs.writeFileSync(
  path.join(args.outDir, "attacks.json"),
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      fusion_rule: FUSION_RULE,
      corpus: path.resolve(args.corpus),
      subjects_enrolled: enrolledSubjects.length,
      attacks_run: args.attacks,
      challenge_space: CHALLENGE_SPACE,
      control_valid: controlValid,
      control_note:
        "A genuine attempt must be granted for the attack success rates to mean anything; " +
        "control_valid records whether it was.",
      analytic_replay_bound: {
        // The one attack number that is argued rather than sampled: a replayed
        // recording succeeds only if its archived code equals the freshly
        // issued one. Sampling this would need ~10^5 trials to see one event.
        probability_per_attempt: 1 / CHALLENGE_SPACE,
        note:
          `The challenge is ${CHALLENGE_LENGTH} symbols over a ${CHALLENGE_ALPHABET.length}-symbol ` +
          `alphabet, giving ${CHALLENGE_SPACE} possible values, issued fresh and consumed on ` +
          "retrieval. A replayed recording therefore satisfies the challenge factor only by " +
          `coincidence, with probability 1/${CHALLENGE_SPACE} per attempt.`,
      },
      summary,
      attempts: results,
    },
    null,
    2
  )
);

// LaTeX output, so the paper never retypes an attack success rate.
const pct = (x) => (x === null ? "n/a" : (x * 100).toFixed(1));

/** snake_case attack id -> CamelCase fragment usable in a LaTeX macro name.
 *  TeX control sequences are letters only, so digits and separators go. */
const macroName = (id) =>
  id
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join("");

const tex = [
  "% Generated by backend/scripts/attack_suite.mjs -- do not edit by hand.\n",
  `% control valid: ${controlValid}\n`,
  `\\newcommand{\\AttackChallengeSpace}{${CHALLENGE_SPACE}}\n`,
  `\\newcommand{\\AttackSubjects}{${enrolledSubjects.length}}\n`,
  `\\newcommand{\\AttackControlValid}{${controlValid ? "yes" : "NO"}}\n`,
];

// Per-attack macros, so a prose sentence or the attack/defence mapping table can
// cite one attack's rate without reproducing the whole results table. Emitted
// for the control too: a reader is entitled to see that the harness accepted a
// genuine attempt before believing any zero beneath it.
tex.push("\n% per-attack rates: <Name>ASR is the system rate, <Name>N the attempt count\n");
for (const s of summary) {
  const n = macroName(s.attack);
  tex.push(`\\newcommand{\\Attack${n}ASR}{${pct(s.system_asr)}}\n`);
  tex.push(`\\newcommand{\\Attack${n}FaceASR}{${pct(s.face_asr)}}\n`);
  tex.push(`\\newcommand{\\Attack${n}VoiceASR}{${pct(s.voice_asr)}}\n`);
  tex.push(`\\newcommand{\\Attack${n}ChallASR}{${pct(s.challenge_asr)}}\n`);
  tex.push(`\\newcommand{\\Attack${n}N}{${s.attempts}}\n`);
}

tex.push("\n% results-table body\n");
tex.push("\\newcommand{\\AttackRows}{%\n");
for (const s of summary) {
  if (s.attack === "control_genuine") continue; // reported in prose, not the table
  tex.push(
    `  ${s.attack.replace(/_/g, " ")} & ${s.attempts} & ${pct(s.face_asr)} & ` +
      `${pct(s.voice_asr)} & ${pct(s.challenge_asr)} & ${pct(s.system_asr)} \\\\\n`
  );
}
tex.push("}\n");
fs.writeFileSync(path.join(args.outDir, "attacks.tex"), tex.join(""));

if (args.keepMedia) console.log(`\nattack media kept in ${mediaDir}`);
else fs.rmSync(work, { recursive: true, force: true });

console.log(`\nwrote ${path.join(args.outDir, "attacks.json")} and attacks.tex`);
process.exit(controlValid ? 0 : 1);
