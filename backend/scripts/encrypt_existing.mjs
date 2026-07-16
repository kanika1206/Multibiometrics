// One-time migration: encrypt pre-existing plaintext enrollment/login videos
// into the .enc format used by secureStore.js, then remove the plaintext
// (including derived .mp3s — they are regenerated per login in a temp dir).
//
// Usage: node scripts/encrypt_existing.mjs [--backup-dir <dir>]
// Test fixtures (imposter_l.mp4) are left alone on purpose.

import fs from "fs";
import path from "path";
import { encryptToFile } from "../secureStore.js";

const DIRS = ["uploads/videos", "uploadsl/login_videos"];
const FIXTURES = new Set(["imposter_l.mp4"]);

const backupIdx = process.argv.indexOf("--backup-dir");
const backupDir = backupIdx > -1 ? process.argv[backupIdx + 1] : null;
if (backupDir) fs.mkdirSync(backupDir, { recursive: true });

for (const dir of DIRS) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name.endsWith(".mp4") && !FIXTURES.has(name)) {
      if (backupDir) fs.copyFileSync(p, path.join(backupDir, name));
      encryptToFile(fs.readFileSync(p), p + ".enc");
      fs.unlinkSync(p);
      console.log(`encrypted ${p} -> ${p}.enc`);
    } else if (name.endsWith(".mp3")) {
      if (backupDir) fs.copyFileSync(p, path.join(backupDir, name));
      fs.unlinkSync(p);
      console.log(`removed derived ${p}`);
    }
  }
}
console.log("migration complete");
