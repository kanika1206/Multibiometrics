// Cross-origin policy for the API.
//
// The server used to run `app.use(cors())`, which answers every origin with
// Access-Control-Allow-Origin: *. That lets script on ANY web page call the API
// and read the responses, which is exactly what a real-time relay phishing page
// needs: fetch the victim's live CAPTCHA (GET /captcha), show it to the victim,
// upload the victim's recording (POST /upload-video-login) and complete
// /api/login -- all from the attacker's origin, inside the 5-minute window.
//
// Two layers, because CORS headers alone are not enough:
//   1. The `cors` middleware only emits CORS headers for listed origins, so a
//      browser on any other origin cannot read a response and its preflighted
//      requests (JSON bodies, Authorization headers) are refused.
//   2. Some requests are "simple" and are never preflighted -- a GET, or a
//      multipart/form-data POST such as the video uploads. The browser SENDS
//      those and only hides the response, so the handler would still run. Any
//      request carrying an Origin header that is not listed is therefore
//      rejected with 403 before it reaches a route.
// Requests with no Origin header (curl, server-to-server, same-origin GETs) are
// unaffected: this is a browser-side control, not authentication.
//
// Scope, stated plainly: this stops a phishing PAGE from driving the API from
// the victim's browser. It does not stop a relay that proxies traffic through
// its own server (no Origin header there); that remains out of the threat model.
//
// Configuration: CORS_ORIGINS, a comma-separated list of exact origins
// (scheme://host[:port], no path), e.g.
//   CORS_ORIGINS=https://app.example.com,https://staging.example.com
// Unset: development allows the local dev servers only; production allows no
// cross-origin browser access at all (fail closed) and says so at startup.
import cors from "cors";

// The CRA dev server (3000) and the `npx serve -s build -l 3999` preview.
export const DEV_ORIGINS = Object.freeze([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3999",
  "http://127.0.0.1:3999",
]);

/**
 * Parse a CORS_ORIGINS value into a list of exact origins.
 * Throws on an entry that is not a bare origin, so a typo stops the server at
 * startup instead of silently locking the frontend out (or letting "*" in).
 */
export function parseOrigins(value) {
  const out = [];
  for (const raw of String(value).split(",")) {
    const entry = raw.trim().replace(/\/+$/, "");
    if (!entry) continue;
    let origin;
    try {
      origin = new URL(entry).origin;
    } catch {
      origin = null;
    }
    // WHATWG URL accepts "*" as a literal host character, so "https://*.x.com"
    // would parse -- and then match nothing, while looking like a wildcard.
    if (!origin || origin === "null" || origin !== entry || entry.includes("*")) {
      throw new Error(
        `CORS_ORIGINS entry "${raw.trim()}" is not an origin: use scheme://host[:port] ` +
          `with no path, and no wildcard`
      );
    }
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

/** The allowed origins for this environment. */
export function allowedOrigins(env = process.env, isProduction = env.NODE_ENV === "production") {
  if (env.CORS_ORIGINS !== undefined && env.CORS_ORIGINS.trim() !== "") {
    return parseOrigins(env.CORS_ORIGINS);
  }
  return isProduction ? [] : [...DEV_ORIGINS];
}

/** 403 for any request whose Origin header is present but not allowed. */
export function rejectForeignOrigin(origins) {
  const allowed = new Set(origins);
  return function (req, res, next) {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowed.has(origin)) {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    next();
  };
}

/** The middleware pair to mount before any route: reject, then emit CORS headers. */
export function corsPolicy(origins) {
  return [rejectForeignOrigin(origins), cors({ origin: [...origins] })];
}
