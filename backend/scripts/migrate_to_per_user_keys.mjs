// Migrates legacy biometric templates (encrypted under the single global
// BIOMETRIC_KEY) onto per-user keys stored in the separate key vault.
//
// For every account in the application database that holds a template file
// but no vault record:
//   1. decrypt the legacy template under the old global key (read into memory)
//   2. generate a fresh random 256-bit per-user key (keyVault.createUserKey —
//      the vault stores only the AES-256-GCM master-key-wrapped form)
//   3. encrypt the template under the new per-user key to a temp file
//   4. VERIFY: decrypt the temp file with the key fetched back from the vault
//      and compare byte-for-byte against the legacy plaintext
//   5. only then atomically replace the legacy template file
//
// The legacy file is never deleted before the re-encrypted copy has been
// proven decryptable end-to-end (vault round-trip included). A failure on any
// user removes that user's new vault record and leaves the legacy template
// untouched, then continues with the next user.
//
// Run from backend/:  node scripts/migrate_to_per_user_keys.mjs
// Requires the same env as the server (.env is loaded), including ATLAS_URI
// and (unless developing) BIOMETRIC_VAULT_URI / BIOMETRIC_MASTER_KEY /
// BIOMETRIC_INDEX_KEY, plus the OLD BIOMETRIC_KEY so legacy files stay readable.

import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import mongoose from "mongoose";
import ENV from "../config.js";
import UserModel from "../model/User.model.js";
import { decryptToFile, encryptToFile } from "../secureStore.js";
import { templatePath, hasTemplate } from "../templateStore.js";
import { connectVault, disconnectVault, createUserKey, getUserKey, deleteUserKey } from "../keyVault.js";

async function main() {
  if (!ENV.ATLAS_URI) {
    console.error("ATLAS_URI is not set — refusing to migrate against an in-memory DB.");
    process.exit(1);
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(ENV.ATLAS_URI);
  await connectVault();

  const users = await UserModel.find({}, { username: 1 }).lean();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "keymig-"));
  let migrated = 0, skipped = 0, failed = 0;

  try {
    for (const { username } of users) {
      if (!hasTemplate(username)) {
        skipped++;
        continue; // unenrolled account: nothing to migrate
      }
      if (await getUserKey(username)) {
        skipped++;
        continue; // already on a per-user key
      }

      const encPath = templatePath(username);
      const plainPath = path.join(work, "plain.json");
      const verifyPath = path.join(work, "verify.json");
      const newEncPath = encPath + ".new";
      try {
        // 1. legacy decrypt under the old global BIOMETRIC_KEY
        decryptToFile(encPath, plainPath);
        const plaintext = fs.readFileSync(plainPath);

        // 2.+3. fresh per-user key (wrapped into the vault) + re-encrypt
        const perUserKey = await createUserKey(username);
        try {
          encryptToFile(plaintext, newEncPath, perUserKey);
        } finally {
          perUserKey.fill(0);
        }

        // 4. verify the FULL new path: vault fetch → unwrap → decrypt → compare
        const fetchedKey = await getUserKey(username);
        if (!fetchedKey) throw new Error("vault record not readable after write");
        try {
          decryptToFile(newEncPath, verifyPath, fetchedKey);
        } finally {
          fetchedKey.fill(0);
        }
        if (!fs.readFileSync(verifyPath).equals(plaintext)) {
          throw new Error("re-encrypted template does not round-trip");
        }

        // 5. verified — replace the legacy file (atomic rename)
        fs.renameSync(newEncPath, encPath);
        migrated++;
        console.log(`[migrate] ${username}: template re-keyed onto per-user key`);
      } catch (e) {
        failed++;
        console.error(`[migrate] ${username}: FAILED (${e.message}) — legacy template left intact`);
        // undo the half-migration: no vault record without a matching template
        fs.rmSync(newEncPath, { force: true });
        try {
          await deleteUserKey(username);
        } catch (delErr) {
          console.error(`[migrate] ${username}: vault cleanup failed: ${delErr.message}`);
        }
      } finally {
        fs.rmSync(plainPath, { force: true });
        fs.rmSync(verifyPath, { force: true });
      }
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    await mongoose.disconnect();
    await disconnectVault();
  }

  console.log(`[migrate] done: ${migrated} migrated, ${skipped} skipped, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(`[migrate] fatal: ${e}`);
  process.exit(1);
});
