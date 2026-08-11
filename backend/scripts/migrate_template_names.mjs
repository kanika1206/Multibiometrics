// One-shot: rename username-named templates to keyed-hash names (privacy fix).
//
// Before: templates/<username>.tmpl.enc  — filename discloses the enrolled user.
// After:  templates/<hmac-hex>.tmpl.enc  — filename reveals nothing without the key.
//
// Idempotent: files already at their hashed name are left alone. Encrypted
// content is untouched — only the filename changes. Run once, from backend/:
//   node --env-file=.env scripts/migrate_template_names.mjs
//
// A file whose stem is not a valid username (e.g. already-hashed) is skipped.

import fs from "fs";
import path from "path";
import { TEMPLATE_DIR, templateId } from "../templateStore.js";

const USERNAME = /^[A-Za-z0-9_-]{1,64}$/;

if (!fs.existsSync(TEMPLATE_DIR)) {
  console.error(`no template dir at ${TEMPLATE_DIR}`);
  process.exit(1);
}

let renamed = 0;
let skipped = 0;
for (const f of fs.readdirSync(TEMPLATE_DIR)) {
  if (!f.endsWith(".tmpl.enc")) continue;
  const stem = f.slice(0, -".tmpl.enc".length);

  // Already a 64-char hex hash → nothing to do.
  if (/^[0-9a-f]{64}$/.test(stem)) {
    skipped++;
    continue;
  }
  if (!USERNAME.test(stem)) {
    console.warn(`  skip (not a username): ${f}`);
    skipped++;
    continue;
  }

  const dest = templateId(stem) + ".tmpl.enc";
  if (dest === f) {
    skipped++;
    continue;
  }
  fs.renameSync(path.join(TEMPLATE_DIR, f), path.join(TEMPLATE_DIR, dest));
  console.log(`  ${f} -> ${dest}`);
  renamed++;
}

console.log(`\nrenamed ${renamed}, skipped ${skipped}`);
