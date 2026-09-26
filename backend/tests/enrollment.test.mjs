// Tests for the un-enrolled registration sweep (enrollmentJanitor.js).
//
// The defect these cover: registration writes the account row first and enrolls
// the biometric templates in a second request, so an enrollment that never
// arrives used to leave an account that can never log in ("NO_ENROLLMENT")
// while occupying its username forever.
//
// Run from backend/:  npm test
// Uses a THROWAWAY application database, dropped on teardown.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import mongoose from "mongoose";

process.env.BIOMETRIC_VAULT_URI =
  process.env.BIOMETRIC_VAULT_URI_TEST ||
  "mongodb://localhost:27017/biometric_key_vault_test";
const APP_URI =
  process.env.ATLAS_URI_TEST || "mongodb://localhost:27017/multibio_enrollment_test";

const UserModel = (await import("../model/User.model.js")).default;
const { templatePath } = await import("../templateStore.js");
const { sweepUnenrolled, ENROLLMENT_GRACE_MS } = await import("../enrollmentJanitor.js");

// An ObjectId whose embedded timestamp is `msAgo` milliseconds in the past, so a
// stale registration can be simulated without waiting for one.
function idAgedBy(msAgo) {
  const seconds = Math.floor((Date.now() - msAgo) / 1000);
  // createFromTime zero-fills everything after the timestamp, so two accounts of
  // the same age would collide on _id. Keep the timestamp, randomise the rest.
  const random = mongoose.Types.ObjectId.generate().toString("hex").slice(8);
  return new mongoose.Types.ObjectId(seconds.toString(16).padStart(8, "0") + random);
}

const makeAccount = (username, { pending, ageMs }) =>
  UserModel.create({
    _id: idAgedBy(ageMs),
    username,
    emailIdx: `idx-${username}`,
    email: "sealed",
    ...(pending === undefined ? {} : { enrollmentPending: pending }),
  });

before(async () => {
  await mongoose.connect(APP_URI);
  await UserModel.deleteMany({});
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("a pending registration past its enrollment window is released", async () => {
  await makeAccount("stale_pending", { pending: true, ageMs: ENROLLMENT_GRACE_MS + 60_000 });
  const removed = await sweepUnenrolled();
  assert.deepEqual(removed, ["stale_pending"]);
  assert.equal(await UserModel.findOne({ username: "stale_pending" }), null);
});

test("a pending registration still inside its window is left alone", async () => {
  await makeAccount("fresh_pending", { pending: true, ageMs: 60_000 });
  const removed = await sweepUnenrolled();
  assert.equal(removed.includes("fresh_pending"), false);
  assert.ok(await UserModel.findOne({ username: "fresh_pending" }));
  await UserModel.deleteMany({ username: "fresh_pending" });
});

test("an account that enrolled is never deleted, only un-flagged", async () => {
  // A stale pending flag plus a stored template: the flag lost a race, and the
  // account is complete. Deleting it would be account loss.
  await makeAccount("enrolled_but_flagged", { pending: true, ageMs: ENROLLMENT_GRACE_MS + 60_000 });
  const path = templatePath("enrolled_but_flagged");
  fs.mkdirSync("./templates", { recursive: true });
  fs.writeFileSync(path, "not a real template");
  try {
    const removed = await sweepUnenrolled();
    assert.equal(removed.includes("enrolled_but_flagged"), false);
    const account = await UserModel.findOne({ username: "enrolled_but_flagged" });
    assert.ok(account, "an enrolled account must survive the sweep");
    assert.equal(account.enrollmentPending, false);
    assert.ok(account.enrolledAt instanceof Date);
  } finally {
    fs.rmSync(path, { force: true });
    await UserModel.deleteMany({ username: "enrolled_but_flagged" });
  }
});

test("accounts predating the pending flag are never swept", async () => {
  // No enrollmentPending field at all, no template, arbitrarily old: exactly the
  // legacy strays already in the live database. They are reported by
  // scripts/cleanup_unenrolled.mjs, never deleted behind the operator's back.
  await makeAccount("legacy_account", { pending: undefined, ageMs: 400 * 24 * 3600_000 });
  const removed = await sweepUnenrolled();
  assert.equal(removed.includes("legacy_account"), false);
  assert.ok(await UserModel.findOne({ username: "legacy_account" }));
});

test("a confirmed account is not a candidate at all", async () => {
  await makeAccount("confirmed", { pending: false, ageMs: 400 * 24 * 3600_000 });
  const removed = await sweepUnenrolled();
  assert.equal(removed.includes("confirmed"), false);
  assert.ok(await UserModel.findOne({ username: "confirmed" }));
});
