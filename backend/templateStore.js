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
// Templates live in backend/templates/<username>.tmpl.enc, inside the same
// AES-256-GCM envelope the videos used (secureStore.js).

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ENV from "./config.js";
import { encryptToFile, decryptToFile } from "./secureStore.js";

export const TEMPLATE_DIR = "./templates/";

export function templatePath(username) {
  return TEMPLATE_DIR + username + ".tmpl.enc";
}

/** Runs extractTemplate.py on a video, resolving { code, stderr }. */
export function runExtractTemplate(videoPath, outJsonPath, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const child = spawn(ENV.PYTHON, ["./extractTemplate.py", videoPath, outJsonPath]);
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
    const { code, stderr } = await runExtractTemplate(video, json);
    if (code !== 0) {
      // Most common cause: no face detected anywhere in the recording.
      console.error(`[enroll ${username}] extraction failed (exit ${code}): ${stderr.trim()}`);
      return { ok: false, reason: "Could not extract biometrics from the video" };
    }
    fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
    encryptToFile(fs.readFileSync(json), templatePath(username));
    // A single usable face frame still enrolls, but it is a thin template — the
    // frame count is logged so a weak enrollment is visible now, not at login.
    console.log(`[enroll ${username}] ${stderr.trim()} -> ${templatePath(username)} (raw video discarded)`);
    return { ok: true };
  } finally {
    // The only plaintext video and template copies lived here.
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Decrypts a stored template to destPath. Throws if missing or tampered. */
export function decryptTemplate(username, destPath) {
  decryptToFile(templatePath(username), destPath);
}
