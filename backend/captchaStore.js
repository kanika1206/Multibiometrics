// Server-side store for issued login CAPTCHAs.
//
// The paper's third factor requires the server to know what CAPTCHA it issued
// so the spoken transcript can be verified against it. The original code sent
// the CAPTCHA text to the client in plaintext and never stored it — the
// comparison was impossible and the factor was decorative.
//
// Single-use, per-username, with a TTL: the user must record and submit the
// login video within the window, and a CAPTCHA cannot be replayed.

const TTL_MS = 5 * 60 * 1000;

const store = new Map(); // username -> { text, expires }

export function issueCaptcha(username, text) {
  store.set(username, { text, expires: Date.now() + TTL_MS });
}

/** Returns the CAPTCHA text for this user and consumes it, or null if none/expired. */
export function takeCaptcha(username) {
  const entry = store.get(username);
  if (entry) store.delete(username);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.text;
}

// Speech-to-text sometimes returns spoken digits as words ("nine four two").
// Map them to numerals before comparing. "oh" is how people say 0 aloud.
const DIGIT_WORDS = {
  zero: "0", oh: "0", one: "1", won: "1", two: "2", to: "2", too: "2",
  three: "3", four: "4", for: "4", five: "5", six: "6", seven: "7",
  eight: "8", ate: "8", nine: "9",
};

/** Normalization for spoken-CAPTCHA comparison: case- and separator-insensitive,
 * with spoken digit words mapped to numerals. */
export function normalizeCaptcha(s) {
  return String(s)
    .toLowerCase()
    .replace(/[a-z]+/g, (w) => DIGIT_WORDS[w] ?? w)
    .replace(/[^a-z0-9]/g, "");
}
