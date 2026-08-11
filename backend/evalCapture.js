// Optional evaluation-corpus capture (EVAL_CAPTURE).
//
// PRIVACY WARNING. This module deliberately writes PLAINTEXT recordings to disk
// — the exact thing the scheme otherwise avoids. It exists so a consented
// accuracy study can be collected by having participants use the application
// normally, instead of recording videos by hand. It is OFF unless EVAL_CAPTURE
// is set, and it must never be enabled in a real deployment.
//
// When enabled, every uploaded registration and login recording is copied,
// before template extraction and before the usual deletion, into
// ENV.EVAL_CORPUS_DIR under the name the evaluation harness expects:
//
//     <username>_s<session>.mp4
//
// Session numbering is per username: registration is s1, each subsequent login
// is s2, s3, ... so a participant who registers once and logs in at least once
// yields the two DIFFERENT-session recordings the harness needs to form a
// genuine pair. Different usernames are different subjects, i.e. impostor pairs.
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
function corpusName(username, session) {
  return `${templateId(username)}_s${session}.mp4`;
}

/**
 * If EVAL_CAPTURE is on AND the participant consented for this upload, write a
 * plaintext copy of `buffer` into the corpus as the next session for
 * `username`, and return the path written. Otherwise no-op.
 *
 * Consent is required per upload, not just globally: retention changes the
 * privacy guarantee the user was shown, so a recording is only kept when the
 * client passed explicit consent for THAT recording. Enabling EVAL_CAPTURE
 * alone never retains anyone who did not agree.
 *
 * Never throws into the request path: a capture failure must not break
 * registration or login. It logs and returns null instead.
 */
export function captureIfEnabled(buffer, username, consented) {
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

    // Next session = one past the highest existing session for this user.
    // Scan by the hashed subject (what corpusName writes), so numbering stays
    // correct across restarts.
    const prefix = `${templateId(username)}_s`;
    let maxSession = 0;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(prefix) && f.endsWith(".mp4")) {
        const n = parseInt(f.slice(prefix.length, -".mp4".length), 10);
        if (Number.isInteger(n) && n > maxSession) maxSession = n;
      }
    }
    const session = maxSession + 1;
    const dest = path.join(dir, corpusName(username, session));
    fs.writeFileSync(dest, buffer);
    console.warn(`[eval-capture] wrote plaintext ${dest} (EVAL_CAPTURE is on)`);
    return dest;
  } catch (e) {
    console.error(`[eval-capture] failed for ${username}: ${e.message}`);
    return null;
  }
}
