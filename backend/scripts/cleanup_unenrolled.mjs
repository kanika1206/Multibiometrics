// Lists — and, when told to, removes — accounts that hold no biometric template.
//
// Such an account cannot authenticate: login matches against an encrypted
// template, and there is none. It nonetheless occupies its username and e-mail,
// so the owner cannot re-register under the same identifiers... except that
// registration deliberately RELEASES template-less accounts (appController.js),
// so re-registering with the same username and e-mail already works and is the
// normal, self-service remedy. This script is for the operator who would rather
// clear the strays out in one go than wait for each user to try again.
//
// Usage (from backend/):
//   node --env-file=.env scripts/cleanup_unenrolled.mjs           # dry run: list only
//   node --env-file=.env scripts/cleanup_unenrolled.mjs --apply   # delete them
//
// DRY RUN BY DEFAULT, and deliberately so: this deletes user accounts. Nothing
// holding a template is ever a candidate — that check is re-run immediately
// before each deletion.

// Loads backend/.env first (ATLAS_URI, the vault URI, the keys), exactly as
// server.js does, so the script talks to the same databases the server uses.
import "dotenv/config";
import connect from "../database/conn.js";
import UserModel from "../model/User.model.js";
import { hasTemplate, templatePath } from "../templateStore.js";
import { connectVault, deleteUserKey } from "../keyVault.js";

const APPLY = process.argv.includes("--apply");

await connect();
await connectVault();

const users = await UserModel.find({}, { username: 1, enrollmentPending: 1 }).lean();
const stray = users.filter((u) => !hasTemplate(u.username));

console.log(`${users.length} account(s), ${users.length - stray.length} enrolled, ${stray.length} without a template\n`);

if (stray.length === 0) {
  console.log("Nothing to clean up.");
  process.exit(0);
}

console.log("username           created              pending  template path");
for (const u of stray) {
  console.log(
    `${u.username.padEnd(18)} ${u._id.getTimestamp().toISOString()} ${String(!!u.enrollmentPending).padEnd(8)} ${templatePath(u.username)}`
  );
}

if (!APPLY) {
  console.log(
    `\nDry run — nothing deleted. These users can already fix this themselves by ` +
      `registering again with the same username and e-mail.\n` +
      `Re-run with --apply to delete the ${stray.length} account(s) above.`
  );
  process.exit(0);
}

let removed = 0;
for (const u of stray) {
  // Re-checked here, not trusted from the listing above: an account that enrolled
  // while this script was running must survive.
  if (hasTemplate(u.username)) {
    console.log(`  skip ${u.username}: enrolled since the listing was taken`);
    continue;
  }
  await UserModel.deleteOne({ _id: u._id });
  try {
    await deleteUserKey(u.username);
  } catch (e) {
    console.error(`  vault cleanup failed for ${u.username}: ${e.message}`);
  }
  removed++;
  console.log(`  removed ${u.username}`);
}
console.log(`\n${removed} account(s) removed. They are free to register again.`);
process.exit(0);
