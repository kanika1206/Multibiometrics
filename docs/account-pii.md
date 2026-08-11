# Account PII encryption

## The problem

Two stores hold user data, and only one of them was protected.

The template store had encryption (AES-256-GCM), integrity (the GCM tag) and
pseudonymous file names (`HMAC(k, username)`), so a filesystem-only breach
yielded neither identities nor usable biometric media. The **account collection**
had none of that. A dump of `users` returned, in the clear:

```
{ username: "…", email: "…", firstName: "…", lastName: "…",
  mobile: "…", address: "…", profile: "<base64 avatar>" }
```

— the contact details and home address of every enrolled person. This was
previously written up as an accepted residual risk. It is now fixed.

## What changed

`backend/piiStore.js` seals the contact fields before they are written and opens
them on read. An account record now looks like:

```
{ username: "example123",              // plaintext — see below
  emailIdx: "8fdeb220d8349cea…",       // HMAC(k_pii, normalized address)
  email:    "UElJMRKUBqkLOBBifWLj9…",  // base64 "PII1"|iv|tag|ciphertext
  firstName / lastName / mobile / address / profile: same sealed form }
```

Field format: `base64("PII1" | 12-byte IV | 16-byte GCM tag | ciphertext)`.

### The username stays plaintext, deliberately

Every login does `findOne({ username })`, the client submits it on every request,
and it is signed into the session token. Sealing it would require a blind index
on the hot lookup path and would still not conceal an identifier that travels in
the clear on every attempt. The account database is therefore
**confidentiality-protected but not unlinkable** — a dump discloses the
membership list, not the contact list. The template store remains the unlinkable
one.

### Email is encrypted *and* indexed

Registration must reject a duplicate address without being able to read any
stored address. Ciphertext cannot be compared (a random IV means two records
holding the same address differ byte-for-byte), so uniqueness moved off `email`
and onto `emailIdx`, a keyed hash of the normalized (trimmed, lowercased)
address:

- Deterministic, so Mongo's unique index still fires.
- Keyed, not a plain digest, because addresses are guessable and would fall to a
  dictionary otherwise. Same reasoning as the template file names.
- Never returned to the client: `getUser` strips it, since it is a stable
  correlatable handle for the address it stands in for.

`emailIdx` is `sparse` so pre-migration records (which have none) do not all
collide on `null`.

### Separate key

`PII_KEY`, not `BIOMETRIC_KEY`. Compromising the template key must not also
disclose contact details, and vice versa; deriving both from one secret would
make the separation cosmetic.

Both keys are **mandatory under `NODE_ENV=production`**: `backend/config.js`
exits at startup if either is unset, shorter than 32 characters, equal to the
other, or equal to `JWT_SECRET` — which is itself mandatory there, and rejected
if left at its published development placeholder (see `docs/DEPLOYMENT.md` §1.3).
In development they fall back to a `JWT_SECRET`-derived value with a warning,
under **different** labels, so even the fallback keys differ.

Rotating `PII_KEY` is **not automated**: it requires re-encrypting the contact
fields and recomputing `emailIdx` under the old key first, or duplicate detection
silently stops matching existing accounts. See `docs/DEPLOYMENT.md` §1.3.

## Migration

```bash
cd backend
node scripts/migrate_pii.mjs            # dry run — reports, writes nothing
node scripts/migrate_pii.mjs --apply
```

Idempotent: an already-sealed field is skipped, so re-running is harmless and a
partial run can be repeated. It prints usernames and the *names* of the fields it
sealed, never their values.

Run it with the same `PII_KEY` the server will use. Migrating under one key and
serving under another leaves every record undecryptable — `getUser` returns 500
rather than guessing, which is the intended fail-closed behaviour for a failed
GCM tag.

## Reading paths

| Path | Behaviour |
|---|---|
| `POST /api/register` | Seals `email`/`profile`, stores `emailIdx`, matches duplicates through the index. |
| `GET /api/user/:username` | Opens all sealed fields, drops `emailIdx`, 500s if a tag fails. |
| `PUT /api/updateuser` | Seals whatever contact fields the update carries; an email change moves `emailIdx` with it and 409s if that address is held by another account. |
| `POST /api/login` | Untouched — it only reads `username`. |
| `POST /api/registerMail` | Untouched — the address comes from the request body, not the database. |

Legacy plaintext values are returned unchanged by `open()`, so an un-migrated
deployment keeps working; only sealed-but-invalid values throw.

## Verified

- 8 pre-existing accounts migrated; re-run reports `0 would be migrated, 8
  already sealed`.
- Raw collection read confirms `email`, `firstName`, `lastName`, `mobile`,
  `address` are ciphertext and `username` is not.
- `GET /api/user/:username` returns the original values for a migrated account.
- Duplicate registration with the same address in different case and with
  surrounding whitespace is rejected; a genuinely new address is accepted.
- `PUT /api/updateuser` round-trips new values through ciphertext, rejects
  another account's address (409), and accepts the account's own (no false
  conflict).
