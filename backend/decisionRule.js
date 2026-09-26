// The authentication decision rule, in one place.
//
// This is equation (5) of the paper: the three factor verdicts are combined
// conjunctively, so access is granted only when the face, the speaker, and the
// spoken challenge all verify.
//
//   D = b_f AND b_a AND b_c
//
// It lives in its own module because two callers must agree on it exactly: the
// login controller, and the attack harness that reports attack success rates.
// If those two ever disagreed, the reported success rates would describe a
// system nobody deployed.

/**
 * The conjunctive fusion of the three factor verdicts.
 *
 * Undefined is treated as false: a factor whose verdict was never computed has
 * not verified, so it cannot contribute to a grant. Failing closed here means a
 * branch that throws before setting its verdict denies rather than grants.
 */
export function fuse({ faceOk, voiceOk, captchaOk }) {
  return faceOk === true && voiceOk === true && captchaOk === true;
}

/** Name of the rule, for results files that must record how they were scored. */
export const FUSION_RULE = "conjunctive (AND) over face, speaker, and challenge";
