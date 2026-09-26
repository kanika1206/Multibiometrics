# Threat model

This is the formal statement of what the system defends against, what it does
not, and what each defence actually rests on. Every quantity here is read off
the implementation, and the file names the line it comes from so a claim can be
checked rather than believed.

It is also the source text for the paper's threat-model section: keep the two in
step, and change this file first.

## 1. Assets

| Asset | Where it lives | Protection |
|---|---|---|
| Biometric template (12x512-d face frames, 512-d mean face, 192-d speaker embedding) | `backend/templates/<H_kbio(u)>.tmpl.enc` | AES-256-GCM under a per-user key |
| Per-user template key `k_u` | separate key-vault database | wrapped under a server-side master key |
| Account record and PII | account database | sealed (`piiStore.js`), email indexed by keyed hash |
| Live challenge `C` | server memory (`captchaStore.js`) | never sent to the client; single use; 5-minute TTL |
| Transient login recording | encrypted temporary storage | deleted when the attempt resolves |
| Raw enrolment recording | nowhere | destroyed after template extraction |

Face and voice are **observable traits, not secrets**. Anyone who has met the
user, or found them in a video, holds a sample. The system is designed on that
assumption: no security property depends on an adversary lacking the victim's
face or voice.

## 2. Adversaries

### A1 — holds recordings of the victim

*Capability.* Archived video and audio of the victim from public sources or
from previous sessions, in any quantity. Can submit arbitrary media to the login
endpoint. Cannot produce a real-time response to an unpredictable prompt.

*What happens.* The face and speaker factors accept: the recording genuinely is
the victim. The challenge factor rejects, because the archived recording speaks
a code issued in some earlier session, and the code issued now is fresh and
independent of it. Under the conjunctive rule the attempt is denied.

*What it rests on.* Challenge freshness and single use — not on biometric
secrecy, and not on any liveness or anti-spoofing detector, of which the system
has none. Section 3 gives the numbers.

*Measured.* `attack_suite.mjs --attacks replay,photo` reports this adversary's
success rate directly; the `replay` and `photo_archived_audio` rows are A1.

### A2 — steals the template database

*Capability.* Read access to `backend/templates/`, i.e. every stored ciphertext,
and to the account database. No access to the key vault.

*What happens.* The templates are AES-256-GCM ciphertexts under per-user keys
that are not present in the stolen material. The stored filename is
`H_kbio(username)`, a keyed hash, so the dump does not even say whose template
is whose without the index key. The adversary gains ciphertext and nothing else.

*What it rests on.* Storage separation — the template store and the key vault
are different databases with different credentials — and the keys being per
user, so there is no single key whose compromise unlocks the set.

*Residual risk.* This is confidentiality only. An adversary who can *write* to
the template store can deny service, or substitute a template it does hold the
key for, if it also holds the matching vault entry. Template integrity is
protected by the GCM tag, so a modified ciphertext fails to authenticate and the
login is refused rather than evaluated.

### A3 — steals the key vault

*Capability.* Read access to the key-vault database: every wrapped per-user key
and the keyed pseudonymous index. No access to the template store, and no access
to the server-side master key.

*What happens.* Each vault row is a wrapped key, useless without the master key,
and useless anyway without the matching ciphertext from the other database.
Recovering a template requires **both** stores **and** the master key.

*What it rests on.* The master key being held outside the vault database
(process environment or a secrets manager), and `config.js` refusing to start a
production server whose `BIOMETRIC_MASTER_KEY`, `BIOMETRIC_INDEX_KEY`,
`BIOMETRIC_KEY` and `JWT_SECRET` are missing, weak, or shared with each other.

*Residual risk.* Compromise of the master key *and* both databases exposes every
template. There is no automated key rotation: replacing a storage key today
requires a controlled migration, which is an operational limitation and is
stated as such.

### A4 — controls the network

*Capability.* Observes and modifies traffic between client and server. Can
phish, relay, and replay.

*What happens.* Transport security is assumed (TLS terminated at the server);
without it every factor is readable and this model does not apply. Given TLS:
the challenge text is never sent to the client — only a rendered image is — so
observing the response does not reveal the expected value for a later attempt.
The challenge is consumed on retrieval regardless of outcome, so a captured
upload cannot be resubmitted. The decision is server-side, so a modified client
cannot assert a verdict; the server never trusts a client-supplied filename or
identity for enrolment binding.

*Out of scope.* A **real-time relay** — presenting the live challenge to the
victim and returning their response inside the validity window — defeats the
challenge factor by construction, because the response genuinely is fresh and
genuinely is the victim. Nothing in this design stops it. It is named as out of
scope rather than defended against.

### Trust assumptions

The verifier, challenge generator, account store, template store and key vault
execute the specified protocol and protect their server-side secrets. The
challenge generator is unpredictable. Verifier compromise, simultaneous
compromise of both stores and the master key, coercion of the enrolled user, and
operator abuse are all out of scope.

## 3. Why replay fails, quantitatively

The challenge is generated by `server.js:68`:

```js
svgCaptcha.create({ charPreset: "0123456789", size: 5, noise: 2 })
```

Five symbols over a ten-symbol alphabet:

- **Challenge space:** 10^5 = **100,000** values (about 16.6 bits).
- **Probability a replayed recording satisfies the challenge:** an archived
  recording carries a code chosen independently of the one issued now, so it
  matches with probability **1/100,000 = 10^-5** per attempt.
- **Lifetime:** 5 minutes (`captchaStore.js:11`), and **single use** —
  `takeCaptcha` deletes the entry on retrieval whether the attempt succeeds or
  fails (`captchaStore.js:37-42`). There is therefore **one** guess per issued
  challenge, not as many as fit into five minutes. The window bounds how long a
  guess remains submittable; it does not bound how many guesses a challenge
  admits.
- **Guessing across many challenges:** an adversary who requests *n* fresh
  challenges and gambles once on each passes the challenge factor with
  probability 1 - (1 - 10^-5)^n — about 10^-3 at n = 100 and about 10^-2 at
  n = 1000 — and still has to pass the face and speaker factors on the same
  attempt.

This is the whole of the replay argument. It is not a liveness claim: the system
has no presentation-attack detector, and a still photograph passes the face
factor (Section 5, row 2). The challenge is what stops archived media, and 10^-5
is what the challenge is worth.

**Entropy is the obvious lever.** Lengthening the code or widening the alphabet
raises that bound at a direct usability cost, since the user must read it aloud
and a recogniser must transcribe it — and the challenge factor's own false
rejection is already the deployment's dominant failure mode. That trade-off is
real and should be reported, not hidden.

## 4. Template inversion

The stored template is not a raw face or a raw recording, but it is also **not a
cancelable template**, and the paper must not imply otherwise.

- What is stored is a set of deep embeddings: twelve 512-d ArcFace frame
  embeddings, their normalized mean, and one 192-d ECAPA-TDNN speaker embedding.
- Embeddings of this kind are **invertible to a useful degree**. Reconstruction
  attacks recover from an embedding alone a face image recognisable to both
  humans and matchers, and the template-protection literature treats an
  unprotected deep embedding as sensitive data rather than as a one-way digest.
  The same holds for speaker embeddings.
- The protection here is therefore **encryption, not irreversibility**. An
  adversary holding the plaintext embedding can attempt inversion; the design's
  answer is that obtaining the plaintext requires both stores and the master key
  (A2, A3).
- A genuine cancelable-biometric or deep-hashing scheme would give a *revocable*
  and *unlinkable* template, so a compromised template could be reissued without
  re-enrolling the user, and two enrolments of the same person across systems
  could not be linked. This system provides unlinkability only at the level of
  *naming* — templates are stored under a keyed pseudonym — not at the level of
  the representation. Revocation today means deleting the account and enrolling
  again.

This is the honest position and it should be stated plainly: encrypted
embeddings raise the bar for A2 and A3; they do not make the template
non-invertible, and they are not cancelable templates.

## 5. Attack / defence / result

The result column is filled from `attack_suite.mjs` output (`attacks.json`);
rows marked *analytic* are argued rather than sampled, because the event is too
rare to observe in a feasible number of trials.

| # | Attack | Defence that applies | Expected result |
|---|---|---|---|
| 1 | Replay an archived login recording | Fresh, single-use challenge | Denied; challenge factor fails. Coincidental success 10^-5 per attempt (*analytic*) |
| 2 | Photograph or screen held to the camera, attacker speaks the challenge | Speaker factor | **Face factor accepts** — there is no PAD. Denied by the speaker factor |
| 3 | Photograph plus the victim's archived audio | Fresh challenge | Denied; the archived audio answers an old challenge |
| 4 | Victim's face spliced with the attacker's live voice | Speaker factor | Denied by the speaker factor |
| 5 | Attacker's face with the victim's archived voice | Face factor | Denied by the face factor |
| 6 | Cloned voice answering the live challenge, on the victim's video | Speaker factor only | **Measured** — the attack most likely to succeed; the number is reported as found |
| 7 | Face-swapped video with a live spoken answer | Face factor only | **Measured** |
| 8 | Steal the template database | Per-user AES-256-GCM, keys held elsewhere | Ciphertext only |
| 9 | Steal the key vault | Master-key wrapping, separate database | Wrapped keys only; no ciphertext to use them on |
| 10 | Steal both stores and the master key | — | Templates recovered; inversion then plausible (Section 4) |
| 11 | Tamper with a stored template | GCM authentication tag | Authentication fails; login refused |
| 12 | Overwrite an enrolled template via registration | Purpose-bound `enroll` grant; Algorithm 1 rejects an existing template | Rejected |
| 13 | Replace a template without authenticating | `reenroll` grant issued only after three-factor success | Rejected |
| 14 | Real-time relay of the live challenge to the victim | — | **Out of scope; succeeds** |
| 15 | Real-time responsive deepfake of face and voice | — | **Out of scope; not evaluated** |

Rows 14 and 15 are the honest limits of the design. The conjunctive rule and the
fresh challenge defeat *archived* media; they do not defeat an adversary who can
produce a correct response *now*.

## 6. What this model does not claim

- No liveness detection and no presentation-attack detection of any kind.
- No protection against a real-time relay or a real-time responsive deepfake.
- No cancelable or revocable biometric template (Section 4).
- No automated key rotation.
- No defence against a compromised verifier, or against an operator holding both
  stores and the master key.
