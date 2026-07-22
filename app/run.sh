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

# Host-visible work root for the throwaway container mounts. For local/direct
# runs default to a repo-local dir (never the process /tmp, which may be a
# systemd PrivateTmp namespace the Docker daemon cannot see). The systemd unit
# sets its own CYBER_EXEC_WORKROOT.
export CYBER_EXEC_WORKROOT="${CYBER_EXEC_WORKROOT:-$(cd .. && pwd)/.work}"
mkdir -p "$CYBER_EXEC_WORKROOT"

# IMPORTANT: bind 127.0.0.1 only. Never 0.0.0.0.
exec uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
