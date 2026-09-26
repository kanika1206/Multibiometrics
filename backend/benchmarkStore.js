// Performance benchmark log for the two end-to-end flows this system exposes:
// registration (account creation + biometric enrolment) and login (three-factor
// verification).
//
// Reviewer comment 3 asked for measured numbers rather than claims, and
// scripts/measure_performance.mjs answers that for a synthetic replay harness.
// This module is the complementary half: it records what the LIVE system
// actually took, per attempt, as users use it — so the paper's timings can be
// backed by production traffic instead of a bench rig alone.
//
// WHAT IS TIMED. Neither flow lives entirely on the server, so a purely
// server-side stopwatch would omit the browser-side half (capture handling,
// upload). Each record therefore carries two measured components and their sum:
//
//   registration.totalMs = clientPreMs + server.enrollMs
//     clientPreMs   browser: form validation -> POST /api/register (account row,
//                   PII sealing, enrolment token, notification mail) -> recording
//                   blob prepared -> immediately before POST /upload-video
//     server.enrollMs  server: template extraction (InsightFace + ECAPA-TDNN),
//                   per-user key generation, AES-256-GCM encryption, template
//                   write, and the rollback path on failure
//
//   login.totalMs = clientPreMs + server.loginMs
//     clientPreMs   browser: submit -> blob prepared -> POST /upload-video-login
//                   completes -> immediately before POST /api/login
//     server.loginMs   server: template + recording decryption, template
//                   extraction from the login recording, face match, voice match,
//                   audio extraction, speech-to-text, CAPTCHA comparison, JWT
//                   issue, response
//
// Excluded, and deliberately so: the time the user spends recording (that is
// human, not system, latency) and the final response leg back to the browser.
//
// DEVICE CONTEXT. Each record also carries the capture settings the browser
// negotiated for that attempt (video resolution, frame rate, platform), so the
// log can be broken down per device and across devices. Self-reported, bounded
// and whitelisted (deviceInfo below), and used for analysis only.
//
// PRIVACY. A benchmark record must not become a second, unprotected user
// directory. Usernames are therefore never written: each record carries a keyed
// pseudonym (HMAC, same reasoning as templateStore's filenames — see
// docs/BENCHMARKING.md), which is stable enough to group a user's attempts
// without naming them. No biometric data, no CAPTCHA values, no email.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import ENV from "./config.js";

export const BENCHMARK_DIR = ENV.BENCHMARK_DIR;
export const BENCHMARK_FILE = path.join(BENCHMARK_DIR, "benchmarks.jsonl");

/** Milliseconds, rounded to 0.1ms — sub-tenth-ms precision is noise here. */
const ms = (v) => Math.round(v * 10) / 10;

/**
 * Starts a stopwatch. `stop()` returns the elapsed milliseconds; `lap(label)`
 * records a named phase and returns its duration.
 */
export function startTimer() {
  const t0 = performance.now();
  let last = t0;
  const phases = {};
  return {
    lap(label) {
      const now = performance.now();
      const d = ms(now - last);
      phases[label] = d;
      last = now;
      return d;
    },
    /** Records a phase measured elsewhere (e.g. two branches run in parallel). */
    set(label, value) {
      if (Number.isFinite(value)) phases[label] = ms(value);
    },
    phases,
    stop() {
      return ms(performance.now() - t0);
    },
  };
}

/** Keyed pseudonym for a username. Never reversible without the index key. */
function subjectId(username) {
  if (!username) return null;
  const secret =
    ENV.BIOMETRIC_INDEX_KEY || "benchmark-subject:" + ENV.JWT_SECRET;
  return crypto
    .createHmac("sha256", secret)
    .update("benchmark-subject:" + username)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Capture settings of the device that produced a recording: video width,
 * height and frame rate as the browser actually negotiated them, plus a coarse
 * platform string.
 *
 * WHY IT IS RECORDED. Every measurement in the log otherwise comes from
 * hardware the log does not name, so nothing in it can answer "does this work
 * across devices?" — the one question a capture-driven system most needs
 * answered. With these three fields the existing log supports a per-device and
 * cross-device breakdown after the fact, with no new instrumentation.
 *
 * It is self-reported by the client and treated accordingly: it is context for
 * analysis only, never an input to any decision, and it is bounded and
 * whitelisted here so a crafted upload cannot write arbitrary data into the log.
 * `platform` is a short string (e.g. "Win32") — not the full user-agent, which
 * would be a fingerprint attached to a record that otherwise names nobody.
 */
export function deviceInfo(value) {
  if (!value) return null;
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object") return null;
  const num = (v, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 10) / 10 : null;
  };
  const info = {
    width: num(raw.width, 16384),
    height: num(raw.height, 16384),
    frameRate: num(raw.frameRate, 1000),
    platform:
      typeof raw.platform === "string" ? raw.platform.slice(0, 64) : null,
  };
  // Nothing usable reported: a row of nulls is noise, not data.
  return Object.values(info).some((v) => v !== null) ? info : null;
}

/** A client-reported duration is untrusted input: accept only a sane number. */
export function clientMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 60 * 60 * 1000) return null;
  return ms(n);
}

/**
 * Appends one benchmark record.
 *
 * Never throws: benchmarking is observability, and a full disk or a read-only
 * mount must not be able to fail a registration or a login.
 */
export function recordBenchmark({
  operation,
  success,
  reason = null,
  username = null,
  clientPreMs = null,
  serverMs = null,
  device = null,
  phases = {},
}) {
  if (!ENV.BENCHMARK_LOG) return null;
  const record = {
    timestamp: new Date().toISOString(),
    operation,
    status: success ? "success" : "failure",
    reason,
    subject: subjectId(username),
    // The headline number: the complete end-to-end flow. Null rather than a
    // half-measure when the client half is missing (an older client, or a
    // failure that aborted before the browser could report it) — a partial
    // total silently averaged into a report is worse than a gap.
    totalMs:
      clientPreMs !== null && serverMs !== null ? ms(clientPreMs + serverMs) : null,
    clientPreMs,
    serverMs,
    // Capture settings behind this attempt (resolution, frame rate, platform),
    // or null when the client reported none. Makes a cross-device analysis
    // possible from the log alone.
    device,
    phases,
  };
  try {
    fs.mkdirSync(BENCHMARK_DIR, { recursive: true });
    fs.appendFileSync(BENCHMARK_FILE, JSON.stringify(record) + "\n");
  } catch (e) {
    console.error(`[benchmark] could not write record: ${e.message}`);
  }
  return record;
}

/** Reads the most recent `limit` records, newest first. */
export function readBenchmarks(limit = 100) {
  try {
    if (!fs.existsSync(BENCHMARK_FILE)) return [];
    return fs
      .readFileSync(BENCHMARK_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch (e) {
    console.error(`[benchmark] could not read log: ${e.message}`);
    return [];
  }
}

/** mean / min / max / p95 over a numeric sample, or null if the sample is empty. */
function stats(values) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    count: xs.length,
    meanMs: ms(mean),
    minMs: ms(xs[0]),
    maxMs: ms(xs[xs.length - 1]),
    p95Ms: ms(xs[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]),
  };
}

/**
 * Aggregates the log by operation and outcome. Timing stats are computed over
 * the complete end-to-end total only, so a run whose client half is missing is
 * counted in `attempts` but never distorts the timings.
 */
export function summarizeBenchmarks(records = readBenchmarks(Infinity)) {
  const summary = {};
  for (const r of records) {
    const op = (summary[r.operation] ??= {
      attempts: 0,
      success: 0,
      failure: 0,
      reasons: {},
      total: [],
      server: [],
    });
    op.attempts++;
    op[r.status === "success" ? "success" : "failure"]++;
    if (r.reason) op.reasons[r.reason] = (op.reasons[r.reason] || 0) + 1;
    if (Number.isFinite(r.totalMs)) op.total.push(r.totalMs);
    if (Number.isFinite(r.serverMs)) op.server.push(r.serverMs);
  }
  for (const op of Object.values(summary)) {
    op.endToEnd = stats(op.total);
    op.serverSide = stats(op.server);
    delete op.total;
    delete op.server;
  }
  return summary;
}
