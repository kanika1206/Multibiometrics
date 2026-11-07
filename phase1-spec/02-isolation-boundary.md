Status: proposed Phase 1 specification, 1 November 2026. Documents only; implementation is NOT authorized. Submitted v1 revision: **5df0ecd0a5cb2ed8fbf6e1f8211671534189034d** (user-designated HEAD; no uncommitted submission changes). Existing files outside phase1-spec/ remain untouched. Fixed target: Windows, i5-class CPU, 8 GB RAM; phone work deferred.

# Isolation boundary and IPC recommendation

## Proposed future layout (not created)
A separate offline-prototype/ application beside existing backend/frontend, containing app/, inference/, contracts/, tests/, packaging/ and its OWN dependency locks and environment. No imports that execute or write into the v1 checkout; any reused algorithm is copied with source revision attribution after the pin and validated separately. No edits to .gitignore, existing package files, venv, environment files or models. No migration of existing account/template stores. Fixture exports are consented copies, never mutations of originals.

Future installed binaries/models: versioned read-only application directory. Writable state: dedicated Windows LocalAppData/MultimodalOffline namespace: vault/, logs/, transient/, research-capture/ (opt-in only), acceptance-evidence/. Do not use existing backend paths or shared model caches. New per-user Windows ACLs restrict state. No secrets in repository or install package. A separate build environment contains any exporters; production does not depend on a download-capable exporter.

## P1-5 decision — desktop shell with non-network IPC
User selected a desktop shell with non-network IPC: Windows named pipes or inherited process pipes, authenticated/restricted to the launching user/process, bounded messages and explicit request IDs. No TCP/UDP listeners, HTTP localhost server, remote UI content, debug ports or update checks. This meets strict zero-socket operation and makes loopback traffic a failure rather than an exception. A desktop shell still requires auditing its own telemetry/background requests; non-network IPC alone is not proof.

The localhost-service option and loopback exception are REJECTED, not deferred. The selected boundary preserves literal zero-socket acceptance, simplifies auditing and avoids treating localhost traffic as an exception. This is a specification decision, not implementation authorization. Named-pipe/child-process boundary must reject requests from unrelated users, unexpected paths, oversize messages and stale attempt IDs.

## Preservation evidence
Before later implementation, inventory existing paths outside the authorized new area, including tracked and untracked source/docs/config/assets. Record path, type, symlink target, size and SHA-256 of regular-file bytes; keep evidence under the new project's authorized evidence directory. Do not print secret contents. Record HEAD, index state, git status and dirty diffs without changing them. Hash original models/fixtures too; document unreadable exclusions (never report them verified). Enumerate paths again after work to detect deletion, rename and unexpected additions, then compare hashes. Index/HEAD must remain unchanged. A clean git diff alone cannot establish preservation of untracked files. Symlinks must not permit writes outside the new area.

No application, installer, migration, cache-warming, package manager or tests touching v1 are run in this specification round. Current specification writing is restricted to phase1-spec/.

Resolved: IPC and submitted revision. Open: exact reference Windows version/build and i5 model. Shell/framework version is a later engineering selection within the chosen IPC constraint.

## Amendment — 2026-11-01: native Tk shell approved

User decision: native Tk replaces the earlier HTML/JS desktop-shell asset assumption. Earlier text is retained above as superseded on that point only. Reason: smaller zero-socket audit surface; UI fidelity is not a research claim. Full native UI integration is authorized. Inherited pipes/named pipes only; no sockets or loopback exception. All other constraints and Windows-target verification requirements remain unchanged.
