# Report Section: Implementation and Working

**Companion to `REPORT1.md`.** That report records *what* was changed and *why*. This
section records *how the deployed system actually works*, mechanism by mechanism, and
includes the work carried out after REPORT1 was written (account-PII protection,
registration atomicity, key management, and the paper–code alignment pass).

Every chapter follows the same shape: what the mechanism is for, how it works at
runtime, where it lives in the tree, and what evidence supports the claims made about
it. Where something is unproven or known to be incomplete, it is stated as such rather
than omitted — Chapter 16 collects those in one place.

---

## Table of contents

| Ch. | Subject |
|----|---|
| 1 | How to read this section |
| 2 | Runtime architecture |
| 3 | Registration and enrolment |
| 4 | Login and challenge issuance |
| 5 | Concurrent authentication |
| 6 | Face verification |
| 7 | Speaker verification |
| 8 | Spoken-challenge verification |
| 9 | Decision-level fusion |
| 10 | Biometric template storage |
| 11 | Account PII protection |
| 12 | Key management |
| 13 | Registration atomicity |
| 14 | Evaluation harness |
| 15 | Paper–code alignment |
| 16 | Known limitations |

---

## Chapter 1 — How to read this section

Three conventions are used throughout.

**Claims are separated from evidence.** A statement about behaviour is followed by how
that behaviour was observed — a measurement, a run against the live server, or a file
reference. Where a mechanism has been reasoned about but not exercised, it says so.

**No completion figures are given.** The system is described by what it does, not by a
percentage of some notional total.

**The code is the reference.** Where this document and the paper differ in emphasis,
the code decides. Chapter 15 describes the pass that brought the paper into line with
it, and Chapter 16 lists the places where a gap remains.

The paper's original algorithms are preserved separately in `backend/paper_reference/`
and are not wired into the running system.

---

## Chapter 2 — Runtime architecture

The system is a three-tier application in which every security decision is taken on the
server.

**Presentation tier.** A React single-page client (`frontend/`). It captures video,
renders the challenge image the server sends, and uploads recordings. It takes no
authentication decision and never receives a per-factor result.

**Application tier.** An Express server on Node.js (`backend/server.js`,
`backend/controllers/appController.js`). It generates challenges, orchestrates
extraction and matching, evaluates the fusion rule, and issues tokens.

**Processing components.** Five Python scripts invoked as subprocesses, each doing one
job and signalling its result through its **exit code** rather than its output:

| Script | Job |
|---|---|
| `extractTemplate.py` | recording → face + speaker template |
| `matchFaceTemplate.py` | face verdict |
| `matchVoiceTemplate.py` | speaker verdict |
| `extractAudio_login.py` | demultiplex login audio |
| `speechToTexty.py` | transcribe login audio |

Exit codes are used deliberately: the vision libraries print banners to stdout
(InsightFace announces its execution providers), so scraping stdout for a verdict is
unsafe. `runPy` in `appController.js` captures stdout for *data* only — the transcript —
and gates purely on the exit code.

**Persistence.** Two stores that are deliberately decoupled:

- **Account database** (MongoDB) — holds identifiers and contact fields. Contains no
  template and no template file name.
- **Template store** (`backend/templates/`) — holds encrypted biometric templates under
  keyed-hash file names. Contains no plaintext identifier.

Neither store alone yields both an identity and its biometrics.

---

## Chapter 3 — Registration and enrolment

Registration spans **two requests**, which is what makes the atomicity work of
Chapter 13 necessary.

**Request 1 — `POST /api/register`.**

1. The identifier is validated against `/^[A-Za-z0-9_-]{1,64}$/`. It becomes a
   filesystem path component and a subprocess argument, so it is constrained at the
   point of creation rather than at the point of use.
2. The email address is required to be non-empty and is reduced to a keyed index
   (Chapter 11). Duplicate detection runs against that index, never against a stored
   address.
3. If either the identifier or the address is held by an account that **already holds a
   template**, the request is rejected. If held by an account with **no** template, that
   account is released (Chapter 13).
4. The account record is written with the identifier readable and every contact field
   sealed.
5. A signed enrolment token is returned, carrying `{username, purpose: "enroll"}` and
   valid for **10 minutes** (`backend/enrollToken.js`).

**Request 2 — `POST /upload-video`.**

1. The token is verified. `purpose` must be `enroll`, so a stolen *session* token cannot
   re-key an account.
2. **The enrolled identity comes from the verified token, never from the uploaded
   filename.** The filename is pattern-checked for shape only. This closes the original
   takeover path, in which any unauthenticated client could upload `victim.mp4` and
   replace that user's stored biometrics.
3. The account must still exist, and must not already hold a template. The second check
   is the one that matters: a stored template is never replaced, whoever presents a
   valid token.
4. The recording is written to a private temporary directory and reduced to a template.
5. The template is encrypted and stored under its pseudonymous name; the working
   directory — and with it the recording and the plaintext template — is destroyed in a
   `finally` block, so it goes away on the failure path too.

The challenge shown during registration is generated **on the client** and is never
verified. Its only job is to make the user speak naturally so that a usable voice
template can be derived. It is not an authentication factor. The challenge becomes a
factor only at login.

*Evidence.* Exercised against the live server: registration returns a token; uploading
an unusable recording returns 400 and rolls the account back; re-using the token
afterwards returns 409; uploading onto an already-enrolled account returns 409.

---

## Chapter 4 — Login and challenge issuance

**`GET /captcha?username=…`** generates a five-digit challenge (`svg-captcha`,
`charPreset: "0123456789"`, `size: 5`, `noise: 2`), stores it server-side against the
identifier with a **five-minute** expiry, and returns **only the rendered image**.

The text never reaches the client. This is the correction of a substantive flaw in the
original code: the challenge text was sent to the client in plaintext and never retained
server-side, so no comparison was possible and the third factor was decorative.

The digit-only alphabet is a consequence of the recognition stage, not a security
choice. Arbitrary letter strings transcribed unreliably; digit sequences transcribe
dependably. The reduced entropy is acceptable only because the challenge is conjoined
with two biometric factors and guessing it confers nothing on its own.

**`POST /upload-video-login`** accepts the recording. This endpoint cannot require a
session token — logging in is precisely what the caller has not done yet. It is instead
bound to a live attempt: a challenge must have been issued for that identifier and must
not have expired (`hasLiveCaptcha`). Without this, any client could overwrite the
recording a victim was about to submit. The identifier is taken from the uploaded
filename here, since no credential exists yet to carry it.

The challenge is *checked* at upload but not consumed; `/api/login` spends it.

---

## Chapter 5 — Concurrent authentication

The original design was a cascade: face, then voice, then challenge, each gated on the
previous one. The deployed system evaluates all three concurrently and combines them at
the end.

`login()` in `appController.js`:

1. Look up the account; validate the identifier.
2. **Consume the challenge up front** via `takeCaptcha` — single-use, whether or not the
   attempt succeeds. No issued challenge, or an expired one, means the third factor
   cannot pass.
3. Decrypt the enrolled template and the uploaded recording into a private working
   directory. A missing or tampered artefact throws on the GCM tag and the attempt is
   rejected — fail closed.
4. Run two branches concurrently:
   - **Biometric branch** — reduce the recording to a login template once, then score
     face and voice against the stored template in parallel.
   - **Challenge branch** — demultiplex the audio and transcribe it. It depends only on
     the audio, so it does not wait on the face verdict.
5. Join, combine under AND, and respond.
6. Destroy the working directory and delete the login recording in a `finally` block,
   whatever the outcome.

Two properties follow from concurrency, and both are security properties rather than
performance ones:

- **No timing side channel between factors.** A rejection takes the same path regardless
  of which factor failed, so an adversary cannot probe the factors independently and
  reduce a three-factor conjunction to three separate problems.
- **No factor disclosure.** The response is identical whichever factor failed; the
  per-factor outcome goes to the server log only.

*Evidence.* Per-stage timings over five runs of a genuine login: template extraction
12,424 ms; face match 98 ms; voice match 104 ms; audio demultiplex 154 ms; transcription
2,367 ms. End to end: cascaded 15,320 ms, concurrent 13,293 ms — about 2,027 ms saved, a
1.15× speedup.

The modest ratio is itself informative. The speedup is bounded by template extraction:
the challenge branch it overlaps with (~2,521 ms) is far shorter than the 12,424 ms
extraction it hides behind. Further reduction must come from amortising model loading —
a resident model service instead of a fresh interpreter per login — not from more
concurrency. That is a deployment change and was not attempted.

---

## Chapter 6 — Face verification

**What it does.** Twelve frames are sampled uniformly across the login recording. Each
usable frame yields a 512-dimensional embedding from a network trained with an additive
angular-margin objective (InsightFace `buffalo_l`). Each is compared to the enrolled
reference by inner product — both vectors are L2-normalised, so this is cosine
similarity. The verdict is the **median** of the per-frame scores against τ_f = 0.35.

**Why the median.** A mean lets a handful of degraded frames — motion blur, a
half-turned head, transient occlusion — drag the score. The median cannot be moved by a
minority of bad frames.

**Why not the paper's method.** The original design used a perceptual hash of whole
frames compared by Hamming distance. A perceptual hash summarises the entire frame —
background, lighting, pose — so it measures *scene* similarity, not identity. On our own
recordings the genuine pair scored a Hamming distance of 26.0 against an acceptance
threshold of 25 — a genuine user rejected — while impostor pairs scored 30.0 and 32.0.
The two populations are not separated by a usable margin.

On the same pairs the embedding matcher scores 0.7265 and 0.6194 for genuine pairs
against 0.2247 and 0.1838 for impostors, with τ_f = 0.35 sitting between them.

These are four pairs from a handful of recordings. They establish that the replaced
statistic failed where the embedding succeeds. **They are not an accuracy evaluation and
no error rate is claimed from them.**

One robustness detail is worth recording: when a container reports no frame count —
which browser-produced recordings frequently do — uniform sampling has no index range to
span, so the code falls back to reading sequentially and keeping every fifth frame until
twelve embeddings are collected.

---

## Chapter 7 — Speaker verification

**What it does.** The login audio is demultiplexed, resampled to 16 kHz mono, and
encoded to a 192-dimensional ECAPA-TDNN speaker embedding (SpeechBrain, VoxCeleb). It is
compared to the enrolled speaker embedding by cosine similarity against τ_a = 0.30.

**Why not the paper's method.** The original design compared 13-coefficient MFCC
matrices by mean pairwise Euclidean distance. Measured across the four enrolled
templates then available, belonging to two distinct speakers:

| Population | Range |
|---|---|
| Genuine (same speaker, different recording) | 172.8 – 178.8 |
| Impostor (different speaker) | 153.7 – 193.0 |

The impostor range strictly contains the genuine range, and the closest pair of all was
an impostor pair. **No threshold on this statistic separates speakers on this data**, and
the factor was observed accepting a different speaker in practice.

The cause is structural, not a matter of calibration: the distance is dominated by frame
log-energy — whose zeroth coefficient is an order of magnitude larger than the rest —
and by the dispersion of the two frame clouds. It measures loudness and recording
conditions, not who is speaking.

**How the threshold was chosen.** From a measured distribution, not assumed. Over the
labelled window pairs available, real cross-speaker pairs reached at most 0.256 while
genuine same-speaker pairs floored at 0.345. 0.30 lies in that gap. That distribution
rests on two speakers, so it fixes a defensible operating point on the available data;
it is not an equal-error-rate calibration and no error rate is claimed for it.

Synthetic `espeak` voices were deliberately **excluded** from threshold-setting: they
share a synthesis timbre and are not distinct speakers to the model.

A template predating this migration cannot be scored — the recording it came from was
destroyed by design — so the matcher fails closed and the account must re-enrol.

---

## Chapter 8 — Spoken-challenge verification

The login audio is demultiplexed and transcribed. The recogniser is asked for **all**
alternatives, not just its top guess, because the top-ranked reading of a spoken digit
string is frequently a sound-alike word rather than the digits.

The factor passes if **any** hypothesis matches the issued challenge after
normalisation. Normalisation lowercases, strips separators, and maps spelled-out number
words to numerals — including the homophones people actually produce (`oh`→0, `won`→1,
`to`/`too`→2, `for`→4, `ate`→8) — so a correct utterance is not rejected for
orthographic reasons.

Two implementation details are deliberate:

- **Transport.** The recognition library defaults to a plain-HTTP endpoint; the call is
  pinned to HTTPS.
- **Isolation.** The original code wrote a fixed `transcript.wav` in the working
  directory, so two concurrent logins would transcribe each other's audio. Each
  transcription now uses a private temporary file.

Logging is value-free by design: the expected challenge and the spoken transcripts are
**not** written to the log. A challenge is low-entropy and short-lived, and logs outlive
it and are read by more people than should see a live challenge/response. Only the
*count* of transcript alternatives is logged, which keeps a mismatch diagnosable without
disclosing the values.

---

## Chapter 9 — Decision-level fusion

The three verdicts are combined conjunctively:

```
D = b_f AND b_a AND b_c
```

Access is granted only when all three are 1. A conjunctive rule lowers the false
acceptance rate at the cost of a higher false rejection rate, which is the appropriate
operating point for authentication, and it guarantees that compromise of any single
modality cannot by itself produce a positive decision.

Fusion happens **after** the join, never lazily. The rejection response is a single
generic message; which factor failed is never disclosed to the client.

---

## Chapter 10 — Biometric template storage

**Template-only storage.** No recording of any user is retained. The registration video
is reduced to two embeddings and destroyed. This matters because an embedding is not a
playable recording of someone's face and voice: a breach of the enrolment store yields
no reusable biometric media. The stored artefact is also far smaller — roughly 147 KB of
template in place of an 11.18 MB recording, about a 76-fold reduction.

**Encryption at rest with integrity.** Templates are sealed under AES-256-GCM in an
envelope of `"MBENC1" | 12-byte IV | 16-byte tag | ciphertext`. The authentication tag
doubles as an integrity check: a template modified on disk fails to decrypt, and the
system rejects the login rather than proceeding with unverified data. Because the mode
is a stream mode, ciphertext length equals plaintext length and encryption adds only a
fixed 34-byte overhead.

**Pseudonymous naming.** Confidentiality protects a template's *contents* but says
nothing about what its *name* discloses. A template named after its account means that
compromising the storage directory alone — without the database and without the key —
reveals the entire enrolled membership by name and hands over one labelled biometric
template per person, each reusable for cross-system correlation. This is the
unlinkability concern of ISO/IEC 24745.

Each template is therefore stored under
`HMAC-SHA256(k_bio, "template-name:" + username)`. The hash is **keyed**, not plain,
because identifiers are low-entropy and would fall to a dictionary against an unkeyed
digest. An adversary lacking the key cannot map a file back to a person; one holding it
could already decrypt the templates, so no additional linkage is conceded. The mapping
is deterministic, so login re-derives the name with no lookup table and no schema
change.

The login recording is encrypted under the same key and deleted once the attempt
resolves, so no login recording is retained either.

---

## Chapter 11 — Account PII protection

The template store was encrypted and pseudonymous while the account collection was not:
a database dump returned every enrolled person's email, name, mobile number and address
in the clear. This was previously recorded as an accepted residual risk. It is now
addressed.

**What is sealed.** Every contact field — email, first name, last name, mobile, address,
avatar — is encrypted under AES-256-GCM with a dedicated account key, in an envelope of
`base64("PII1" | IV | tag | ciphertext)`.

**What is not, and why.** The username stays readable. Every login queries it, the
client submits it on every request, and it is carried in the session token. Sealing it
would impose a blind index on the hot authentication path while concealing nothing that
the client does not already transmit on the wire.

**The email blind index.** Registration must reject a duplicate address without being
able to read any stored address. Ciphertext cannot carry that test — a random IV makes
two records holding the same address differ byte for byte — so uniqueness moved to
`emailIdx = HMAC-SHA256(k_pii, "email-index:" + lowercase(trim(email)))`, a
deterministic keyed hash with a unique, sparse index. It is keyed for the same reason
the template names are: addresses are guessable. It is never returned to the client,
since it is a stable correlatable handle for the address it stands in for.

**Migration.** `backend/scripts/migrate_pii.mjs` seals existing records and backfills
the index. It is dry-run by default, idempotent, and prints field *names* only — never
values.

*Evidence.* Eight pre-existing accounts migrated; a second run reported nothing left to
migrate. A raw read of the collection confirms the contact fields are ciphertext and the
username is not. The profile endpoint returns the original values for a migrated
account. A duplicate registration with the same address in different case and with
surrounding whitespace is rejected; a new address is accepted.

**Scope of the claim.** This is confidentiality of the account record *at rest*. It is
not an unlinkability property — usernames remain readable, so a dump discloses the
membership list, though no longer the contact list. It is also not an access-control
property of the running service; see Chapter 16.

---

## Chapter 12 — Key management

The system keeps three secrets, and no operation borrows one domain's secret for
another's purpose.

| Key | Used for | Never used for |
|---|---|---|
| `JWT_SECRET` | signing session and enrolment tokens | encrypting any store |
| `BIOMETRIC_KEY` | AES-256-GCM on templates and the transient login recording; keying the pseudonymous template names | account PII |
| `PII_KEY` | AES-256-GCM on contact fields; keying the email index | biometric material |

**Why separation is enforced rather than recommended.** It bounds what a single
disclosure costs. An adversary holding the signing key can forge tokens but cannot read
a template or a contact field. One holding the biometric key can decrypt templates and
re-derive their names but learns nothing about addresses. One holding the PII key
obtains contact details but no biometric reference and no ability to mint a token.
Deriving all three from one secret — or, in the common shortcut, deriving the storage
keys from the token-signing secret — makes each of those compromises the others as well.

**Production enforcement.** `backend/config.js` validates the secrets at module load and
exits before the service accepts any request:

| Rejected | Reason |
|---|---|
| Any of the three unset | Storage keys would be derived from the signing secret |
| Any shorter than 32 characters | A short key is a passphrase, not a key |
| `JWT_SECRET` left at its development placeholder | That value appears in the published source, so every token it signs is forgeable |
| `BIOMETRIC_KEY == PII_KEY` | One key while believing there are two |
| Either storage key equal to `JWT_SECRET` | Re-creates the coupling by hand |

The check lives in `config.js` rather than `server.js` so that it also covers the offline
maintenance scripts, which import the same module — a migration cannot be run against a
production store under the wrong keys.

Development is unchanged: with nothing configured, the signing secret takes a
placeholder and the storage keys are derived from it, both announced at startup. That
fallback is a convenience for local work and is exactly the configuration production
refuses.

*Evidence.* Each branch was exercised: development with nothing set starts; production
with nothing set lists all three violations and exits 1; the placeholder signing secret,
a short secret, identical storage keys, and a storage key equal to the signing secret are
each rejected with a specific diagnostic; three distinct strong secrets start cleanly.
The migration script exits 1 under production without secrets and runs normally in
development.

---

## Chapter 13 — Registration atomicity

Because registration spans two requests, it can stop in between — the tab is closed, the
camera fails, the recording contains no usable face. That left an account holding **no
template**: it could never authenticate, because there is nothing to match against, and
never enrol, because its token expires after ten minutes — yet it held its username and
email permanently, locking the legitimate owner out with no way back.

Three rules resolve this, and each is guarded so that an *enrolled* account is never
touched:

1. **Rollback.** A failed extraction deletes the account it was enrolling, releasing the
   identifier immediately.
2. **Release.** Registration treats an identifier held by a template-less account as
   available and deletes that record instead of rejecting the request. This concedes no
   biometric reference: an account with no template was never bound to anyone's
   biometrics, so taking it over is indistinguishable from registering an unused name.
3. **Refusal.** Enrolment is refused if the account the token names no longer exists, so
   a stale token from a rolled-back registration cannot write a template that no account
   owns.

Every deletion is conditioned on the account holding no template, and the enrolment
endpoint independently refuses to overwrite a stored template. Releasing an *enrolled*
identifier would be the takeover the enrolment binding exists to prevent.

One asymmetry is recorded honestly: rollback covers **extraction** failure. A failure
*after* extraction, while the template is being sealed and written, returns an error and
leaves the account in place with no template. That state is recovered by rule 2 on the
next registration rather than by a second rollback.

*Evidence.* Against the live server: registration succeeds; an unusable recording
returns 400 with the account rolled back; the same token afterwards returns 409; the
username re-registers successfully; re-registering an abandoned account leaves exactly
one record rather than a duplicate; uploading onto an enrolled account and re-registering
an enrolled username are both rejected.

---

## Chapter 14 — Evaluation harness

The template-only storage that gives the scheme its privacy property also erases, by
design, the recordings an accuracy study needs.

`backend/scripts/run_evaluation.mjs` and `evaluate_corpus.py` compute FAR, FRR and EER
once recordings exist, and refuse to run below five subjects rather than produce a figure
that cannot support a claim. To avoid a separate hand-managed collection step, an
optional capture mode retains uploads under the naming convention the harness consumes —
registration providing one session and each login another.

Because retention reverses the guarantee shown to the user, the mode is **off by
default** and gated on **per-upload consent**: the page displays a retention notice, and
the server retains a recording only when consent accompanied that specific upload.
Retained recordings are named by the same keyed hash used for templates, so a leak of the
corpus listing discloses no identifiers — though the recordings remain identifying by
content and must be handled under the participants' consent.

**No recognition-accuracy evaluation has been performed.** The corpus is too small. The
harness exists so that the study can be run when participants are available; the paper
reports no FAR, FRR or EER.

---

## Chapter 15 — Paper–code alignment

A separate strand of work brought the paper's algorithms into correspondence with the
deployed system. The algorithms were rewritten rather than patched, in the order the
phases actually occur:

| # | Algorithm |
|---|---|
| 1 | User Registration / Enrolment |
| 2 | Login and Challenge Issuance |
| 3 | Concurrent Authentication |
| 4–6 | Face, speaker and challenge verification |
| 7 | Decision-level AND fusion |
| 8 | Shared template extraction |
| 9 | Account-record storage |

Obsolete content was removed rather than left struck through: the cascade, the
perceptual-hash and MFCC matchers, and every reference to storing a registration
recording as the biometric reference or re-extracting features from it at login.

The algorithms were then audited line by line against the code, and the divergences found
were corrected **in the paper**, since the code is the reference. Those included: the
login upload deriving its identifier from the filename; the filename pattern check; the
consented capture step; the challenge branch producing transcripts with the comparison
happening after the join; the session token's real payload and 24-hour lifetime; the
transcription stage running before the null-challenge test rather than after it; the
frame-count fallback; and the account record's read path.

Two process notes are worth recording, because both were caught by checking output rather
than trusting a successful build:

- A rendered algorithm **overflowed its float and four steps were silently dropped from
  the PDF**. The build reported no error. It was found by extracting the PDF's text and
  grepping for the final line, and fixed by making the algorithm a double-column float.
- Renumbering one algorithm invalidated two cross-references in another. Both were found
  by re-extracting the rendered step numbers and comparing.

---

## Chapter 16 — Known limitations

Stated plainly, because a report that omits them is not useful.

**Recognition accuracy is not evaluated.** No FAR, FRR or EER is claimed. The matcher
figures quoted in Chapters 6 and 7 are diagnostics on a handful of recordings that
motivated each replacement — not error rates. The thresholds rest on two speakers.

**The enrolment token binds an identifier, not an account instance.** It carries
`{username, purpose}` — no account reference and no nonce — and the enrolment endpoint
locates the account by identifier alone. Since identifiers can now be released
(Chapter 13), an identifier released while an earlier token for it is still inside its
ten-minute window can be enrolled by the holder of that earlier token onto the account
that subsequently claimed the same identifier. Binding the token to the account instance
would remove this; it is not implemented.

**The profile endpoint is not access-controlled.** `GET /api/user/:username` has no
authentication middleware, so it opens and returns a record's decrypted contact fields to
any caller naming the identifier. The encryption of Chapter 11 therefore protects against
compromise of the database itself, not against this endpoint.

**Key rotation is not automated.** No tooling exists. Changing `BIOMETRIC_KEY`
invalidates every template twice over — the ciphertexts no longer authenticate and the
keyed file names no longer resolve — so recovery means re-writing each template under the
new key and name, or re-enrolling every user if the retiring key is gone. Changing
`PII_KEY` requires re-encrypting the contact fields and recomputing the email index,
without which duplicate detection silently stops matching. Changing `JWT_SECRET` merely
invalidates outstanding tokens. Every case fails closed, but each is an outage.

**The account database is not unlinkable.** Usernames remain readable by design. A dump
discloses the membership list.

**A third party sees the login audio.** The challenge factor transcribes through an
external speech-to-text service, so login audio leaves the verifier's trust boundary and
that party is relied upon for the availability and correctness of that factor. An
on-premises recogniser would remove the dependency. A registration acknowledgement email
is dispatched through a hosted SMTP provider; it is auxiliary and not part of
authentication.

**The threat model excludes real-time relay.** The spoken challenge is a liveness cue,
not a complete presentation-attack detector. A sophisticated real-time relay or a
deepfake that reproduces an unpredictable challenge inside its validity window is out of
scope.

**Timings come from one machine and one user.** The latency figures in Chapter 5 are five
runs of a genuine login on a single host. They characterise the pipeline's shape — that
extraction dominates — rather than establishing performance under load.
