// Tests for per-user biometric key management (keyVault.js) and its
// integration with the template store. Run from backend/:
//
//   npm test        (node --test tests/)
//
// Uses the vault's own in-memory MongoDB fallback (BIOMETRIC_VAULT_URI unset),
// so no real database is touched. The application database is never connected
// by these tests at all — which is itself part of what they assert: key
// management must not require or alter the application DB.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";

// A dedicated THROWAWAY vault database, never the real one: these tests write
// tampered rows and drop the whole database on teardown. Overridable via env;
// the default assumes the dev box's Dockerised Mongo (the bundled
// mongodb-memory-server fallback needs libcrypto.so.1.1, absent on modern
// Ubuntu). Set BEFORE the dynamic imports below so keyVault.js sees it.
process.env.BIOMETRIC_VAULT_URI =
  process.env.BIOMETRIC_VAULT_URI_TEST ||
  "mongodb://localhost:27017/biometric_key_vault_test";

// Dynamic imports: static imports would hoist above the env assignment.
const {
  connectVault,
  disconnectVault,
  createUserKey,
  getUserKey,
  deleteUserKey,
  userIndex,
  CURRENT_KEY_VERSION,
} = await import("../keyVault.js");
const { encryptToFile, decryptToFile, legacyBiometricKey } = await import("../secureStore.js");
const { decryptTemplate, templatePath, TEMPLATE_DIR } = await import("../templateStore.js");
const { UserSchema } = await import("../model/User.model.js");
const { issueEnrollToken, enrollUsernameFrom } = await import("../enrollToken.js");
const { productionSecretProblems } = await import("../config.js");

let vault;
let work;

before(async () => {
  vault = await connectVault();
  work = fs.mkdtempSync(path.join(os.tmpdir(), "keytest-"));
});

// Synthetic users whose templates are written into the real TEMPLATE_DIR (the
// file name is an HMAC, so they cannot collide with a real enrollment). Removed
// in after() so a test run leaves the template directory exactly as it found it.
const TEMPLATE_USERS = ["tpl_ok", "tpl_nokey", "tpl_noglobal", "tpl_badwrap", "tpl_badct"];

after(async () => {
  for (const u of TEMPLATE_USERS) fs.rmSync(templatePath(u), { force: true });
  await vault.dropDatabase(); // throwaway test DB — leave nothing behind
  await disconnectVault();
  fs.rmSync(work, { recursive: true, force: true });
});

function rawVaultRows() {
  return vault.collection("biometrickeys").find({}).toArray();
}

// --- 1. existing application schema unchanged -------------------------------

test("User schema carries no biometric-key fields", () => {
  const paths = Object.keys(UserSchema.paths);
  for (const forbidden of ["encryptedPerUserKey", "iv", "authTag", "keyVersion", "userIndex", "biometricKey"]) {
    assert.ok(!paths.includes(forbidden), `User schema must not contain ${forbidden}`);
  }
  // The fields the application relies on are still there.
  for (const required of ["username", "email", "emailIdx", "profile"]) {
    assert.ok(paths.includes(required), `User schema lost ${required}`);
  }
});

// --- 2. vault is a separate database ----------------------------------------

test("vault uses its own connection, not the application connection", () => {
  assert.notEqual(vault, mongoose.connection);
  // The application's default connection was never opened by key management.
  assert.equal(mongoose.connection.readyState, 0, "app DB connection must stay untouched");
  // And the vault knows nothing about application models.
  assert.ok(!vault.modelNames().includes("User"));
  assert.ok(vault.modelNames().includes("BiometricKeys"));
});

// --- 3. per-user keys are independent ----------------------------------------

test("each user gets a different 256-bit key", async () => {
  const kA = await createUserKey("userA");
  const kB = await createUserKey("userB");
  assert.equal(kA.length, 32);
  assert.equal(kB.length, 32);
  assert.ok(!kA.equals(kB), "User A and User B must not share a key");
});

// --- 4./5. cross-user isolation ----------------------------------------------

test("user A's key cannot decrypt user B's template and vice versa", async () => {
  const kA = await createUserKey("isoA");
  const kB = await createUserKey("isoB");
  const tplA = Buffer.from(JSON.stringify({ face: [1, 2, 3], owner: "A" }));
  const tplB = Buffer.from(JSON.stringify({ face: [4, 5, 6], owner: "B" }));
  const fileA = path.join(work, "a.tmpl.enc");
  const fileB = path.join(work, "b.tmpl.enc");
  encryptToFile(tplA, fileA, kA);
  encryptToFile(tplB, fileB, kB);

  // wrong key → GCM tag failure → throw
  assert.throws(() => decryptToFile(fileB, path.join(work, "x.json"), kA));
  assert.throws(() => decryptToFile(fileA, path.join(work, "y.json"), kB));

  // right key still works
  decryptToFile(fileA, path.join(work, "a.json"), kA);
  assert.deepEqual(fs.readFileSync(path.join(work, "a.json")), tplA);
});

// --- 6. key stable across logins ---------------------------------------------

test("the same user's key is retrievable repeatedly and matches", async () => {
  const created = await createUserKey("stable");
  const fetched1 = await getUserKey("stable");
  const fetched2 = await getUserKey("stable");
  assert.ok(created.equals(fetched1));
  assert.ok(fetched1.equals(fetched2));
});

// --- 7. no plaintext keys or usernames in the vault --------------------------

test("vault rows contain neither the plaintext key nor the username", async () => {
  const key = await createUserKey("secretuser");
  const rows = await rawVaultRows();
  const row = rows.find((r) => r.userIndex === userIndex("secretuser"));
  assert.ok(row, "vault row exists");
  const dump = JSON.stringify(rows);
  assert.ok(!dump.includes(key.toString("base64")), "plaintext key (base64) leaked");
  assert.ok(!dump.includes(key.toString("hex")), "plaintext key (hex) leaked");
  assert.ok(!dump.includes("secretuser"), "username leaked into vault");
  // and the wrapped blob is not the key itself
  assert.notEqual(row.encryptedPerUserKey, key.toString("base64"));
  assert.equal(row.keyVersion, CURRENT_KEY_VERSION);
  assert.ok(row.createdAt instanceof Date);
});

// --- 8. tampering detection ---------------------------------------------------

test("tampering with the wrapped key blob is detected", async () => {
  await createUserKey("tamper1");
  const idx = userIndex("tamper1");
  // flip one byte of the stored ciphertext
  const row = (await rawVaultRows()).find((r) => r.userIndex === idx);
  const bytes = Buffer.from(row.encryptedPerUserKey, "base64");
  bytes[0] ^= 0xff;
  await vault
    .collection("biometrickeys")
    .updateOne({ userIndex: idx }, { $set: { encryptedPerUserKey: bytes.toString("base64") } });
  await assert.rejects(() => getUserKey("tamper1"));
});

test("a wrapped key copied onto another user's row fails (AAD binding)", async () => {
  await createUserKey("victim");
  await createUserKey("attacker");
  const rows = await rawVaultRows();
  const victimRow = rows.find((r) => r.userIndex === userIndex("victim"));
  // graft the victim's wrapped blob onto the attacker's row
  await vault.collection("biometrickeys").updateOne(
    { userIndex: userIndex("attacker") },
    {
      $set: {
        encryptedPerUserKey: victimRow.encryptedPerUserKey,
        iv: victimRow.iv,
        authTag: victimRow.authTag,
      },
    }
  );
  await assert.rejects(() => getUserKey("attacker"));
});

test("tampering with an encrypted template file is detected", async () => {
  const k = await createUserKey("filetamper");
  const file = path.join(work, "t.tmpl.enc");
  encryptToFile(Buffer.from("template-bytes"), file, k);
  const data = fs.readFileSync(file);
  data[data.length - 1] ^= 0x01; // flip a ciphertext byte
  fs.writeFileSync(file, data);
  assert.throws(() => decryptToFile(file, path.join(work, "t.json"), k));
});

// --- 9. rollback removes orphaned key records ---------------------------------

test("deleteUserKey removes the vault record", async () => {
  await createUserKey("rollback");
  assert.ok(await getUserKey("rollback"));
  await deleteUserKey("rollback");
  assert.equal(await getUserKey("rollback"), null);
});

test("re-enrollment after a rolled-back attempt gets a fresh key", async () => {
  const k1 = await createUserKey("retry");
  const k2 = await createUserKey("retry"); // upsert: replaces, never reuses
  assert.ok(!k1.equals(k2));
  const rows = (await rawVaultRows()).filter((r) => r.userIndex === userIndex("retry"));
  assert.equal(rows.length, 1, "exactly one vault row per user");
});

// --- 10. enrollment-token security unchanged -----------------------------------

test("enrollment token round-trip still works and still rejects misuse", () => {
  const token = issueEnrollToken("tokenuser");
  const ok = enrollUsernameFrom({ headers: { authorization: `Bearer ${token}` } });
  assert.equal(ok, "tokenuser");
  // no token, malformed token → refused
  assert.equal(enrollUsernameFrom({ headers: {} }), null);
  assert.equal(enrollUsernameFrom({ headers: { authorization: "Bearer junk" } }), null);
});

// --- 11. decryptTemplate fails closed at every step ---------------------------
//
// The whole decryption path is: username -> userIndex -> vault lookup ->
// wrapped key -> unwrap under BIOMETRIC_MASTER_KEY -> AES-256-GCM decrypt.
// Each of the ways it can break must throw, never fall back to the global
// BIOMETRIC_KEY (login turns a throw into a generic 401).

test("decryptTemplate succeeds with the owner's vault key", async () => {
  const user = "tpl_ok";
  const k = await createUserKey(user);
  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  encryptToFile(Buffer.from('{"face":[1]}'), templatePath(user), k);
  const out = path.join(work, "ok.json");
  await decryptTemplate(user, out);
  assert.equal(fs.readFileSync(out, "utf8"), '{"face":[1]}');
});

test("decryptTemplate fails closed when the vault record is missing", async () => {
  const user = "tpl_nokey";
  const k = await createUserKey(user);
  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  encryptToFile(Buffer.from("{}"), templatePath(user), k);
  await deleteUserKey(user); // vault record gone; template file still on disk
  await assert.rejects(
    () => decryptTemplate(user, path.join(work, "nokey.json")),
    /no per-user key in the vault/
  );
});

test("a template is NOT readable under the global BIOMETRIC_KEY", async () => {
  const user = "tpl_noglobal";
  const k = await createUserKey(user);
  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  encryptToFile(Buffer.from("{}"), templatePath(user), k);
  // The legacy key is still derivable — it just does not open this file.
  assert.throws(() =>
    decryptToFile(templatePath(user), path.join(work, "g.json"), legacyBiometricKey())
  );
});

test("decryptTemplate fails closed when the wrapped per-user key is tampered with", async () => {
  const user = "tpl_badwrap";
  const k = await createUserKey(user);
  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  encryptToFile(Buffer.from("{}"), templatePath(user), k);
  const idx = userIndex(user);
  const row = (await rawVaultRows()).find((r) => r.userIndex === idx);
  const bytes = Buffer.from(row.encryptedPerUserKey, "base64");
  bytes[0] ^= 0xff;
  await vault
    .collection("biometrickeys")
    .updateOne({ userIndex: idx }, { $set: { encryptedPerUserKey: bytes.toString("base64") } });
  await assert.rejects(() => decryptTemplate(user, path.join(work, "badwrap.json")));
});

test("decryptTemplate fails closed when the template ciphertext is tampered with", async () => {
  const user = "tpl_badct";
  const k = await createUserKey(user);
  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  encryptToFile(Buffer.from("{}"), templatePath(user), k);
  const data = fs.readFileSync(templatePath(user));
  data[data.length - 1] ^= 0x01;
  fs.writeFileSync(templatePath(user), data);
  await assert.rejects(() => decryptTemplate(user, path.join(work, "badct.json")));
});

// --- 12. migration semantics ---------------------------------------------------

test("legacy template can be re-keyed and verified before replacement", async () => {
  const plaintext = Buffer.from(JSON.stringify({ face: [7, 8, 9] }));
  const file = path.join(work, "mig.tmpl.enc");
  encryptToFile(plaintext, file); // legacy global key

  // migration steps: legacy-decrypt → new key → re-encrypt → verify → replace
  const tmpPlain = path.join(work, "mig.plain");
  decryptToFile(file, tmpPlain);
  const k = await createUserKey("miguser");
  const newFile = file + ".new";
  encryptToFile(fs.readFileSync(tmpPlain), newFile, k);
  const fetched = await getUserKey("miguser");
  const verifyOut = path.join(work, "mig.verify");
  decryptToFile(newFile, verifyOut, fetched);
  assert.deepEqual(fs.readFileSync(verifyOut), plaintext);
  fs.renameSync(newFile, file);

  // post-migration: legacy key no longer opens it, the per-user key does
  assert.throws(() => decryptToFile(file, tmpPlain, legacyBiometricKey()));
  decryptToFile(file, tmpPlain, fetched);
  assert.deepEqual(fs.readFileSync(tmpPlain), plaintext);
});

// --- config enforcement ---------------------------------------------------------

test("production refuses identical or missing vault secrets", () => {
  const base = {
    JWT_SECRET: "j".repeat(40),
    BIOMETRIC_KEY: "b".repeat(40),
    PII_KEY: "p".repeat(40),
    BIOMETRIC_MASTER_KEY: "m".repeat(40),
    BIOMETRIC_INDEX_KEY: "i".repeat(40),
    ATLAS_URI: "mongodb://db1/app",
    BIOMETRIC_VAULT_URI: "mongodb://db2/vault",
  };
  assert.equal(productionSecretProblems(base).length, 0);

  // missing master key
  assert.ok(
    productionSecretProblems({ ...base, BIOMETRIC_MASTER_KEY: undefined })
      .some((p) => p.includes("BIOMETRIC_MASTER_KEY")));
  // master key == index key
  assert.ok(
    productionSecretProblems({ ...base, BIOMETRIC_INDEX_KEY: base.BIOMETRIC_MASTER_KEY })
      .some((p) => p.includes("identical")));
  // master key == JWT secret
  assert.ok(
    productionSecretProblems({ ...base, BIOMETRIC_MASTER_KEY: base.JWT_SECRET })
      .some((p) => p.includes("JWT_SECRET")));
  // vault URI collapsing into the app URI
  assert.ok(
    productionSecretProblems({ ...base, BIOMETRIC_VAULT_URI: base.ATLAS_URI })
      .some((p) => p.includes("BIOMETRIC_VAULT_URI")));
});
