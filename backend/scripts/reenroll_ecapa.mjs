// Privileged, server-side re-enrollment to the ECAPA voice template (v2).
//
// The voice template format changed from an MFCC matrix (v1) to a 192-d ECAPA
// speaker embedding (v2). A v1 template cannot be upgraded in place — the audio
// it came from was destroyed under template-only storage — so every pre-ECAPA
// account must be re-enrolled from a fresh recording.
//
// Re-enrollment is deliberately NOT exposed over HTTP: /upload-video requires a
// one-time enrollment token that /api/register only mints for a brand-new
// account (the anti-overwrite fix, docs/enrollment-security.md). Re-enrolling an
// EXISTING account is therefore a privileged operation that runs here, on the
// server, with filesystem access — the same trust level as the migration script.
//
// Usage (from backend/):
//   node --env-file=.env scripts/reenroll_ecapa.mjs <video.mp4> <username> [<username> ...]
//
// Each named account's templates/<username>.tmpl.enc is overwritten with a v2
// template extracted from <video.mp4>. Back up the old templates first if needed.

import fs from "fs";
import { enrollFromBuffer, templatePath } from "../templateStore.js";

const args = process.argv.slice(2);
// --allow-shared-recording enrolls ONE recording into SEVERAL accounts. That is
// almost never what you want: the accounts then hold identical templates and can
// authenticate as one another, which is an impersonation path, not a test
// fixture. It happened once already (four accounts, one video) and silently
// invalidated the evaluation corpus. Multi-username runs now require the
// operator to say so explicitly.
const allowShared = args.includes("--allow-shared-recording");
const [videoPath, ...usernames] = args.filter((a) => a !== "--allow-shared-recording");

if (!videoPath || usernames.length === 0) {
  console.error(
    "usage: reenroll_ecapa.mjs <video.mp4> <username> [<username> ...] [--allow-shared-recording]"
  );
  process.exit(2);
}

if (usernames.length > 1 && !allowShared) {
  console.error(
    `refusing to enroll one recording into ${usernames.length} accounts ` +
      `(${usernames.join(", ")}).\n` +
      "Each account must be enrolled from its OWN recording, or those accounts will\n" +
      "hold identical biometric templates and will authenticate as one another.\n" +
      "Re-run once per account with its own video, or pass --allow-shared-recording\n" +
      "if you genuinely intend to create duplicate enrollments."
  );
  process.exit(2);
}
if (!fs.existsSync(videoPath)) {
  console.error(`source video not found: ${videoPath}`);
  process.exit(2);
}

const buffer = fs.readFileSync(videoPath);
let ok = 0;
let bad = 0;

for (const username of usernames) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(username)) {
    console.error(`  ${username}: invalid username, skipped`);
    bad++;
    continue;
  }
  try {
    const { ok: enrolled, reason } = await enrollFromBuffer(buffer, username);
    if (enrolled) {
      console.log(`  ${username}: re-enrolled -> ${templatePath(username)}`);
      ok++;
    } else {
      console.error(`  ${username}: FAILED (${reason})`);
      bad++;
    }
  } catch (e) {
    console.error(`  ${username}: ERROR ${e.message}`);
    bad++;
  }
}

console.log(`\nre-enrolled ${ok}, failed ${bad}`);
process.exit(bad === 0 ? 0 : 1);
