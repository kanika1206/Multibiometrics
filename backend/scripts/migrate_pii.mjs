// One-off migration: encrypt the account PII that predates piiStore.js.
//
// Accounts created before that module holds email, name, mobile, address and
// avatar in plaintext, and carry no emailIdx, so registration cannot detect a
// duplicate address against them. This script seals each plaintext field and
// backfills the index.
//
// Idempotent: a field that is already sealed is left alone, so re-running it is
// harmless and a partial run can simply be repeated.
//
// Usage:
//   node scripts/migrate_pii.mjs            # dry run: reports, writes nothing
//   node scripts/migrate_pii.mjs --apply    # performs the migration
//
// Run it with the SAME PII_KEY the server will use. Migrating under one key and
// serving under another leaves every record undecryptable — the GCM tag fails
// and getUser returns 500 rather than guessing.

import "dotenv/config";
import connect from "../database/conn.js";
import UserModel from "../model/User.model.js";
import { SEALED_FIELDS, isSealed, seal, emailIndex, open } from "../piiStore.js";

const APPLY = process.argv.includes("--apply");

await connect();

const users = await UserModel.find({});
console.log(`${users.length} account(s) found; mode: ${APPLY ? "APPLY" : "dry run"}`);

let changed = 0;
let already = 0;

for (const user of users) {
  const doc = user.toJSON();
  const update = {};

  for (const field of SEALED_FIELDS) {
    const value = doc[field];
    if (value === undefined || value === null || value === "") continue;
    if (isSealed(value)) continue;
    update[field] = seal(String(value));
  }

  // The index is derived from the address, sealed or not: an account migrated by
  // an earlier partial run has a sealed email but may still lack its index.
  if (!doc.emailIdx) {
    const address = isSealed(doc.email) ? open(doc.email) : doc.email;
    const idx = emailIndex(address);
    if (idx) update.emailIdx = idx;
  }

  const fields = Object.keys(update);
  if (fields.length === 0) {
    already += 1;
    continue;
  }

  // The username is the only value printed: naming the fields is enough to audit
  // the run, and echoing the addresses and phone numbers being protected into a
  // terminal (and a scrollback, and possibly a log) would defeat the point.
  console.log(`  ${doc.username}: ${fields.join(", ")}`);
  if (APPLY) {
    await UserModel.updateOne({ _id: doc._id }, { $set: update });
  }
  changed += 1;
}

console.log(
  `${changed} account(s) ${APPLY ? "migrated" : "would be migrated"}, ` +
    `${already} already sealed.`
);
if (!APPLY && changed > 0) {
  console.log("Re-run with --apply to write these changes.");
}
process.exit(0);
