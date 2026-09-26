// Reads the live benchmark log (benchmarkStore.js) and prints a performance
// report: attempts, success/failure split, failure reasons, and end-to-end
// timing statistics per operation.
//
// Usage (from backend/):
//   node scripts/benchmark_report.mjs             human-readable report
//   node scripts/benchmark_report.mjs --json      the same numbers as JSON
//   node scripts/benchmark_report.mjs --csv       one row per attempt, for a spreadsheet
//
// The log is written by the running server — registration records come from
// /upload-video, login records from /api/login — so this script needs no
// database, no keys and no server: it only reads the file.

import fs from "fs";
import {
  BENCHMARK_FILE,
  readBenchmarks,
  summarizeBenchmarks,
} from "../benchmarkStore.js";

const mode = process.argv[2] || "--text";
const records = readBenchmarks(Infinity);

if (!fs.existsSync(BENCHMARK_FILE) || records.length === 0) {
  console.error(`No benchmark records yet at ${BENCHMARK_FILE}.`);
  console.error("Register or log in once with the server running, then re-run this.");
  process.exit(1);
}

if (mode === "--json") {
  console.log(JSON.stringify({ summary: summarizeBenchmarks(records), records }, null, 2));
  process.exit(0);
}

if (mode === "--csv") {
  console.log("timestamp,operation,status,reason,subject,totalMs,clientPreMs,serverMs");
  // Oldest first: a CSV is usually plotted against time.
  for (const r of [...records].reverse()) {
    console.log(
      [
        r.timestamp,
        r.operation,
        r.status,
        r.reason ?? "",
        r.subject ?? "",
        r.totalMs ?? "",
        r.clientPreMs ?? "",
        r.serverMs ?? "",
      ].join(",")
    );
  }
  process.exit(0);
}

const summary = summarizeBenchmarks(records);
const secs = (v) => (v === null || v === undefined ? "n/a" : `${(v / 1000).toFixed(2)}s`);

console.log(`Benchmark report — ${BENCHMARK_FILE}`);
console.log(`${records.length} attempt(s), ${records[records.length - 1].timestamp} .. ${records[0].timestamp}\n`);

for (const [operation, s] of Object.entries(summary)) {
  console.log(`${operation.toUpperCase()}`);
  console.log(`  attempts        ${s.attempts}  (success ${s.success}, failure ${s.failure})`);
  if (s.endToEnd) {
    console.log(
      `  end-to-end      mean ${secs(s.endToEnd.meanMs)}  min ${secs(s.endToEnd.minMs)}  ` +
        `max ${secs(s.endToEnd.maxMs)}  p95 ${secs(s.endToEnd.p95Ms)}  (n=${s.endToEnd.count})`
    );
  } else {
    console.log("  end-to-end      no complete client+server measurement recorded");
  }
  if (s.serverSide) {
    console.log(
      `  server side     mean ${secs(s.serverSide.meanMs)}  min ${secs(s.serverSide.minMs)}  ` +
        `max ${secs(s.serverSide.maxMs)}  p95 ${secs(s.serverSide.p95Ms)}  (n=${s.serverSide.count})`
    );
  }
  const reasons = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]);
  if (reasons.length) {
    console.log("  failure reasons");
    for (const [reason, count] of reasons) console.log(`    ${count.toString().padStart(4)}  ${reason}`);
  }
  console.log("");
}
