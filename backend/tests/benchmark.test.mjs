// Tests for the performance benchmark log (benchmarkStore.js). Run from backend/:
//
//   npm test        (node --test tests/)
//
// No database, no keys, no server: the store is a pure file-append plus
// aggregation, and these tests point it at a throwaway directory.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bench-test-"));
process.env.BENCHMARK_DIR = TMP;
// A stable index key so the subject pseudonym is deterministic across runs.
process.env.BIOMETRIC_INDEX_KEY = "test-index-key-0123456789abcdef0123456789";

// Dynamic import: a static one would hoist above the env assignments.
const {
  startTimer,
  recordBenchmark,
  readBenchmarks,
  summarizeBenchmarks,
  clientMs,
  BENCHMARK_FILE,
} = await import("../benchmarkStore.js");

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test("a record carries operation, outcome, timings and no username", () => {
  recordBenchmark({
    operation: "login",
    success: false,
    reason: "FACE_MISMATCH",
    username: "alice",
    clientPreMs: 1500,
    serverMs: 8500,
    phases: { decryptMs: 40 },
  });

  const [r] = readBenchmarks(1);
  assert.equal(r.operation, "login");
  assert.equal(r.status, "failure");
  assert.equal(r.reason, "FACE_MISMATCH");
  assert.equal(r.totalMs, 10000, "end-to-end total is client + server");
  assert.equal(r.phases.decryptMs, 40);
  assert.ok(r.timestamp);
  // The privacy property the store exists to preserve: the log names nobody.
  const raw = fs.readFileSync(BENCHMARK_FILE, "utf8");
  assert.ok(!raw.includes("alice"), "the username must never be written");
  assert.match(r.subject, /^[0-9a-f]{16}$/);
});

test("the same user gets the same pseudonym, a different user a different one", () => {
  recordBenchmark({ operation: "login", success: true, username: "alice", clientPreMs: 1, serverMs: 1 });
  recordBenchmark({ operation: "login", success: true, username: "bob", clientPreMs: 1, serverMs: 1 });
  const [bob, alice2] = readBenchmarks(2);
  const [, , alice1] = readBenchmarks(3);
  assert.equal(alice2.subject, alice1.subject);
  assert.notEqual(bob.subject, alice2.subject);
});

test("a missing client half leaves the total null rather than half-measured", () => {
  recordBenchmark({ operation: "registration", success: false, reason: "EXTRACTION_FAILED", serverMs: 4000 });
  const [r] = readBenchmarks(1);
  assert.equal(r.totalMs, null);
  assert.equal(r.serverMs, 4000);
});

test("client-reported durations are validated, not trusted", () => {
  assert.equal(clientMs("1500.44"), 1500.4);
  assert.equal(clientMs(-1), null);
  assert.equal(clientMs("not a number"), null);
  assert.equal(clientMs(99 * 60 * 60 * 1000), null);
});

test("the timer records named phases and a total", async () => {
  const t = startTimer();
  await new Promise((r) => setTimeout(r, 20));
  t.lap("decryptMs");
  t.set("speechMs", 12.34);
  const total = t.stop();
  assert.ok(t.phases.decryptMs >= 15, `expected ~20ms, got ${t.phases.decryptMs}`);
  assert.equal(t.phases.speechMs, 12.3);
  assert.ok(total >= t.phases.decryptMs);
});

test("the summary splits by operation and outcome and counts failure reasons", () => {
  const summary = summarizeBenchmarks(readBenchmarks(Infinity));
  assert.equal(summary.login.attempts, 3);
  assert.equal(summary.login.success, 2);
  assert.equal(summary.login.failure, 1);
  assert.equal(summary.login.reasons.FACE_MISMATCH, 1);
  assert.equal(summary.registration.reasons.EXTRACTION_FAILED, 1);
  // Timing stats come only from complete end-to-end measurements, so the
  // registration record with no client half is counted but not timed.
  assert.equal(summary.registration.attempts, 1);
  assert.equal(summary.registration.endToEnd, null);
  assert.equal(summary.registration.serverSide.count, 1);
});

test("BENCHMARK_LOG=0 disables writing entirely", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-off-"));
  const env = { ...process.env, BENCHMARK_DIR: dir, BENCHMARK_LOG: "0" };
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import('./benchmarkStore.js');" +
        "m.recordBenchmark({operation:'login',success:true,serverMs:1});",
    ],
    { env, cwd: new URL("..", import.meta.url).pathname }
  );
  assert.equal(fs.existsSync(path.join(dir, "benchmarks.jsonl")), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
