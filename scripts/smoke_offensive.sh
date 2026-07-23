#!/usr/bin/env bash
# Smoke test for the offensive tooling added to sec-toolbox:latest.
# Run on the VPS after rebuilding the base image + restarting the service.
#
#   CYBER_EXEC_TOKEN=... ./scripts/smoke_offensive.sh [base_url] [authorized_target]
#
# authorized_target: a host/URL YOU are authorized to scan and that is inside
# your OS-side scope (default: scanme.nmap.org, provided by nmap for testing).
set -uo pipefail

BASE="${1:-http://127.0.0.1:8000}"
TARGET="${2:-scanme.nmap.org}"
: "${CYBER_EXEC_TOKEN:?set CYBER_EXEC_TOKEN}"
AUTH="Authorization: Bearer ${CYBER_EXEC_TOKEN}"
CT='Content-Type: application/json'

api() { curl -s -X POST "$BASE/api/exec" -H "$AUTH" -H "$CT" -d "$1"; }
show() { jq -r '.stdout, (.stderr|select(.!=""))' 2>/dev/null || cat; }

echo "############ (1) every binary runs in base (network=none) ############"
api '{"network":"none","timeout":60,"command":"for t in \"nuclei -version\" \"ffuf -V\" \"sqlmap --version\" \"feroxbuster -V\" \"whatweb --version\" \"hydra -h\"; do echo \"== $t ==\"; eval $t 2>&1 | head -2; done"}' | show

echo "############ (2) nuclei templates baked + usable OFFLINE (network=none) ############"
api '{"network":"none","timeout":60,"command":"echo NUCLEI_TEMPLATES=$NUCLEI_TEMPLATES; n=$(find $NUCLEI_TEMPLATES -name *.yaml 2>/dev/null | wc -l); echo TEMPLATE_YAML_COUNT=$n; nuclei -t $NUCLEI_TEMPLATES -tl -disable-update-check 2>/dev/null | head -3; [ $n -gt 0 ] && echo TEMPLATES=OK || echo TEMPLATES=EMPTY"}' | show
echo "  expect: TEMPLATE_YAML_COUNT > 0 and TEMPLATES=OK"

echo "############ (3) authorized egress scan returns results (network=egress) ############"
echo "  target: $TARGET  (must be inside your OS-side scope; egress is approval-gated)"
api "{\"network\":\"egress\",\"timeout\":180,\"command\":\"whatweb --color=never $TARGET 2>&1 | head -5; echo ---; nuclei -u $TARGET -t \$NUCLEI_TEMPLATES -disable-update-check -silent -rate-limit 20 2>/dev/null | head -15; echo SCAN-DONE\"}" | show

echo "############ (4) re-verify hardening (non-root + --network none has no net) ############"
api '{"network":"none","timeout":30,"command":"echo uid=$(id -u) user=$(id -un); (curl -m5 -sSI https://example.com >/dev/null 2>&1 && echo NET-REACHABLE || echo NET-UNREACHABLE)"}' | show
echo "  expect: uid != 0, NET-UNREACHABLE  (--rm is enforced by the service on every run)"
