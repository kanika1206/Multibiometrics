// Biometric Key Vault — per-user template-encryption keys, in a SEPARATE
// MongoDB database from the application data.
//
// Every enrolled user gets an independent, cryptographically random 256-bit
// AES key (crypto.randomBytes(32)) that encrypts only that user's biometric
// template. The plaintext per-user key is NEVER stored anywhere: before it
// reaches this database it is wrapped with AES-256-GCM under a server-side
// master key (BIOMETRIC_MASTER_KEY), so a full dump of the vault yields only
// ciphertext key blobs. Rows are located by a pseudonymous index —
// userIndex = HMAC-SHA-256(BIOMETRIC_INDEX_KEY, username) — so the vault also
// stores no usernames. The two secrets are deliberately distinct from each
// other and from JWT_SECRET / PII_KEY / BIOMETRIC_KEY (config.js enforces
// this in production): unwrapping keys and linking rows to identities require
// different compromises.
//
// The vault connection is created with mongoose.createConnection(), never the
// default connection, so the existing application database (database/conn.js)
// is untouched: same models, same schema, same URI.

import crypto from "crypto";
import mongoose from "mongoose";
import ENV from "./config.js";

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

// HKDF-SHA-256 turns the operator-supplied secret string into exactly 32 key
// bytes. The `info` labels bind each derived key to its single purpose, so
// even a (forbidden, config-checked) reuse of the same env value would still
// yield different key material for wrapping vs indexing.
function derive32(secret, info) {
  return Buffer.from(crypto.hkdfSync("sha256", secret, "", info, 32));
}

function masterKey() {
  if (ENV.BIOMETRIC_MASTER_KEY) {
    return derive32(ENV.BIOMETRIC_MASTER_KEY, "biometric-key-wrap:v1");
  }
  // DEVELOPMENT ONLY: under NODE_ENV=production, config.js refuses to start
  // without BIOMETRIC_MASTER_KEY, so this branch is unreachable there.
  console.warn(
    "[keyVault] BIOMETRIC_MASTER_KEY not set — deriving the key-wrapping key " +
      "from JWT_SECRET. Development only; production refuses to start without it."
  );
  return derive32(ENV.JWT_SECRET, "biometric-key-wrap:dev:v1");
}

function indexKey() {
  if (ENV.BIOMETRIC_INDEX_KEY) {
    return derive32(ENV.BIOMETRIC_INDEX_KEY, "biometric-user-index:v1");
  }
  // Same development-only fallback as masterKey(); config.js gates production.
  console.warn(
    "[keyVault] BIOMETRIC_INDEX_KEY not set — deriving the vault index key " +
      "from JWT_SECRET. Development only; production refuses to start without it."
  );
  return derive32(ENV.JWT_SECRET, "biometric-user-index:dev:v1");
}

const MASTER_KEY = masterKey();
const INDEX_KEY = indexKey();

// Bump when the wrapping scheme itself changes (not per rotation of a single
// user's key — rotation replaces the row and re-stamps this version).
export const CURRENT_KEY_VERSION = 1;

// ---------------------------------------------------------------------------
// Vault connection + model (separate database)
// ---------------------------------------------------------------------------

const BiometricKeySchema = new mongoose.Schema(
  {
    // HMAC-SHA-256(BIOMETRIC_INDEX_KEY, username) — pseudonymous lookup key.
    // The vault never sees the username itself.
    userIndex: { type: String, required: true, unique: true },
    // The per-user 256-bit AES key, AES-256-GCM-wrapped under the master key.
    // base64. Never a plaintext key.
    encryptedPerUserKey: { type: String, required: true },
    // GCM nonce for the wrap — fresh crypto.randomBytes(12) per wrap. base64.
    iv: { type: String, required: true },
    // GCM authentication tag for the wrap. base64. Tampering with any stored
    // field (including userIndex, which is bound as AAD) fails the unwrap.
    authTag: { type: String, required: true },
    // Supports future per-user key rotation: a rotated key is written with a
    // higher version, so mixed-version vaults stay interpretable.
    keyVersion: { type: Number, required: true, default: CURRENT_KEY_VERSION },
  },
  { timestamps: true } // createdAt / updatedAt
);

let vaultConnection = null;
let BiometricKeys = null;
let memoryServer = null;

/**
 * Connects to the vault database. Called once at startup (server.js), before
 * the HTTP listener comes up, so enrollment/login never race the connection.
 *
 * Uses mongoose.createConnection — NOT mongoose.connect — so the default
 * connection (the application database) is completely unaffected. When
 * BIOMETRIC_VAULT_URI is unset, a throwaway in-memory MongoDB is started,
 * mirroring the development behavior of database/conn.js but as a separate
 * instance: even in development the two stores never share a database.
 */
export async function connectVault() {
  if (vaultConnection) return vaultConnection;
  let uri = ENV.BIOMETRIC_VAULT_URI;
  if (!uri) {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
    console.warn(
      "[keyVault] BIOMETRIC_VAULT_URI not set — using a throwaway in-memory " +
        "vault database. Enrollments will not survive a restart."
    );
  }
  vaultConnection = await mongoose.createConnection(uri).asPromise();
  BiometricKeys = vaultConnection.model("BiometricKeys", BiometricKeySchema);
  console.log("Biometric key vault connected (separate database)");
  return vaultConnection;
}

/** For tests and graceful shutdown. */
export async function disconnectVault() {
  if (vaultConnection) await vaultConnection.close();
  if (memoryServer) await memoryServer.stop();
  vaultConnection = null;
  BiometricKeys = null;
  memoryServer = null;
}

function model() {
  if (!BiometricKeys) {
    // Fail closed: a vault that never connected must not silently no-op.
    throw new Error("keyVault: connectVault() has not completed");
  }
  return BiometricKeys;
}

// ---------------------------------------------------------------------------
// Crypto: wrap / unwrap
// ---------------------------------------------------------------------------

/** Pseudonymous vault lookup key for a username. Deterministic, keyed. */
export function userIndex(username) {
  return crypto
    .createHmac("sha256", INDEX_KEY)
    .update("vault-user:" + username)
    .digest("hex");
}

// AAD binds the wrapped blob to its row (index + version): a ciphertext copied
// onto another user's row, or replayed under a different version, fails the tag.
function wrapKey(perUserKey, idx, keyVersion) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", MASTER_KEY, iv);
  cipher.setAAD(Buffer.from(`${idx}:${keyVersion}`));
  const ct = Buffer.concat([cipher.update(perUserKey), cipher.final()]);
  return {
    encryptedPerUserKey: ct.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function unwrapKey(record) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    MASTER_KEY,
    Buffer.from(record.iv, "base64")
  );
  decipher.setAAD(Buffer.from(`${record.userIndex}:${record.keyVersion}`));
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  // Throws on tampering (wrong tag) — callers fail closed.
  return Buffer.concat([
    decipher.update(Buffer.from(record.encryptedPerUserKey, "base64")),
    decipher.final(),
  ]);
}

// ---------------------------------------------------------------------------
// Vault operations
// ---------------------------------------------------------------------------

/**
 * A fresh, independent 256-bit template key. Generated but NOT stored: the
 * caller decides when (and whether) the vault row is written. Re-enrolment
 * needs that separation — the new key must encrypt the new template before the
 * old key is replaced, or a failure half-way would leave the stored template
 * unreadable (templateStore.reenrollFromBuffer).
 */
export function generateUserKey() {
  return crypto.randomBytes(32); // CSPRNG, unique per user
}

/**
 * Stores (only) the wrapped form of an already-generated key. Upsert, so a
 * rotation replaces the user's row in place and is re-stamped with the current
 * wrapping version. Also the rollback path: re-writing the previous key
 * restores the vault exactly as it was.
 */
export async function putUserKey(username, perUserKey) {
  const idx = userIndex(username);
  const wrapped = wrapKey(perUserKey, idx, CURRENT_KEY_VERSION);
  await model().findOneAndUpdate(
    { userIndex: idx },
    { $set: { ...wrapped, keyVersion: CURRENT_KEY_VERSION } },
    { upsert: true, new: true }
  );
}

/**
 * Generates a fresh, independent 256-bit key for this user, stores only the
 * wrapped form, and returns the plaintext key Buffer for immediate use by the
 * template encryptor. Upsert: a leftover row from a rolled-back enrollment is
 * replaced by a brand-new key rather than reused — an enrollment never
 * inherits key material from a failed attempt. (A FIRST enrollment only: an
 * account that already holds a template is re-keyed through the rotate-and-swap
 * path in templateStore.reenrollFromBuffer, never here.)
 */
export async function createUserKey(username) {
  const perUserKey = generateUserKey();
  await putUserKey(username, perUserKey);
  return perUserKey;
}

/**
 * Retrieves and unwraps this user's template key. Returns the plaintext key
 * Buffer, or null when the user has no vault record (legacy, pre-migration
 * enrollments). Throws if the stored blob fails its GCM tag — fail closed.
 */
export async function getUserKey(username) {
  const record = await model().findOne({ userIndex: userIndex(username) }).lean();
  if (!record) return null;
  return unwrapKey(record);
}

/**
 * Removes a user's vault record. Used by enrollment rollback so a failed
 * registration leaves no orphaned key material behind.
 */
export async function deleteUserKey(username) {
  await model().deleteOne({ userIndex: userIndex(username) });
}
