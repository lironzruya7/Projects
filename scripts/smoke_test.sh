#!/usr/bin/env bash
# Quick smoke test against a running cyber-exec instance.
# Usage:  CYBER_EXEC_TOKEN=... ./scripts/smoke_test.sh [base_url]
set -euo pipefail

BASE="${1:-http://127.0.0.1:8000}"
: "${CYBER_EXEC_TOKEN:?set CYBER_EXEC_TOKEN}"
AUTH="Authorization: Bearer ${CYBER_EXEC_TOKEN}"

echo "== health =="
curl -fsS "${BASE}/healthz"; echo

echo "== 401 without auth =="
curl -s -o /dev/null -w '%{http_code}\n' -X POST "${BASE}/api/exec" \
  -H 'Content-Type: application/json' \
  -d '{"command":"echo hi","network":"none","timeout":10}'

echo "== basic exec (network=none) =="
curl -fsS -X POST "${BASE}/api/exec" \
  -H "${AUTH}" -H 'Content-Type: application/json' \
  -d '{"command":"id && uname -a && echo detonation-ok","network":"none","timeout":30}' | jq .

echo "== file input + tool =="
B64=$(printf 'hello world' | base64)
curl -fsS -X POST "${BASE}/api/exec" \
  -H "${AUTH}" -H 'Content-Type: application/json' \
  -d "{\"command\":\"sha256sum sample.txt; exiftool sample.txt || true\",\"network\":\"none\",\"timeout\":30,\"files\":[{\"name\":\"sample.txt\",\"b64\":\"${B64}\"}]}" | jq .

echo "== timeout enforcement =="
curl -fsS -X POST "${BASE}/api/exec" \
  -H "${AUTH}" -H 'Content-Type: application/json' \
  -d '{"command":"sleep 30","network":"none","timeout":5}' | jq '{timed_out, exit_code, duration_s}'

echo "== egress (opt-in) =="
curl -fsS -X POST "${BASE}/api/exec" \
  -H "${AUTH}" -H 'Content-Type: application/json' \
  -d '{"command":"curl -s -m 8 https://api.ipify.org || echo no-egress","network":"egress","timeout":20}' | jq '{ok, stdout}'
