// Enrollment authorization (fixes the enrollment-overwrite vulnerability).
//
// /upload-video used to take the enrolled identity from the uploaded FILENAME,
// with no authentication at all: anyone could POST a video called `victim.mp4`
// and replace templates/victim.tmpl.enc with their own face and voice, then log
// in as the victim. A filename is client-controlled data, not a credential.
//
// The identity now comes from a short-lived, server-signed enrollment token.
// One is issued by /api/register, at the moment the account is created; because
// /api/register refuses duplicate usernames, no such token can ever be minted
// for an account that already exists, so an existing enrollment cannot be
// overwritten by anyone. The filename is still pattern-validated but is no
// longer trusted for identity.
//
// The one authorized way to replace an existing enrollment is a `reenroll`
// grant, issued by /api/reenroll-request only after a complete three-factor
// login — i.e. only to someone whose face, voice and spoken challenge already
// match the template being replaced. See the purposes below.

import jwt from "jsonwebtoken";
import ENV from "./config.js";

// Long enough to re-record and retry a failed upload, short enough that a leaked
// token is not a standing licence to re-enroll the account.
const ENROLL_TTL = "10m";

// The two grants a template write can be made under. They are deliberately
// distinct values rather than one "may write a template" permission:
//
//   enroll    minted once, by /api/register, for an account that holds no
//             template. Authorizes the FIRST enrolment only.
//   reenroll  minted by /api/reenroll-request, and only after a complete,
//             successful three-factor login. Authorizes REPLACING the template
//             of the account that just proved it owns it.
//
// /upload-video checks the purpose against the account's state, so an `enroll`
// grant can never overwrite an enrolment and a `reenroll` grant can never be
// obtained without passing the biometrics it is about to replace.
export const ENROLL_PURPOSE = "enroll";
export const REENROLL_PURPOSE = "reenroll";
const PURPOSES = [ENROLL_PURPOSE, REENROLL_PURPOSE];

/**
 * Mints a template-write grant. `purpose` is a parameter, not a constant, so
 * re-enrolment can be authorized with the same short TTL and the same
 * verification path as first enrolment — one token format, one check.
 */
export function issueEnrollToken(username, purpose = ENROLL_PURPOSE) {
  if (!PURPOSES.includes(purpose)) {
    throw new Error(`unknown enrollment token purpose: ${purpose}`);
  }
  return jwt.sign({ username, purpose }, ENV.JWT_SECRET, {
    expiresIn: ENROLL_TTL,
  });
}

/**
 * Returns { username, purpose } for the grant this request carries, or null.
 * A login/session JWT is deliberately NOT accepted: `purpose` must be one of
 * the template-write grants above, so a stolen session token cannot re-enroll
 * (and thus re-key) an account — re-enrolment needs its own token, and that
 * token is only issued after the three factors have actually been verified.
 */
export function enrollGrantFrom(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    const claims = jwt.verify(token, ENV.JWT_SECRET);
    if (!PURPOSES.includes(claims.purpose)) return null;
    if (typeof claims.username !== "string") return null;
    // The username becomes a template path component.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(claims.username)) return null;
    return { username: claims.username, purpose: claims.purpose };
  } catch {
    return null;
  }
}

/** The username this request is authorized to write a template for, or null. */
export function enrollUsernameFrom(req) {
  return enrollGrantFrom(req)?.username ?? null;
}
