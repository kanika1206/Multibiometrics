// Read-only, in-memory pairwise analysis of the deployed encrypted templates.
// Run from backend/:  node --env-file=.env scripts/analyze_deployed_templates.mjs
// Prints usernames for the same-person review list: operator terminal only,
// do not paste the raw output into the paper.
// Nothing plaintext is written to disk: templates are decrypted into Buffers,
// parsed, scored, and dropped. Only aggregate scores are printed.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const BACKEND = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const req = createRequire(BACKEND + "/package.json");
const mongoose = req("mongoose");
const { default: ENV } = await import(BACKEND + "/config.js");
const { templatePath, TEMPLATE_DIR } = await import(BACKEND + "/templateStore.js");
const { connectVault, disconnectVault, getUserKey } = await import(BACKEND + "/keyVault.js");

const TAU_F = 0.35, TAU_A = 0.30;
const MAGIC = Buffer.from("MBENC1");

function decryptInMemory(encPath, key) {
  const d = fs.readFileSync(encPath);
  if (!d.subarray(0, 6).equals(MAGIC)) throw new Error("bad magic");
  const dc = crypto.createDecipheriv("aes-256-gcm", key, d.subarray(6, 18));
  dc.setAuthTag(d.subarray(18, 34));
  return Buffer.concat([dc.update(d.subarray(34)), dc.final()]);
}
const norm = (v) => { const n = Math.hypot(...v); return n ? v.map((x) => x / n) : v; };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

await mongoose.connect(ENV.ATLAS_URI);
await connectVault();
const users = await mongoose.connection.db.collection("users").find({}, { projection: { username: 1 } }).toArray();

const onDisk = new Set(fs.readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith(".tmpl.enc")));
const subjects = [];
const unmapped = [];
for (const { username } of users) {
  const p = templatePath(username);
  const base = path.basename(p);
  if (!onDisk.has(base)) continue;
  onDisk.delete(base);
  const key = await getUserKey(username);
  if (!key) { unmapped.push(`${username} (no vault key)`); continue; }
  let t;
  try { t = JSON.parse(decryptInMemory(p, key).toString("utf8")); }
  catch (e) { unmapped.push(`${username} (${e.message})`); continue; }
  finally { key.fill(0); }
  subjects.push({
    username,
    faceMean: norm(t.face.embedding),
    faceFrames: t.face.frames.map(norm),
    voice: norm(t.voice.embedding),
    nFrames: t.face.n_frames,
    version: t.version,
  });
}
await disconnectVault();
await mongoose.disconnect();

console.log(`users in DB: ${users.length}; templates decrypted: ${subjects.length}; ` +
  `template files with no matching account: ${onDisk.size}; failures: ${unmapped.length}`);
for (const u of unmapped) console.log("  failed:", u);

// Face: the deployed matcher scores median(probe frames . reference mean).
// Between two enrolment templates this is directional, so report both
// directions and use the MAX for the exceedance count (worst case for FAR).
const faceDir = (ref, probe) => median(probe.faceFrames.map((f) => dot(ref.faceMean, f)));
const pairs = [];
for (let i = 0; i < subjects.length; i++)
  for (let j = i + 1; j < subjects.length; j++) {
    const a = subjects[i], b = subjects[j];
    const f1 = faceDir(a, b), f2 = faceDir(b, a);
    pairs.push({ a: a.username, b: b.username, face: Math.max(f1, f2), faceMin: Math.min(f1, f2),
      faceMeanCos: dot(a.faceMean, b.faceMean), voice: dot(a.voice, b.voice) });
  }

const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); const k = (s.length - 1) * p; const lo = Math.floor(k); return s[lo] + (s[Math.ceil(k)] - s[lo]) * (k - lo); };
const describe = (name, xs, tau) => {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1));
  const f = (x) => x.toFixed(3);
  console.log(`${name}: n=${xs.length} mean=${f(mean)} sd=${f(sd)} min=${f(Math.min(...xs))} ` +
    `p25=${f(q(xs, .25))} median=${f(q(xs, .5))} p75=${f(q(xs, .75))} p95=${f(q(xs, .95))} max=${f(Math.max(...xs))} ` +
    `| >= ${tau}: ${xs.filter((x) => x >= tau).length}/${xs.length}`);
};
const hist = (xs, lo, hi, step) => {
  let out = "";
  for (let x = lo; x < hi - 1e-9; x += step) {
    const c = xs.filter((v) => v >= x && v < x + step).length;
    out += `  [${x.toFixed(2)},${(x + step).toFixed(2)}) ${String(c).padStart(3)} ${"#".repeat(c)}\n`;
  }
  return out;
};

console.log(`\nALL-PAIRS (${pairs.length} pairs; includes any same-person accounts)`);
describe("face (matcher, max dir)", pairs.map((p) => p.face), TAU_F);
describe("face (matcher, min dir)", pairs.map((p) => p.faceMin), TAU_F);
describe("face (mean-emb cosine) ", pairs.map((p) => p.faceMeanCos), TAU_F);
describe("voice (ECAPA cosine)   ", pairs.map((p) => p.voice), TAU_A);
console.log("face histogram (matcher, max dir):\n" + hist(pairs.map((p) => p.face), -0.2, 1.0, 0.1));
console.log("voice histogram:\n" + hist(pairs.map((p) => p.voice), -0.2, 1.0, 0.1));

// Likely same-person: face well above anything plausible for different people.
const SAME_FACE = 0.5;
const likely = pairs.filter((p) => p.face >= SAME_FACE).sort((x, y) => y.face - x.face);
console.log(`\nLIKELY SAME PERSON (face matcher >= ${SAME_FACE}) — confirm before exclusion:`);
for (const p of likely) console.log(`  ${p.a} ~ ${p.b}: face=${p.face.toFixed(3)} voice=${p.voice.toFixed(3)}`);

console.log("\nPAIRS EXCEEDING A DEPLOYED THRESHOLD (all):");
for (const p of pairs.filter((p) => p.face >= TAU_F || p.voice >= TAU_A).sort((x, y) => y.face - x.face))
  console.log(`  ${p.a} ~ ${p.b}: face=${p.face.toFixed(3)}${p.face >= TAU_F ? "*" : " "} ` +
    `voice=${p.voice.toFixed(3)}${p.voice >= TAU_A ? "*" : " "}${p.face >= TAU_F && p.voice >= TAU_A ? "  BOTH" : ""}`);

// Connected components over the likely-same graph -> clusters; impostor set
// excludes within-cluster pairs.
const parent = new Map(subjects.map((s) => [s.username, s.username]));
const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
for (const p of likely) parent.set(find(p.a), find(p.b));
const clusters = {};
for (const s of subjects) (clusters[find(s.username)] ??= []).push(s.username);
console.log("\nclusters (by face >= 0.5):");
for (const c of Object.values(clusters)) if (c.length > 1) console.log("  {" + c.join(", ") + "}");
const imp = pairs.filter((p) => find(p.a) !== find(p.b));
console.log(`\nIMPOSTOR-ONLY (excluding within-cluster pairs; ${imp.length} pairs, ${Object.keys(clusters).length} distinct identities est.)`);
describe("face (matcher, max dir)", imp.map((p) => p.face), TAU_F);
describe("voice (ECAPA cosine)   ", imp.map((p) => p.voice), TAU_A);
console.log(`both factors exceed: ${imp.filter((p) => p.face >= TAU_F && p.voice >= TAU_A).length}/${imp.length}`);
console.log("\nper-template face frames:", subjects.map((s) => s.nFrames).join(","), "versions:", [...new Set(subjects.map((s) => s.version))].join(","));

// Identity level: one template per estimated identity (the cluster's first
// member in DB order), so a single person's duplicates cannot inflate counts.
const reps = new Set(Object.values(clusters).map((c) => c[0]));
const idp = pairs.filter((p) => reps.has(p.a) && reps.has(p.b));
console.log(`\nIDENTITY-LEVEL IMPOSTOR (one template per identity; reps=${[...reps].length}, ${idp.length} pairs)`);
describe("face (matcher, max dir)", idp.map((p) => p.face), TAU_F);
describe("voice (ECAPA cosine)   ", idp.map((p) => p.voice), TAU_A);
for (const p of idp.filter((p) => p.voice >= TAU_A)) console.log(`  voice>=tau: ${p.a} ~ ${p.b} voice=${p.voice.toFixed(3)} face=${p.face.toFixed(3)}`);
console.log("reps:", [...reps].join(", "));
console.log("\nframes per template:", subjects.map((s) => `${s.username}:${s.nFrames}`).join(" "));
