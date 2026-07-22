#!/usr/bin/env bash
# Smoke test for sec-toolbox-heavy via the cyber-exec API. Run on the box after
# building sec-toolbox-heavy:latest. Requires a running service + token.
#
#   CYBER_EXEC_TOKEN=... ./scripts/smoke_heavy.sh [base_url] [linux_dump_path]
#
# Covers the acceptance smokes:
#   (a) analyzeHeadless decompiles a tiny binary -> pseudo-C
#   (b) vol3 -h  (+ pslist on a Linux dump if one is provided)
#   (c) re-confirm non-root, --network none default, no network reachable
set -euo pipefail

BASE="${1:-http://127.0.0.1:8000}"
DUMP="${2:-}"
: "${CYBER_EXEC_TOKEN:?set CYBER_EXEC_TOKEN}"
AUTH="Authorization: Bearer ${CYBER_EXEC_TOKEN}"
CT='Content-Type: application/json'

# JSON-encode a local file's bytes as base64 (for the files[] field).
b64() { base64 -w0 "$1"; }
# Build a files[] entry from a local path.
jq_available() { command -v jq >/dev/null 2>&1; }

echo "############ (c) hardening: non-root + no network (image=heavy, network=none)"
curl -fsS -X POST "$BASE/api/exec" -H "$AUTH" -H "$CT" -d '{
  "image":"heavy","network":"none","timeout":60,
  "command":"echo uid=$(id -u) user=$(id -un); (curl -m5 -sSI https://example.com >/dev/null 2>&1 && echo NET-REACHABLE || echo NET-UNREACHABLE); (getent hosts example.com >/dev/null 2>&1 && echo DNS-OK || echo DNS-NONE)"
}' | { jq_available && jq . || cat; }
echo "  expect: uid != 0, NET-UNREACHABLE, DNS-NONE"

echo "############ (b) volatility3 present"
curl -fsS -X POST "$BASE/api/exec" -H "$AUTH" -H "$CT" -d '{
  "image":"heavy","network":"none","timeout":120,
  "command":"vol -h 2>&1 | head -3; echo ---; python3 -c \"import volatility3, sys; print(\\\"vol3\\\", volatility3.__version__)\""
}' | { jq_available && jq '{ok,exit_code,stdout}' || cat; }

echo "############ (a) Ghidra headless decompile -> pseudo-C"
# Send the decompile post-script; analyze an in-image binary (/bin/ls).
SCRIPT_B64=$(b64 "$(dirname "$0")/ghidra/DecompileFirst.py")
curl -fsS -X POST "$BASE/api/exec" -H "$AUTH" -H "$CT" -d "{
  \"image\":\"heavy\",\"network\":\"none\",\"timeout\":600,
  \"files\":[{\"name\":\"DecompileFirst.py\",\"b64\":\"${SCRIPT_B64}\"}],
  \"command\":\"cp /bin/ls /work/target.bin; analyzeHeadless /work smoke -import /work/target.bin -scriptPath /work -postScript DecompileFirst.py -deleteProject 2>&1 | grep -A2000 'PSEUDO-C\\\\|SMOKE-DECOMPILE' | head -60\"
}" | { jq_available && jq '{ok,exit_code,timed_out,stdout}' || cat; }
echo "  expect: 'SMOKE-DECOMPILE: OK' and some pseudo-C"

if [[ -n "$DUMP" && -f "$DUMP" ]]; then
  echo "############ (b') volatility3 pslist on provided Linux dump: $DUMP"
  echo "  NOTE: needs a matching ISF symbol table available offline"
  DUMP_B64=$(b64 "$DUMP")
  curl -fsS -X POST "$BASE/api/exec" -H "$AUTH" -H "$CT" -d "{
    \"image\":\"heavy\",\"network\":\"none\",\"timeout\":900,
    \"files\":[{\"name\":\"mem.dump\",\"b64\":\"${DUMP_B64}\"}],
    \"command\":\"vol -f /work/mem.dump linux.pslist.PsList 2>&1 | head -40\"
  }" | { jq_available && jq '{ok,exit_code,timed_out,stdout}' || cat; }
else
  echo "############ (b') skipped — no Linux dump path given (arg 2). vol3 -h shown above."
fi
