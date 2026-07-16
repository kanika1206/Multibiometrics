// Enrollment authorization (fixes the enrollment-overwrite vulnerability).
//
// /upload-video used to take the enrolled identity from the uploaded FILENAME,
// with no authentication at all: anyone could POST a video called `victim.mp4`
// and replace templates/victim.tmpl.enc with their own face and voice, then log
// in as the victim. A filename is client-controlled data, not a credential.
//
// The identity now comes from a short-lived, server-signed enrollment token that
// is issued exactly once — by /api/register, at the moment the account is
// created. Because /api/register refuses duplicate usernames, no token can ever
// be minted for an account that already exists, so an existing enrollment cannot
// be overwritten by anyone. The filename is still pattern-validated but is no
// longer trusted for identity.

import jwt from "jsonwebtoken";
import ENV from "./config.js";

// Long enough to re-record and retry a failed upload, short enough that a leaked
// token is not a standing licence to re-enroll the account.
const ENROLL_TTL = "10m";

export function issueEnrollToken(username) {
  return jwt.sign({ username, purpose: "enroll" }, ENV.JWT_SECRET, {
    expiresIn: ENROLL_TTL,
  });
}

/**
 * Returns the username this request is authorized to enroll, or null.
 * A login/session JWT is deliberately NOT accepted: `purpose` must be "enroll",
 * so a stolen session token cannot re-enroll (and thus re-key) an account.
 */
export function enrollUsernameFrom(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    const claims = jwt.verify(token, ENV.JWT_SECRET);
    if (claims.purpose !== "enroll") return null;
    if (typeof claims.username !== "string") return null;
    // The username becomes a template path component.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(claims.username)) return null;
    return claims.username;
  } catch {
    return null;
  }
}
