#!/usr/bin/env bash
# Finish the PERMANENT public URL setup (Tailscale Funnel, userspace mode).
#
# Everything here runs WITHOUT sudo: tailscaled runs in userspace-networking
# mode as a systemd *user* unit, so no TUN device and no root are involved.
# The one manual step is the browser login, which this script prints.
#
# Safe to re-run: each step is idempotent.
set -euo pipefail

TS="$HOME/.local/bin/tailscale"
SOCK="$HOME/.tailscale/tailscaled.sock"
REPO="/home/kanika/Multibiometric_Code"
ts() { "$TS" --socket="$SOCK" "$@"; }

echo "== 1. Daemon =="
systemctl --user is-active tailscaled >/dev/null || systemctl --user start tailscaled
echo "ok: tailscaled (userspace) is running"

echo "== 2. Logged in? =="
if ! ts status >/dev/null 2>&1; then
  echo "Not logged in. Run this, open the printed URL, then re-run this script:"
  echo "  $TS --socket=$SOCK up --hostname=multibio"
  exit 1
fi
HOST="$(ts status --json | grep -oP '"DNSName":\s*"\K[^"]+' | head -1 | sed 's/\.$//')"
echo "ok: $HOST"

cat <<MSG
== 3. One-time admin-console settings ==
  https://login.tailscale.com/admin/dns   -> enable "HTTPS Certificates"
  https://login.tailscale.com/admin/acls  -> grant the funnel attribute:
      "nodeAttrs": [ { "target": ["autogroup:member"], "attr": ["funnel"] } ]

Permanent URLs:
  frontend : https://${HOST}
  backend  : https://${HOST}:8443
MSG

echo "== 4. Rebuild the frontend against the permanent backend URL =="
# CRA bakes this at build time. Because the URL never changes again, this is a
# one-time rebuild rather than the per-session rebuild quick tunnels forced.
echo "REACT_APP_SERVER_DOMAIN=https://${HOST}:8443" > "$REPO/frontend/.env"
( cd "$REPO/frontend" && npm run build )

echo "== 5. App services (systemd user units, no root) =="
systemctl --user daemon-reload
systemctl --user enable --now multibio-backend.service multibio-frontend.service

echo "== 6. Publish both ports on the same permanent hostname =="
# Funnel may expose only 443, 8443 and 10000, hence the port split rather than
# path routing (which would have to rewrite /api, /captcha, /upload-video, ...).
ts funnel --bg --https=443  http://localhost:3999
ts funnel --bg --https=8443 http://localhost:8099
ts funnel status

cat <<MSG

== 7. Survive logout and reboot ==
One command still needs root:

  sudo loginctl enable-linger $USER

Without it systemd stops your user services (app AND tailscaled) at logout.
Funnel configuration is stored by tailscaled and restored on boot by itself.

DONE — same URLs after every reboot:
  app : https://${HOST}
  api : https://${HOST}:8443
MSG
