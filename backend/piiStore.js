// Encryption at rest for account PII.
//
// The template store has been pseudonymous and encrypted for some time, but the
// account database was not: a dump of the `users` collection handed over every
// enrolled person's email, name, mobile number and address in the clear. That
// was documented as an accepted residual risk rather than a property of the
// design, and it is the one store in the system that still held readable
// personal data.
//
// The contact fields are now sealed under AES-256-GCM before they are written,
// and opened on read. Two deliberate limits:
//
//   * The KEY IS DISTINCT from the biometric key. Compromising the template key
//     must not also disclose contact details, and vice versa; deriving both from
//     one secret would make that separation cosmetic.
//   * The USERNAME STAYS PLAINTEXT. Every login queries it (`findOne({username})`),
//     it is what the client submits, and it is signed into the session token.
//     Sealing it would buy nothing while the client sends it in the clear on
//     every request, and would cost a blind index on the hot lookup path.
//
// Email is both encrypted and indexed, because registration must reject a
// duplicate address without being able to read any stored one. `emailIndex()` is
// a keyed hash over the normalized address: equality is preserved (so the unique
// index still works), the address itself is not recoverable from it, and it is
// keyed rather than plain because email addresses are guessable and would fall
// to a dictionary against an unkeyed digest. It is the same construction, and
// the same reasoning, as the template file names in templateStore.js.
//
// Field format: base64("PII1" | 12-byte IV | 16-byte GCM tag | ciphertext).

import crypto from "crypto";
import ENV from "./config.js";

const MAGIC = Buffer.from("PII1");

function keyMaterial() {
  if (ENV.PII_KEY) return ENV.PII_KEY;
  // A fresh clone still runs. DEVELOPMENT ONLY: under NODE_ENV=production,
  // config.js refuses to start without PII_KEY, so this branch cannot be reached
  // there and no deployment can end up protecting account data with JWT_SECRET.
  console.warn(
    "[piiStore] PII_KEY not set — deriving the account-PII key from JWT_SECRET. " +
      "Development only; production refuses to start without it."
  );
  // The label differs from secureStore's, so even under the shared fallback the
  // two subsystems do not end up with the same key.
  return "account-pii:" + ENV.JWT_SECRET;
}

const SECRET = keyMaterial();
const KEY = crypto.createHash("sha256").update(SECRET).digest();

/** True if v is a value this module produced (used to tolerate legacy rows). */
export function isSealed(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  let raw;
  try {
    raw = Buffer.from(value, "base64");
  } catch {
    return false;
  }
  return (
    raw.length >= MAGIC.length + 28 && raw.subarray(0, MAGIC.length).equals(MAGIC)
  );
}

/** Encrypts one field value. Empty/absent values are stored as-is. */
export function seal(value) {
  if (value === undefined || value === null || value === "") return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ct]).toString("base64");
}

/**
 * Decrypts one field value.
 *
 * A value that was never sealed is returned unchanged: accounts written before
 * this module existed are readable until the migration runs over them
 * (scripts/migrate_pii.mjs). A value that IS sealed but fails its GCM tag throws
 * — that is tampering or a wrong key, and must not be papered over with a
 * plausible-looking fallback.
 */
export function open(value) {
  if (!isSealed(value)) return value;
  const raw = Buffer.from(value, "base64");
  const iv = raw.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = raw.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const ct = raw.subarray(MAGIC.length + 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Keyed, deterministic index for an email address; null for an absent one. */
export function emailIndex(email) {
  if (typeof email !== "string" || email.trim() === "") return null;
  return crypto
    .createHmac("sha256", SECRET)
    .update("email-index:" + email.trim().toLowerCase())
    .digest("hex");
}

// Everything the account record holds about a person except the username, which
// is the lookup key and stays readable. `profile` is a base64 avatar the user
// uploads, so it is personal data too.
export const SEALED_FIELDS = [
  "email",
  "firstName",
  "lastName",
  "mobile",
  "address",
  "profile",
];

/** Returns a copy of doc with every SEALED_FIELDS entry present in it sealed. */
export function sealFields(doc) {
  const out = { ...doc };
  for (const f of SEALED_FIELDS) {
    if (f in out) out[f] = seal(out[f]);
  }
  return out;
}

/** Inverse of sealFields, tolerating legacy plaintext rows. */
export function openFields(doc) {
  const out = { ...doc };
  for (const f of SEALED_FIELDS) {
    if (f in out) out[f] = open(out[f]);
  }
  return out;
}
