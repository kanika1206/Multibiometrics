// Evaluation capture (evalCapture.js): off by default, consent-gated, and names
// retained clips <subject>_s<session>__<code>.mp4 under EVAL_CORPUS_DIR.
//
// config.js reads the environment once at import, so each scenario runs in its
// own child process with its own EVAL_* variables.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

const BACKEND = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function run(env, body) {
  const script =
    `const { captureIfEnabled } = await import(${JSON.stringify(BACKEND + "/evalCapture.js")});\n` +
    `const { templateId } = await import(${JSON.stringify(BACKEND + "/templateStore.js")});\n` +
    `const buf = Buffer.from("fake-mp4");\n` +
    `const out = [];\n${body}\nprocess.stdout.write(JSON.stringify({ out, id: templateId("alice") }));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: BACKEND,
    env: { PATH: process.env.PATH, JWT_SECRET: "test-secret", ...env },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "evalcap-"));

test("capture is a no-op when EVAL_CAPTURE is unset, even with consent", () => {
  const dir = path.join(tmp(), "eval_data");
  const { out } = run({ EVAL_CORPUS_DIR: dir }, `out.push(captureIfEnabled(buf, "alice", true, "12345"));`);
  assert.deepEqual(out, [null]);
  assert.equal(fs.existsSync(dir), false);
});

test("capture retains nothing without per-upload consent", () => {
  const dir = path.join(tmp(), "eval_data");
  const { out } = run(
    { EVAL_CAPTURE: "1", EVAL_CORPUS_DIR: dir },
    `out.push(captureIfEnabled(buf, "alice", false, "12345"));`
  );
  assert.deepEqual(out, [null]);
  assert.equal(fs.existsSync(dir) && fs.readdirSync(dir).length > 0, false);
});

test("EVAL_SESSION names clips <subject>_s<session>__<code>.mp4 and never overwrites", () => {
  const dir = tmp();
  const { out, id } = run(
    { EVAL_CAPTURE: "1", EVAL_CORPUS_DIR: dir, EVAL_SESSION: "2" },
    `out.push(captureIfEnabled(buf, "alice", true, "48213"));
     out.push(captureIfEnabled(buf, "alice", true, "48213"));
     out.push(captureIfEnabled(buf, "alice", true, "enroll"));
     out.push(captureIfEnabled(buf, "alice", true, "../x y"));`
  );
  assert.deepEqual(out.map((p) => path.basename(p)), [
    `${id}_s2__48213.mp4`,
    `${id}_s2__48213-2.mp4`,
    `${id}_s2__enroll.mp4`,
    `${id}_s2__xy.mp4`,
  ]);
  assert.ok(!fs.readdirSync(dir).some((f) => f.includes("alice")), "username must not appear in names");
});

test("without EVAL_SESSION each upload is the next session, suffixes included", () => {
  const dir = tmp();
  const { out, id } = run(
    { EVAL_CAPTURE: "1", EVAL_CORPUS_DIR: dir },
    `out.push(captureIfEnabled(buf, "alice", true, "enroll"));
     out.push(captureIfEnabled(buf, "alice", true, "11111"));`
  );
  assert.deepEqual(out.map((p) => path.basename(p)), [`${id}_s1__enroll.mp4`, `${id}_s2__11111.mp4`]);
});
