// Sweeps registrations that were never completed.
//
// THE PROBLEM THIS SOLVES. Registration is two requests: /api/register writes
// the account row and mints a 10-minute enrollment token, and /upload-video
// turns the recording into encrypted templates. Only the second request can
// produce something a login can match against, and it takes ~30 seconds
// (InsightFace + ECAPA-TDNN extraction). If it never completes — the tab was
// closed, the page reloaded mid-extraction, the tunnel dropped the upload — the
// account row survives on its own. It can never authenticate (login needs a
// template), it can never enroll (the token expires), and it holds its username
// and e-mail forever. Live logs showed exactly this: three aborted uploads
// (`POST /upload-video - - - -`, no response), three accounts, and every
// subsequent login answered NO_ENROLLMENT.
//
// /upload-video already rolls back an account whose extraction FAILED. What it
// cannot do is roll back a request that never reached it. That is what this
// sweep is for.
//
// WHAT IT WILL AND WILL NOT DELETE. Only accounts that are explicitly marked
// `enrollmentPending`, whose enrollment window has expired, and that hold NO
// template. All three conditions are required:
//
//   - `enrollmentPending` is set only by /api/register and cleared the moment a
//     template is stored, so a completed account is never a candidate.
//   - The grace period exceeds the enrollment token's lifetime, so an enrollment
//     that is still legally possible is never swept out from under the user.
//   - hasTemplate() is checked last and immediately before deletion, so an
//     account that enrolled while the sweep was running is left alone. This is
//     the same invariant registration uses: an account holding a template is
//     never released, because releasing one would be account takeover.
//
// Accounts predating this field (no `enrollmentPending` at all) are NEVER
// touched, however un-enrolled they are. Deleting somebody's account on the
// strength of an assumption about how it came to exist is not a cleanup, and
// legacy strays are handled by scripts/cleanup_unenrolled.mjs, which shows them
// first and deletes only when explicitly told to.

import UserModel from "./model/User.model.js";
import { hasTemplate } from "./templateStore.js";
import { deleteUserKey } from "./keyVault.js";

// The enrollment token lives 10 minutes (enrollToken.js). Sweeping at 15 leaves
// a margin in which a slow-but-legitimate enrollment can still land.
export const ENROLLMENT_GRACE_MS = 15 * 60 * 1000;

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Deletes pending registrations older than the grace period that never enrolled.
 * Resolves with the usernames removed.
 */
export async function sweepUnenrolled({ graceMs = ENROLLMENT_GRACE_MS } = {}) {
  const cutoff = new Date(Date.now() - graceMs);
  const removed = [];
  try {
    const pending = await UserModel.find(
      { enrollmentPending: true },
      { username: 1 }
    ).lean();
    for (const account of pending) {
      // The creation time comes from the ObjectId rather than a timestamp field,
      // so the sweep works on accounts written before this module existed and
      // needs no schema migration.
      const createdAt = account._id.getTimestamp();
      if (createdAt > cutoff) continue;
      // Last line of defence, deliberately re-checked here rather than trusted
      // from the query: only a template-less account is ever deleted.
      if (hasTemplate(account.username)) {
        await UserModel.updateOne(
          { _id: account._id },
          { $set: { enrollmentPending: false, enrolledAt: createdAt } }
        );
        console.log(
          `[janitor] ${account.username} holds a template; marked enrolled instead of swept`
        );
        continue;
      }
      await UserModel.deleteOne({ _id: account._id });
      // A key for an enrollment that never happened must not linger, or it
      // shadows the next enrollment of the same name with stale material.
      try {
        await deleteUserKey(account.username);
      } catch (e) {
        console.error(`[janitor] vault cleanup failed for ${account.username}: ${e.message}`);
      }
      removed.push(account.username);
      console.log(
        `[janitor] released ${account.username}: registration never completed enrollment ` +
          `(created ${createdAt.toISOString()})`
      );
    }
  } catch (e) {
    // Never fatal: a sweep that fails is retried on the next tick.
    console.error(`[janitor] sweep failed: ${e.message}`);
  }
  return removed;
}

/** Runs the sweep at startup and every few minutes thereafter. */
export function startEnrollmentJanitor() {
  sweepUnenrolled();
  const timer = setInterval(sweepUnenrolled, SWEEP_INTERVAL_MS);
  // Do not hold the process open for the sake of a cleanup task.
  timer.unref();
  return timer;
}
