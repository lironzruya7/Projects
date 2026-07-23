#!/usr/bin/env bash
# SessionStart hook. Two jobs:
#   1) Print the live operating state so every session reads it first.
#   2) In Claude Code on the web, install deps so typecheck/build/tests work.
set -uo pipefail

DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# 1) Live state → session context.
f="$DIR/docs/memory/STATE.md"
if [ -f "$f" ]; then
  echo "===== docs/memory/STATE.md (READ FIRST) ====="
  cat "$f"
  echo "===== end STATE.md ====="
fi

# 2) Dependencies (remote/web sessions only; idempotent, cached after first run).
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  ( cd "$DIR" && npm install --no-audit --no-fund ) >/dev/null 2>&1 || \
    echo "[session-start] npm install failed — run it manually before build/test."
fi
