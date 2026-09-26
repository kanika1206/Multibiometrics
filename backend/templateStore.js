// Encrypted biometric TEMPLATE storage (reviewer comment 2).
//
// The scheme used to keep the whole registration video (`username.mp4.enc`)
// indefinitely, so a server breach leaked a reversible recording of the user's
// face and voice. It no longer does: registration reduces the video to templates
// (a 512-d InsightFace face embedding + a 192-d ECAPA-TDNN voice embedding),
// encrypts those, and deletes the video. A stolen template still deserves
// protection — hence AES-256-GCM — but
// it is not a playable recording of the user.
//
// Templates live in backend/templates/<hmac>.tmpl.enc, inside the same
// AES-256-GCM envelope the videos used (secureStore.js) — but under a key that
// belongs to one user alone. Each enrollment mints a random 256-bit key held
// (wrapped) in the separate key vault (keyVault.js); the global BIOMETRIC_KEY
// no longer decrypts any template, only the transient login recordings and the
// HMAC that derives the file names below.

import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import ENV from "./config.js";
import { encryptToFile, decryptToFile } from "./secureStore.js";
import {
  createUserKey,
  generateUserKey,
  putUserKey,
  getUserKey,
  deleteUserKey,
} from "./keyVault.js";

export const TEMPLATE_DIR = "./templates/";

// The on-disk template name used to BE the username (kanika1206.tmpl.enc), so a
// filesystem-only leak of this directory — no database, no key — disclosed the
// entire enrolled membership by name and handed the attacker one labelled
// biometric template per person. That violates the unlinkability property of
// ISO/IEC 24745. The name is now a keyed hash of the username instead.
//
// Keyed, not a plain hash: usernames are short and guessable, so an unkeyed
// hash would fall to a dictionary. HMAC under the same secret that protects the
// templates means a filesystem-only attacker (who lacks the key) cannot map a
// file back to a user, while an attacker who HAS the key could already decrypt
// everything, so linkage is moot. It is deterministic, so login re-derives the
// same name with no database lookup and no schema change — the identity mapping
// lives nowhere new.
function templateSecret() {
  // Mirror secureStore's key source so filename derivation shares the template
  // key's lifecycle: if it rotates, names change in lockstep with decryptability.
  return ENV.BIOMETRIC_KEY || "biometric-at-rest:" + ENV.JWT_SECRET;
}

/** Deterministic, non-reversible on-disk id for a username. */
export function templateId(username) {
  return crypto
    .createHmac("sha256", templateSecret())
    .update("template-name:" + username)
    .digest("hex");
}

export function templatePath(username) {
  return TEMPLATE_DIR + templateId(username) + ".tmpl.enc";
}

/**
 * True if this username already holds an enrollment.
 *
 * Two callers depend on it, and both are security-relevant. /upload-video uses
 * it to refuse a second enrollment outright, so a stored template can never be
 * replaced even by a holder of a valid enrollment token. Registration uses it to
 * distinguish an enrolled account from an abandoned one: an account with no
 * template was never bound to any biometrics and can never authenticate, so its
 * identifier may be released, whereas an enrolled account is untouchable.
 */
export function hasTemplate(username) {
  return fs.existsSync(templatePath(username));
}

// A quality-gate rejection (exit 3) names its cause on stderr as
// QUALITY:<CODE>. The codes are mapped to sentences the user can act on —
// "move closer", "improve the lighting" — instead of the opaque "could not
// extract biometrics" every extraction failure used to produce.
const QUALITY_MESSAGES = {
  FACE_TOO_SMALL:
    "Your face is too small in the frame. Move closer to the camera, or use a " +
    "higher-resolution camera, and record again.",
  TOO_FEW_USABLE_FRAMES:
    "Your face was clearly visible in too few frames. Improve the lighting, keep " +
    "your face centred and still, and record again.",
};

/** Maps a quality-gate exit to its user-facing sentence, or null. */
export function qualityReason(stderr) {
  const m = /QUALITY:([A-Z_]+)/.exec(stderr || "");
  if (!m) return null;
  return QUALITY_MESSAGES[m[1]] || "Your recording was not of usable quality. Please record again.";
}

/**
 * Runs extractTemplate.py on a video, resolving { code, stderr }.
 *
 * `enrollment: true` turns on the acquisition quality gate (minimum face size,
 * minimum count of usable frames). It is applied at ENROLMENT ONLY: the stored
 * template is permanent under template-only storage, so a poor enrolment is
 * unrecoverable, whereas tightening the same gate at login would simply raise
 * the false rejection rate for users who are already enrolled.
 */
export function runExtractTemplate(videoPath, outJsonPath, opts = {}) {
  const { enrollment = false, timeoutMs = 120000 } = opts;
  return new Promise((resolve) => {
    const args = ["./extractTemplate.py", videoPath, outJsonPath];
    if (enrollment) args.push("--enrollment");
    const child = spawn(ENV.PYTHON, args);
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const settle = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stderr });
    };
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      console.error(`[template] spawn error: ${err}`);
      settle(null);
    });
    child.on("close", settle);
  });
}

/**
 * Enrolls a registration video: extracts the templates, encrypts them to
 * templates/<username>.tmpl.enc, and destroys every plaintext copy of the video.
 * The video is never written outside the temp dir removed below.
 *
 * Resolves { ok: true } or { ok: false, reason } — the caller fails closed.
 */
export async function enrollFromBuffer(buffer, username) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "enroll-"));
  const video = path.join(work, "reg.mp4");
  const json = path.join(work, "reg.json");
  try {
    fs.writeFileSync(video, buffer);
    const { code, stderr } = await runExtractTemplate(video, json, { enrollment: true });
    if (code !== 0) {
      // Most common cause: no face detected anywhere in the recording. Exit 3 is
      // the quality gate, which says exactly what was wrong with the capture.
      console.error(`[enroll ${username}] extraction failed (exit ${code}): ${stderr.trim()}`);
      return {
        ok: false,
        reason: qualityReason(stderr) || "Could not extract biometrics from the video",
      };
    }
    fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
    // Per-user key isolation: a fresh random 256-bit key is generated for THIS
    // user (keyVault stores only its master-key-wrapped form, in a separate
    // database) and the template is encrypted under it. No two users share a
    // template key, and the global BIOMETRIC_KEY no longer protects templates.
    let perUserKey;
    try {
      perUserKey = await createUserKey(username);
      encryptToFile(fs.readFileSync(json), templatePath(username), perUserKey);
    } catch (e) {
      // All-or-nothing: a key whose template was never stored (or a vault write
      // that half-failed) must not linger — an orphaned vault row would shadow
      // this user's next enrollment attempt with stale key material.
      console.error(`[enroll ${username}] key/template storage failed: ${e.message}`);
      try {
        await deleteUserKey(username);
      } catch (delErr) {
        console.error(`[enroll ${username}] vault rollback failed: ${delErr.message}`);
      }
      fs.rmSync(templatePath(username), { force: true });
      return { ok: false, reason: "Could not store biometrics" };
    } finally {
      // The plaintext per-user key lives only for the duration of this write.
      if (perUserKey) perUserKey.fill(0);
    }
    // A single usable face frame still enrolls, but it is a thin template — the
    // frame count is logged so a weak enrollment is visible now, not at login.
    console.log(`[enroll ${username}] ${stderr.trim()} -> ${templatePath(username)} (raw video discarded)`);
    return { ok: true };
  } finally {
    // The only plaintext video and template copies lived here.
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Decrypts a stored template to destPath. Throws if missing or tampered.
 *
 * The only key that opens a template is this user's own, fetched from the key
 * vault and unwrapped under BIOMETRIC_MASTER_KEY:
 *
 *   username -> userIndex -> vault lookup -> wrapped key -> unwrap -> decrypt
 *
 * Every step fails CLOSED. A missing vault record, a wrapped key that fails
 * its authentication tag, and a tampered template all throw, and login turns
 * that into a generic 401. There is deliberately no fallback to the global
 * BIOMETRIC_KEY: a template that has lost its per-user key is unreadable by
 * design, not readable under a key shared with every other user. (Restoring
 * a pre-per-user-key backup therefore requires re-running
 * scripts/migrate_to_per_user_keys.mjs over it, which still reads legacy
 * files under the old key on purpose.)
 */
export async function decryptTemplate(username, destPath) {
  const perUserKey = await getUserKey(username);
  if (!perUserKey) {
    throw new Error(`no per-user key in the vault for ${username}`);
  }
  try {
    decryptToFile(templatePath(username), destPath, perUserKey);
  } finally {
    perUserKey.fill(0);
  }
}

/**
 * Re-enrolls an account that ALREADY holds a template: extracts the new
 * template, rotates this user's vault key, and replaces the stored ciphertext.
 *
 * Enrolment is otherwise final — /upload-video refuses to overwrite a stored
 * template, whoever asks — because overwriting one is exactly what account
 * takeover looks like. Re-enrolment is the one authorised exception, and its
 * authority is a `reenroll` grant that can only be minted by a SUCCESSFUL
 * three-factor login (appController.reenrollRequest). The replacement is
 * therefore written the only way that is safe against a half-failure:
 *
 *   1. extract to a temp file — a bad recording never reaches the stored copy;
 *   2. generate a NEW key, and encrypt the new template under it beside the
 *      old one (the old ciphertext and the old key are both still intact, so
 *      the account can still log in);
 *   3. commit the new key to the vault, then rename the new ciphertext over
 *      the old one. rename(2) within a directory is atomic, so no reader ever
 *      sees a partial template;
 *   4. if the rename fails after the key was committed, put the OLD key back
 *      and leave the old ciphertext in place — the account is exactly as it
 *      was before the attempt.
 *
 * Resolves { ok: true } or { ok: false, reason } — the caller fails closed and
 * the existing enrolment stays untouched.
 */
export async function reenrollFromBuffer(buffer, username) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "reenroll-"));
  const video = path.join(work, "reg.mp4");
  const json = path.join(work, "reg.json");
  const dest = templatePath(username);
  const staged = dest + ".new";
  let newKey;
  let oldKey;
  try {
    fs.writeFileSync(video, buffer);
    const { code, stderr } = await runExtractTemplate(video, json, { enrollment: true });
    if (code !== 0) {
      console.error(`[reenroll ${username}] extraction failed (exit ${code}): ${stderr.trim()}`);
      return {
        ok: false,
        reason: qualityReason(stderr) || "Could not extract biometrics from the video",
      };
    }
    // Kept so the rotation can be undone. A user with no vault record (a legacy
    // enrolment) simply has nothing to restore.
    try {
      oldKey = await getUserKey(username);
    } catch (e) {
      console.error(`[reenroll ${username}] previous key unreadable: ${e.message}`);
      oldKey = null;
    }
    newKey = generateUserKey();
    try {
      fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
      encryptToFile(fs.readFileSync(json), staged, newKey);
    } catch (e) {
      console.error(`[reenroll ${username}] could not stage the new template: ${e.message}`);
      fs.rmSync(staged, { force: true });
      return { ok: false, reason: "Could not store biometrics" };
    }
    await putUserKey(username, newKey);
    try {
      fs.renameSync(staged, dest);
    } catch (e) {
      console.error(`[reenroll ${username}] swap failed: ${e.message}`);
      fs.rmSync(staged, { force: true });
      if (oldKey) {
        try {
          await putUserKey(username, oldKey);
        } catch (restoreErr) {
          // The stored template is now unreadable. Loud, because the remedy is
          // operator re-enrolment, not a retry.
          console.error(
            `[reenroll ${username}] CRITICAL: key rotated but template not swapped ` +
              `and the previous key could not be restored: ${restoreErr.message}`
          );
        }
      }
      return { ok: false, reason: "Could not store biometrics" };
    }
    console.log(`[reenroll ${username}] ${stderr.trim()} -> ${dest} (key rotated, raw video discarded)`);
    return { ok: true };
  } finally {
    if (newKey) newKey.fill(0);
    if (oldKey) oldKey.fill(0);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Erases this user's stored template. Used by account deletion, which must
 * leave no biometric data behind — the encrypted template on disk is the data,
 * the account row is only the name attached to it.
 */
export function deleteTemplate(username) {
  fs.rmSync(templatePath(username), { force: true });
}
