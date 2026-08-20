// Quantitative performance measurement (reviewer comment 3).
//
// Times each stage of the TEMPLATE-based pipeline over N runs and reports
// mean ± std, then compares the paper's sequential cascade (Algorithm 1: face
// gates voice, voice gates CAPTCHA) against the parallel login() this repo
// implements.
//
// Usage (from backend/):
//   node --env-file=.env scripts/measure_performance.mjs <login_video.mp4> [N] [username] [captcha]
//
// A login video must be supplied: since the template migration, no recording of
// any user is stored on the server, so there is nothing on disk to replay. Use a
// clip of the account's owner speaking the CAPTCHA you pass as the last argument.
// Recover what a clip actually says with:
//   ../.venv/bin/python ./speechToTexty.py <login .mp3>

import { execFileSync } from "child_process";
import { performance } from "perf_hooks";
import fs from "fs";
import os from "os";
import path from "path";
import ENV from "../config.js";

const LOGIN_VIDEO = process.argv[2];
const N = parseInt(process.argv[3] || "5", 10);
const USER = process.argv[4] || "kanika1206";
const CAPTCHA = process.argv[5] || "48077";
const PY = ENV.PYTHON;

if (!LOGIN_VIDEO || !fs.existsSync(LOGIN_VIDEO)) {
  console.error("usage: measure_performance.mjs <login_video.mp4> [N] [username] [captcha]");
  process.exit(2);
}

const connect = (await import("../database/conn.js")).default;
await connect();
const { issueCaptcha } = await import("../captchaStore.js");
const { encryptToFile } = await import("../secureStore.js");
const { decryptTemplate } = await import("../templateStore.js");
const { connectVault } = await import("../keyVault.js");
await connectVault();
const { login } = await import("../controllers/appController.js");

const LOGIN_DIR = "uploadsl/login_videos/";
const LOGIN_ENC = LOGIN_DIR + USER + "_l.mp4.enc";

// login() consumes and deletes the login recording, so each timed attempt gets a
// freshly "uploaded" one — the same thing a real client does.
const plantLoginRecording = () =>
  encryptToFile(fs.readFileSync(LOGIN_VIDEO), LOGIN_ENC);

const stat = (ts) => {
  const mean = ts.reduce((a, b) => a + b, 0) / ts.length;
  const std = Math.sqrt(ts.reduce((a, b) => a + (b - mean) ** 2, 0) / ts.length);
  return { mean, std, min: Math.min(...ts), max: Math.max(...ts) };
};

const stages = [];
const record = (label, times) => stages.push({ label, ...stat(times) });

// Async-aware: decryptTemplate now resolves its key from the vault, so a
// stage may return a promise; awaiting a sync stage costs nothing.
async function repeat(fn) {
  const times = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  return times;
}

const py = (args) => {
  try {
    execFileSync(PY, args, { stdio: "pipe" });
  } catch {
    // A nonzero exit still consumed the work we are timing.
  }
};

// --- per-stage timings -------------------------------------------------------
const work = fs.mkdtempSync(path.join(os.tmpdir(), "perf-"));
const regTemplate = path.join(work, "reg.json");
const loginTemplate = path.join(work, "login.json");
const loginVideo = path.join(work, "login.mp4");
const loginAudio = path.join(work, "login.mp3");
fs.copyFileSync(LOGIN_VIDEO, loginVideo);

record("decrypt stored template (secureStore)", await repeat(() => decryptTemplate(USER, regTemplate)));
record("extract login template (extractTemplate.py)", await repeat(() => py(["./extractTemplate.py", loginVideo, loginTemplate])));
record("face match (matchFaceTemplate.py)", await repeat(() => py(["./matchFaceTemplate.py", regTemplate, loginTemplate])));
record("voice match (matchVoiceTemplate.py)", await repeat(() => py(["./matchVoiceTemplate.py", regTemplate, loginTemplate])));
record("audio extraction (extractAudio_login.py)", await repeat(() => py(["./extractAudio_login.py", loginVideo])));
record("speech-to-text (speechToTexty.py)", await repeat(() => py(["./speechToTexty.py", loginAudio])));

// --- sequential cascade (the paper's Algorithm 1) ----------------------------
// Face gates the voice factor, which gates the CAPTCHA factor.
record(
  "SEQUENTIAL cascade (paper Algorithm 1)",
  await repeat(async () => {
    await decryptTemplate(USER, regTemplate);
    py(["./extractTemplate.py", loginVideo, loginTemplate]);
    py(["./matchFaceTemplate.py", regTemplate, loginTemplate]);
    py(["./matchVoiceTemplate.py", regTemplate, loginTemplate]);
    py(["./extractAudio_login.py", loginVideo]);
    py(["./speechToTexty.py", loginAudio]);
  })
);

// --- parallel login() (what this repo implements) ----------------------------
// Includes template decryption, login-recording decryption, the concurrent
// pipeline, the AND decision, and JWT minting.
const codes = [];
const e2e = [];
for (let i = 0; i < N; i++) {
  plantLoginRecording();
  issueCaptcha(USER, CAPTCHA);
  const t0 = performance.now();
  const code = await new Promise((resolve) => {
    let status = null;
    const res = {
      status(c) { status = c; return this; },
      send() { resolve(status); return this; },
      json() { resolve(status); return this; },
    };
    login({ body: { username: USER } }, res);
  });
  e2e.push(performance.now() - t0);
  codes.push(code);
}
record("PARALLEL login() end-to-end (this repo)", e2e);

// --- report ------------------------------------------------------------------
console.log(`\nuser=${USER}  N=${N} runs per stage  (times in ms)\n`);
const pad = Math.max(...stages.map((s) => s.label.length));
for (const s of stages) {
  console.log(
    `${s.label.padEnd(pad)}  mean=${s.mean.toFixed(0).padStart(6)}  std=${s.std.toFixed(0).padStart(5)}  min=${s.min.toFixed(0).padStart(6)}  max=${s.max.toFixed(0).padStart(6)}`
  );
}

const seq = stages.find((s) => s.label.startsWith("SEQUENTIAL")).mean;
const par = stages.find((s) => s.label.startsWith("PARALLEL")).mean;
console.log(`\nspeedup (sequential / parallel): ${(seq / par).toFixed(2)}x  (saves ${(seq - par).toFixed(0)} ms)`);
console.log(`login() HTTP status per run: ${codes.join(", ")}  (200 = all three factors passed)`);

// Storage: what the server keeps per user now vs. the video it used to keep.
const tplSize = fs.statSync("templates/" + USER + ".tmpl.enc").size;
const vidSize = fs.statSync(LOGIN_VIDEO).size;
console.log(
  `stored per user: template=${(tplSize / 1024).toFixed(0)}KB ` +
    `(was a ${(vidSize / 1e6).toFixed(2)}MB video — ${(vidSize / tplSize).toFixed(1)}x larger, and replayable)`
);

fs.rmSync(work, { recursive: true, force: true });
fs.rmSync(LOGIN_ENC, { force: true });
process.exit(0);
