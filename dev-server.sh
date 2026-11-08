#!/usr/bin/env bash
# Start the dev server on all interfaces and print the URL a phone on the same
# Wi-Fi/LAN should open. Extra arguments go to Vite+ (e.g. --port 5174).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ ! -x node_modules/.bin/vp ]]; then
  npm ci
fi

# Take --port out of the arguments so it is passed to Vite+ exactly once.
port=5173
passthrough=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port=*) port="${1#--port=}" ;;
    --port)
      port="${2:?--port needs a value}"
      shift
      ;;
    *) passthrough+=("$1") ;;
  esac
  shift
done

# The LAN address of the interface that carries the default route, then common fallbacks.
lan_ip=""
if command -v ipconfig >/dev/null 2>&1; then
  default_if="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')"
  for interface in $default_if en0 en1; do
    lan_ip="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
    [[ -n "$lan_ip" ]] && break
  done
elif command -v hostname >/dev/null 2>&1; then
  lan_ip="$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)"
fi

echo
if [[ -n "$lan_ip" ]]; then
  echo "  Phone (same Wi-Fi/LAN): http://${lan_ip}:${port}/"
else
  echo "  No LAN address found: connect to Wi-Fi or Ethernet to reach this from a phone."
fi
echo "  This computer:          http://localhost:${port}/"
echo

# --strictPort fails clearly if the port is taken, instead of silently moving to
# another port and making the printed phone URL wrong.
exec npm run dev -- --host 0.0.0.0 --port "$port" --strictPort ${passthrough[@]+"${passthrough[@]}"}
