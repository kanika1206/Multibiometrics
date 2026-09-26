// Measure the challenge factor's own error rate.
//
// Why this exists
// ---------------
// The conjunctive rule means the third factor's false rejections land directly
// on the user: a perfect face and voice match still fails if the spoken code is
// not transcribed back to the issued code. The deployment log showed six
// CAPTCHA_MISMATCH outcomes, which is a number a reader will ask about, and the
// biometric harness cannot answer it -- the challenge factor has no
// genuine/impostor pair structure, so it is not a biometric trial and does not
// belong in evaluate_corpus.py's pairing.
//
// Two measurements, which answer different questions:
//
//   --log <file>      What the deployment actually did. Reads the benchmark log
//                     and reports the observed outcome mix. This is an
//                     operational observation over whatever attempts happened to
//                     occur, not a controlled error rate: the log does not record
//                     whether the user spoke the right code in the first place.
//
//   --trials <dir>    A controlled false-rejection rate. Each recording is of a
//                     KNOWN code, spoken correctly, so every rejection is a false
//                     rejection by construction. This is the number the paper
//                     should quote.
//
// Trials layout: <dir>/<id>__<code>.mp4, e.g. t01__93417.mp4, where the part
// after the double underscore is the code actually spoken in the recording.
//
// Usage (from backend/):
//   node scripts/evaluate_challenge.mjs --trials ../challenge_corpus [--out ../evaluation_out]
//   node scripts/evaluate_challenge.mjs --log benchmarks/benchmarks.jsonl
//
// Writes challenge_metrics.json into --out, which evaluate_corpus.py picks up
// for the three-factor independence comparison against (6) and (7).

import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { normalizeCaptcha } from "../captchaStore.js";
import ENV from "../config.js";

// Reason codes appController.js emits for a third-factor failure. Kept separate
// because they mean different things: a mismatch is the recogniser returning the
// wrong string, a non-recognition is it returning nothing at all.
const CHALLENGE_FAILURES = ["CAPTCHA_MISMATCH", "SPEECH_NOT_RECOGNIZED", "CAPTCHA_EXPIRED"];

function parseArgs(argv) {
  const out = { outDir: "../evaluation_out", includeCodes: false };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--trials": out.trials = next(); break;
      case "--log": out.log = next(); break;
      case "--out": out.outDir = next(); break;
      case "--include-codes": out.includeCodes = true; break;
      default:
        console.error(`unknown argument: ${argv[i]}`);
        process.exit(2);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.trials && !args.log) {
  console.error(
    "usage: evaluate_challenge.mjs (--trials <dir> | --log <file>) [--out <dir>]\n" +
      "see the header of this file for the trials naming convention"
  );
  process.exit(2);
}

// ------------------------------------------------------- deployment-log mode
function fromLog(logPath) {
  if (!fs.existsSync(logPath)) {
    console.error(`benchmark log not found: ${logPath}`);
    process.exit(2);
  }
  const records = fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null; // a partially-flushed final line is not a reason to abort
      }
    })
    .filter(Boolean);

  const logins = records.filter((r) => r.operation === "login");
  const byReason = {};
  for (const r of logins) {
    const key = r.status === "success" ? "success" : (r.reason ?? "UNKNOWN");
    byReason[key] = (byReason[key] ?? 0) + 1;
  }
  const challengeFailures = CHALLENGE_FAILURES.reduce((n, c) => n + (byReason[c] ?? 0), 0);

  // The denominator is attempts that actually reached the challenge branch. An
  // attempt rejected earlier (no enrolment, unreadable upload) never transcribed
  // anything, so counting it would understate the factor's error rate.
  const reachedChallenge =
    (byReason.success ?? 0) +
    challengeFailures +
    (byReason.FACE_MISMATCH ?? 0) +
    (byReason.VOICE_MISMATCH ?? 0);

  console.log(`deployment log: ${logins.length} login attempt(s)`);
  for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${n}`);
  }
  console.log(
    `challenge-branch outcomes: ${challengeFailures} failure(s) of ${reachedChallenge} attempt(s) ` +
      "that reached the branch"
  );

  return {
    source: "deployment-log",
    log: path.resolve(logPath),
    n_login_attempts: logins.length,
    outcomes: byReason,
    n_reached_challenge: reachedChallenge,
    n_challenge_failures: challengeFailures,
    observed_failure_share: reachedChallenge ? challengeFailures / reachedChallenge : null,
    // Deliberately NOT called frr: the log does not record whether the user
    // spoke the correct code, so a mismatch here may be genuine user error.
    // evaluate_corpus.py only folds in a top-level `frr`, so this mode cannot
    // contaminate the independence comparison with a non-false-rejection.
    caveat:
      "Operational observation only. The log does not record the code the user actually " +
      "spoke, so these failures are not all false rejections. Use --trials for a " +
      "controlled false rejection rate.",
  };
}

// --------------------------------------------------------------- trials mode
const TRIAL_NAME = /^(.+)__([A-Za-z0-9]+)\.(mp4|webm|mkv|mov|wav|mp3|m4a)$/i;

function runPy(script, arg) {
  return new Promise((resolve) => {
    const child = spawn(ENV.PYTHON, [script, arg], {
      cwd: path.resolve(import.meta.dirname, ".."),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => resolve({ code: null, stdout, stderr: String(e) }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function fromTrials(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`trials directory not found: ${dir}`);
    process.exit(2);
  }
  const trials = fs
    .readdirSync(dir)
    .map((f) => {
      const m = TRIAL_NAME.exec(f);
      return m ? { id: m[1], code: m[2], file: path.join(dir, f) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (trials.length === 0) {
    console.error(`no trials matched <id>__<code>.<ext> in ${dir}\nexample: t01__93417.mp4`);
    process.exit(2);
  }
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) {
    console.error("ffmpeg not found on PATH; cannot demultiplex trial audio");
    process.exit(2);
  }

  console.log(`${trials.length} controlled trial(s) in ${dir}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "challenge-"));
  const results = [];
  let engine = null;

  try {
    for (const t of trials) {
      process.stdout.write(`  ${t.id} ... `);
      // Demultiplex to the shape the login path feeds the recogniser:
      // extractAudio_login.py hands it an mp3, so the engine sees an
      // equivalent input here.
      const audio = path.join(work, `${t.id}.mp3`);
      const demux = spawnSync(
        "ffmpeg",
        ["-y", "-loglevel", "error", "-i", t.file, "-vn", "-ac", "1", "-ar", "16000", audio],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      if (demux.status !== 0) {
        console.log("FAILED (no audio track)");
        results.push({ id: t.id, accepted: false, reason: "NO_AUDIO", transcripts: 0 });
        continue;
      }

      const { code, stdout, stderr } = await runPy("./speechToTexty.py", audio);
      engine ??= /stt engine:\s*(\S+)/.exec(stderr)?.[1] ?? null;
      const transcripts =
        code === 0 ? [...stdout.matchAll(/Captcha:\s*(.*)/g)].map((m) => m[1].trim()) : [];

      // Exactly the deployed acceptance test: any alternative matching the
      // issued code after captchaStore normalization.
      const wanted = normalizeCaptcha(t.code);
      const accepted = transcripts.some((x) => normalizeCaptcha(x) === wanted);
      const reason = accepted
        ? null
        : transcripts.length === 0
          ? "SPEECH_NOT_RECOGNIZED"
          : "CAPTCHA_MISMATCH";

      console.log(accepted ? "accept" : `REJECT (${reason})`);
      results.push({
        id: t.id,
        accepted,
        reason,
        transcripts: transcripts.length,
        // The spoken code is withheld by default, matching the deployed
        // logger's refusal to write challenge values into a log that outlives
        // them and is read by more people than should see one.
        ...(args.includeCodes ? { code: t.code, heard: transcripts } : {}),
      });
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  const rejected = results.filter((r) => !r.accepted);
  const frr = rejected.length / results.length;
  const byReason = {};
  for (const r of rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;

  console.log(
    `\nchallenge factor: ${rejected.length} rejection(s) of ${results.length} correctly ` +
      `spoken trial(s) -- FRR = ${(frr * 100).toFixed(2)}%`
  );
  for (const [reason, n] of Object.entries(byReason)) console.log(`  ${reason}: ${n}`);
  if (engine) console.log(`  speech-to-text engine: ${engine}`);

  return {
    source: "controlled-trials",
    trials_dir: path.resolve(dir),
    stt_engine: engine,
    n_trials: results.length,
    n_rejected: rejected.length,
    // Every trial is a correctly spoken code by construction, so every
    // rejection is a false rejection. This is the value evaluate_corpus.py
    // folds into the three-factor independence comparison.
    frr,
    rejections_by_reason: byReason,
    trials: results,
  };
}

// -------------------------------------------------------------------- output
const out = {
  generated: new Date().toISOString(),
  normalization: "captchaStore.normalizeCaptcha (deployed)",
};

if (args.log) out.deployment = fromLog(args.log);
if (args.trials) Object.assign(out, await fromTrials(args.trials));

fs.mkdirSync(args.outDir, { recursive: true });
const target = path.join(args.outDir, "challenge_metrics.json");
fs.writeFileSync(target, JSON.stringify(out, null, 2));
console.log(`\nwrote ${target}`);
if (out.frr === undefined) {
  console.log(
    "note: no controlled FRR was measured, so evaluate_corpus.py will run the " +
      "two-factor independence comparison. Add --trials for the three-factor one."
  );
}
