#!/usr/bin/env bash
# Start the cyber-exec service, bound to loopback ONLY.
# Tailnet exposure is handled separately by:
#   tailscale serve --bg --https=443 http://127.0.0.1:8000
set -euo pipefail

cd "$(dirname "$0")"

# Load .env (CYBER_EXEC_TOKEN) if present, without echoing it.
if [[ -f ../.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ../.env
  set +a
fi

if [[ -z "${CYBER_EXEC_TOKEN:-}" ]]; then
  echo "ERROR: CYBER_EXEC_TOKEN is not set (see .env.example)" >&2
  exit 1
fi

# IMPORTANT: bind 127.0.0.1 only. Never 0.0.0.0.
exec uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
