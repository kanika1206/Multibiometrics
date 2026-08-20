# Permanent Public URL

The old deployment used **Cloudflare quick tunnels**, whose URL is regenerated
every session — every restart meant a new backend URL and therefore a full
frontend rebuild (CRA bakes `REACT_APP_SERVER_DOMAIN` at build time). This
replaces that with a hostname that never changes.

## Why not Cloudflare

Two independent reasons, the second decisive:

1. **A named tunnel needs a domain.** Cloudflare *named* tunnels require a
   domain whose nameservers are delegated to Cloudflare — there is no free
   Cloudflare-hosted hostname (`*.cfargotunnel.com` still needs a DNS record
   in a zone you own).
2. **This network now blocks cloudflared's edge entirely.** Measured
   2026-08-20: quick tunnels are issued a URL over ordinary HTTPS, but the
   control connection never registers. TCP 7844 *opens* and is then reset
   mid-handshake:

   ```
   ERR Unable to establish connection with Cloudflare edge
   error="TLS handshake with edge error: read tcp 172.18.12.125:57980->198.41.192.27:7844:
          read: connection reset by peer"
   ```

   Four attempts, four fresh URLs, `Registered tunnel connection` count of
   zero every time; the public URL returns **error 1033 / HTTP 530**. QUIC
   (UDP 7844) was already blocked here, which is why `--protocol http2` was
   mandatory in earlier sessions — now the TCP path is filtered too. General
   HTTPS egress is unaffected (`cloudflare.com` → 200), so this is targeted at
   the tunnel edge, not general connectivity.

   **A named tunnel would not fix this**: it uses the same edge ports. Buying
   a domain would change nothing while this network policy stands.

Tailscale Funnel relays over **443**, which this network allows, and issues a
permanent `https://<machine>.<tailnet>.ts.net` hostname at no cost:

| Requirement | Met |
|---|---|
| One permanent public URL | yes — tied to the machine + tailnet, not to a session |
| Unchanged across reboots | yes — no ephemeral URL is ever minted |
| Public while the PC is on and the app runs | yes |
| Same URL still configured while the PC is off | yes (unreachable, not reassigned) |
| Tunnel + app auto-start on boot | yes — `tailscaled` is a system service; the app runs as systemd user units |
| Same URL works again once the app is back | yes |

If the network policy is ever relaxed (or you move to a network that permits
outbound 7844) and you buy a domain, the Cloudflare named-tunnel route is a
drop-in replacement for step 6 below; nothing else in this document changes.

## Layout

Funnel may expose only ports **443, 8443 and 10000**, so the two servers get
one hostname each on a different port. This avoids path-prefix rewriting,
which would otherwise have to cover `/api`, `/captcha`, `/upload-video`,
`/upload-video-login` and `/eval-status` separately.

```
https://<host>          -> localhost:3999   frontend (static CRA build)
https://<host>:8443     -> localhost:8099   backend (Express)
```

Both are HTTPS, which the browser requires before it will grant
`getUserMedia` (camera + microphone).

## Setup

Run the helper, which is idempotent and stops with instructions whenever a
step needs your hands:

```bash
cd /home/kanika/Multibiometric_Code
./scripts/tunnel_setup.sh
```

It performs, in order:

1. **Daemon check.** Starts the `tailscaled` user unit if it is not running.
2. **Login check**, and resolves this machine's permanent hostname. If not
   logged in, it prints the `tailscale ... up` command and exits; that command
   emits a `https://login.tailscale.com/a/...` URL to open in a browser.
3. **Prints the admin-console steps**: enable *HTTPS Certificates* under
   [DNS](https://login.tailscale.com/admin/dns), and grant the `funnel` node
   attribute in the ACL:
   ```json
   "nodeAttrs": [ { "target": ["autogroup:member"], "attr": ["funnel"] } ]
   ```
4. **Rebuilds the frontend** with `REACT_APP_SERVER_DOMAIN=https://<host>:8443`
   written to `frontend/.env`. This is a **one-time** rebuild — the URL is
   permanent, so no future restart requires another. (Quick tunnels forced a
   rebuild every single session.)
5. **Enables the systemd user units** `multibio-backend` and
   `multibio-frontend` (see below).
6. **Publishes both ports** with `tailscale funnel --bg`. The configuration is
   stored by `tailscaled` and restored on boot; it does not need re-running.
7. **Prints the one remaining root command**, `sudo loginctl enable-linger
   $USER` — without it systemd stops your user services at logout.

### Installation (already done, no root required)

Tailscale here is **not** the packaged system install. The static binaries were
unpacked into `~/.local/bin/` and the daemon runs in **userspace-networking**
mode, which needs no TUN device and therefore no `sudo`:

```bash
curl -fsSL -o ts.tgz https://pkgs.tailscale.com/stable/tailscale_1.102.3_amd64.tgz
tar xzf ts.tgz && cp tailscale_1.102.3_amd64/{tailscale,tailscaled} ~/.local/bin/
```

Userspace mode gives up exit-node and subnet-router functionality, neither of
which this deployment uses; Funnel (inbound serving) works normally. Because
`tailscaled` is a *user* unit rather than a system service, `enable-linger` is
what keeps it — and therefore the tunnel — alive across logout and reboot.

Every `tailscale` command must carry the socket path, since the daemon does not
use the default system socket:

```bash
tailscale --socket=$HOME/.tailscale/tailscaled.sock status
```

## Services

All three are **user** units (`systemctl --user`), so none of them needs root.

| Unit | What it runs | Notes |
|---|---|---|
| `~/.config/systemd/user/tailscaled.service` | `tailscaled --tun=userspace-networking` | State and socket live in `~/.tailscale/`. Enabled, so it starts with the session. |
| `~/.config/systemd/user/multibio-backend.service` | `node server.js` in `backend/` | Secrets are **not** in the unit (it is world-readable) — `server.js` loads `backend/.env` itself. `Restart=on-failure` with `StartLimitBurst=0`, because after a cold boot Mongo may still be starting. |
| `~/.config/systemd/user/multibio-frontend.service` | `serve -s build -l 3999` | `-s` gives the SPA fallback react-router needs. `serve` is a local devDependency, so boot needs no network fetch. |

Verified 2026-08-20: backend unit answers `GET /` with 201 and `/eval-status`
with `{"evalCapture":false}`; frontend unit answers `GET /` with 200.

MongoDB is the Docker container `multibio-mongo` with
`RestartPolicy=unless-stopped`, so it returns on boot without extra
configuration.

Everyday commands:

```bash
systemctl --user status  tailscaled multibio-backend multibio-frontend
systemctl --user restart multibio-backend
journalctl --user -u multibio-backend -f     # per-factor login logs

TS="$HOME/.local/bin/tailscale --socket=$HOME/.tailscale/tailscaled.sock"
$TS status
$TS funnel status                            # what is published
```

## Notes and limits

- **Upload size.** Registration and login videos may reach 100 MB (the multer
  limit). Funnel does not impose Cloudflare's 100 MB free-plan body cap, so
  this is one respect in which it behaves better than the previous setup.
- **Port 8443.** A few restrictive networks allow only 443 outbound, which
  would block the API but not the page. If you hit that, move to a purchased
  domain plus a Cloudflare named tunnel, where both hostnames sit on 443.
- **Nothing in the application changed.** No backend source, no MongoDB, no
  `BiometricKeyVault`, no registration or authentication flow, and no
  cryptography was touched by this deployment work. The only repository edits
  are `frontend/.env` (rebuilt URL), `frontend/package.json` (adds the `serve`
  devDependency), this document, and `scripts/tunnel_setup.sh`.

## Status (2026-08-20)

| Step | State |
|---|---|
| Tailscale binaries in `~/.local/bin` | done |
| `tailscaled` user unit, userspace mode | done, running |
| App user units (backend, frontend) | done, verified locally |
| **Browser login** | **pending — the blocking step** |
| Admin console: HTTPS certs + funnel attr | pending (needs login first) |
| Funnel publish, frontend rebuild | pending (script step 4 and 6) |
| `sudo loginctl enable-linger` | pending |

To resume: run

```bash
~/.local/bin/tailscale --socket=$HOME/.tailscale/tailscaled.sock up --hostname=multibio
```

open the printed `login.tailscale.com/a/...` URL, then run
`./scripts/tunnel_setup.sh`.
