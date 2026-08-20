// One-shot migration: encrypted raw video -> encrypted biometric template.
//
// For every uploads/videos/<user>.mp4.enc this decrypts the video, extracts the
// face + voice templates, writes templates/<user>.tmpl.enc, and then deletes the
// raw video. Deletion is irreversible: the video cannot be reconstructed from a
// template. Back the .enc files up first if the recordings are irreplaceable.
//
// Usage (from backend/):
//   node --env-file=.env scripts/migrate_to_templates.mjs           # dry run
//   node --env-file=.env scripts/migrate_to_templates.mjs --delete  # delete raw video
//
// Login recordings (uploadsl/login_videos/) are not migrated: they are transient,
// and login() now deletes each one after the attempt.

import fs from "fs";
import os from "os";
import path from "path";
import { decryptToFile } from "../secureStore.js";
import { enrollFromBuffer, templatePath } from "../templateStore.js";
import { connectVault } from "../keyVault.js";
// enrollFromBuffer stores each template under a per-user vault key now.
await connectVault();

const DELETE = process.argv.includes("--delete");
const VIDEO_DIR = "uploads/videos/";

const encFiles = fs.existsSync(VIDEO_DIR)
  ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".mp4.enc"))
  : [];

if (encFiles.length === 0) {
  console.log("no raw registration videos left — nothing to migrate");
  process.exit(0);
}

console.log(
  `${encFiles.length} registration video(s) to migrate` +
    (DELETE ? "\n" : "  (DRY RUN — pass --delete to remove the raw videos)\n")
);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-"));
let migrated = 0;
let failed = 0;

for (const file of encFiles) {
  const username = file.replace(/\.mp4\.enc$/, "");
  const plain = path.join(work, username + ".mp4");
  try {
    decryptToFile(VIDEO_DIR + file, plain);
    const { ok, reason } = await enrollFromBuffer(fs.readFileSync(plain), username);
    if (!ok) {
      console.log(`  FAIL  ${username}: ${reason} — raw video KEPT`);
      failed++;
      continue;
    }
    const was = fs.statSync(VIDEO_DIR + file).size;
    const now = fs.statSync(templatePath(username)).size;
    console.log(
      `  OK    ${username}: ${(was / 1e6).toFixed(2)}MB video -> ${(now / 1024).toFixed(0)}KB template` +
        (DELETE ? "  (raw video deleted)" : "  (raw video kept — dry run)")
    );
    if (DELETE) fs.rmSync(VIDEO_DIR + file, { force: true });
    migrated++;
  } catch (e) {
    console.log(`  FAIL  ${username}: ${e.message} — raw video KEPT`);
    failed++;
  } finally {
    fs.rmSync(plain, { force: true });
  }
}

fs.rmSync(work, { recursive: true, force: true });
console.log(`\nmigrated=${migrated} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
