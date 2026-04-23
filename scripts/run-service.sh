#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
fi

export PATH="$HOME/.local/bin:$PATH"

PORT="${PORT:-3007}"
export PORT

if [ -z "${LIFEOS_EXTERNAL_BASE_URL:-}" ]; then
  if dns_name="$(tailscale status --json --self=true --peers=false 2>/dev/null | python -c 'import sys, json; print((json.load(sys.stdin).get("Self", {}) or {}).get("DNSName", "").rstrip("."))' 2>/dev/null)" && [ -n "$dns_name" ]; then
    export LIFEOS_EXTERNAL_BASE_URL="http://${dns_name}:${PORT}"
  fi
fi

cd /home/ilangurudev/projects/lifeos-dashboard
exec npm run serve
