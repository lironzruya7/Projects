#!/usr/bin/env bash
# Print the live deployment state so every session reads it first (Option B —
# like the Claude OS repo). The stable operating brief is CLAUDE.md (auto-loaded).
f="docs/memory/STATE.md"
[ -f "$f" ] && { echo "===== docs/memory/STATE.md (READ FIRST) ====="; cat "$f"; }
