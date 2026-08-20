// Encryption at rest for stored biometric media (reviewer comment 2).
//
// Uploaded videos are never written to disk in plaintext: the upload handlers
// encrypt the in-memory buffer and write `<name>.mp4.enc`. At login the videos
// are decrypted into a private temp directory, the pipeline runs on the temp
// copies, and the directory is removed. AES-256-GCM's auth tag doubles as the
// integrity check: a tampered file fails decryption, and authentication fails
// closed.
//
// File format: "MBENC1" magic | 12-byte IV | 16-byte GCM tag | ciphertext.
//
// The key is a PARAMETER, not a global: biometric templates pass their owner's
// per-user key (keyVault.js), while the module-level key below — derived from
// BIOMETRIC_KEY — covers only the transient login recordings. No template is
// readable under it.

import crypto from "crypto";
import fs from "fs";
import ENV from "./config.js";

const MAGIC = Buffer.from("MBENC1");

function key() {
  if (ENV.BIOMETRIC_KEY) {
    return crypto.createHash("sha256").update(ENV.BIOMETRIC_KEY).digest();
  }
  // Deriving from JWT_SECRET keeps a fresh clone working. DEVELOPMENT ONLY:
  // under NODE_ENV=production, config.js refuses to start without BIOMETRIC_KEY,
  // so this branch is unreachable there.
  console.warn(
    "[secureStore] BIOMETRIC_KEY not set — deriving file key from JWT_SECRET. " +
      "Development only; production refuses to start without it."
  );
  return crypto
    .createHash("sha256")
    .update("biometric-at-rest:" + ENV.JWT_SECRET)
    .digest();
}

const KEY = key();

/**
 * The global at-rest key (BIOMETRIC_KEY). Its remaining jobs are the TRANSIENT
 * login-video blobs, deleted after each attempt, and — via templateStore's
 * templateSecret() — the HMAC that derives pseudonymous template file names.
 * It decrypts no template: those use their owner's per-user key from the vault.
 * Exported so scripts/migrate_to_per_user_keys.mjs can read a restored
 * pre-migration file in order to re-key it.
 */
export function legacyBiometricKey() {
  return KEY;
}

/**
 * Encrypts a buffer and writes it to destPath (atomically via rename).
 * `fileKey` defaults to the legacy global key; pass a per-user 32-byte key
 * for biometric templates.
 */
export function encryptToFile(plaintext, destPath, fileKey = KEY) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", fileKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const out = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ct]);
  const tmp = destPath + ".tmp";
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, destPath);
}

/**
 * Decrypts encPath and writes the plaintext to destPath.
 * Throws on a missing, corrupted, or tampered file — callers must fail closed.
 * `fileKey` defaults to the legacy global key; pass the owner's per-user key
 * for biometric templates.
 */
export function decryptToFile(encPath, destPath, fileKey = KEY) {
  const data = fs.readFileSync(encPath);
  if (data.length < MAGIC.length + 12 + 16 || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error(`not an encrypted biometric file: ${encPath}`);
  }
  const iv = data.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = data.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const ct = data.subarray(MAGIC.length + 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", fileKey, iv);
  decipher.setAuthTag(tag);
  // GCM throws here if the file was modified after encryption (integrity).
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  fs.writeFileSync(destPath, pt);
}
