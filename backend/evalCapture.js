// Optional evaluation-corpus capture (EVAL_CAPTURE).
//
// PRIVACY WARNING. This module deliberately writes PLAINTEXT recordings to disk
// — the exact thing the scheme otherwise avoids. It exists so a consented
// accuracy study can be collected by having participants use the application
// normally, instead of recording videos by hand. It is OFF unless EVAL_CAPTURE
// is set, and it must never be enabled in a real deployment.
//
// When enabled, a consented registration or login recording is copied, before
// template extraction and before the usual deletion, into ENV.EVAL_CORPUS_DIR
// (default ../eval_data) under the name the evaluation harness expects:
//
//     <subject>_s<session>__<code>.mp4
//
// <code> is the spoken challenge the participant was shown (the login CAPTCHA
// digits), or "enroll" for the registration recording, so every clip's expected
// utterance is known and the challenge factor can be scored offline too.
//
// <session> comes from EVAL_SESSION when the operator sets it (the recording-day
// protocol: EVAL_SESSION=1 on the first day, 2 on the second, several logins per
// session). Without it, numbering falls back to one session per upload
// (registration s1, each login s2, s3, ...). Genuine pairs are formed only
// BETWEEN sessions, so clips sharing a session never pair with each other.
//
// The privacy-preserving path is untouched: this only ADDS a copy. With
// EVAL_CAPTURE unset, captureIfEnabled is a no-op and returns null.

import fs from "fs";
import path from "path";
import ENV from "./config.js";
import { templateId } from "./templateStore.js";

// The corpus subject is the SAME keyed hash used for template filenames, not the
// raw username. A leak of the corpus directory listing then discloses no names,
// consistent with the template store. (The video CONTENT is still identifying —
// a face is a face — so this is defence in depth, not the main protection; the
// corpus must still be handled as sensitive under the participants' consent.)
// The hash is deterministic and stable per user, so a subject's sessions still
// group together and the harness forms genuine/impostor pairs unchanged.
const SESSION_RE = /_s(\d+)(?:__[A-Za-z0-9-]+)?\.mp4$/;

function safeCode(code) {
  const c = String(code ?? "").replace(/[^A-Za-z0-9]/g, "");
  return c || "nocode";
}

function nextAutoSession(dir, subject) {
  let maxSession = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.startsWith(`${subject}_s`)) continue;
    const m = SESSION_RE.exec(f);
    if (m && Number(m[1]) > maxSession) maxSession = Number(m[1]);
  }
  return maxSession + 1;
}

/**
 * If EVAL_CAPTURE is on AND the participant consented for this upload, write a
 * plaintext copy of `buffer` into the corpus and return the path written.
 * Otherwise no-op. `code` is the challenge the participant was asked to speak.
 *
 * Consent is required per upload, not just globally: retention changes the
 * privacy guarantee the user was shown, so a recording is only kept when the
 * client passed explicit consent for THAT recording. Enabling EVAL_CAPTURE
 * alone never retains anyone who did not agree.
 *
 * Never throws into the request path: a capture failure must not break
 * registration or login. It logs and returns null instead.
 */
export function captureIfEnabled(buffer, username, consented, code) {
  if (!ENV.EVAL_CAPTURE) return null;
  if (!consented) {
    // Capture is on, but this participant did not agree to retention. Honour the
    // normal privacy guarantee: nothing is written.
    console.warn(`[eval-capture] ${username}: no consent, recording NOT retained`);
    return null;
  }
  try {
    const dir = ENV.EVAL_CORPUS_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const subject = templateId(username);
    const session = ENV.EVAL_SESSION || nextAutoSession(dir, subject);
    const stem = `${subject}_s${session}__${safeCode(code)}`;
    // The same 5-digit challenge twice in one session is unlikely but possible;
    // never overwrite a retained clip.
    let dest = path.join(dir, `${stem}.mp4`);
    for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `${stem}-${n}.mp4`);
    fs.writeFileSync(dest, buffer, { flag: "wx" });
    console.warn(`[eval-capture] wrote plaintext ${dest} (EVAL_CAPTURE is on)`);
    return dest;
  } catch (e) {
    console.error(`[eval-capture] failed for ${username}: ${e.message}`);
    return null;
  }
}
