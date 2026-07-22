#!/usr/bin/env bash
# Post-change regression check for the egress network + firewall.
# Run on the VPS after any change to the egress/firewall/network wiring.
#
#   CYBER_EXEC_TOKEN=... ./scripts/verify_egress.sh [base_url] [tailnet_peer_ip]
#
# Verifies, from an egress container on the dedicated network:
#   1. public works (by name + by IP); tailnet peer / metadata / RFC1918 /
#      MagicDNS all blocked.
#   2. docker build still resolves DNS (firewall no longer touches the default
#      bridge).
#   3. network=none is still zero-network (detonation).
#   4. egress container is actually on the dedicated subnet.
# Exits non-zero if any check fails.
set -uo pipefail

BASE="${1:-http://127.0.0.1:8000}"
PEER="${2:-100.64.0.1}"            # pass a real tailnet peer IP for a stronger test
: "${CYBER_EXEC_TOKEN:?set CYBER_EXEC_TOKEN}"
AUTH="Authorization: Bearer ${CYBER_EXEC_TOKEN}"
CT='Content-Type: application/json'
EGRESS_SUBNET_PREFIX="${EGRESS_SUBNET_PREFIX:-172.31.255.}"

fails=0
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails+1)); }

api() { # api <json-body> -> prints .stdout
  curl -s -X POST "$BASE/api/exec" -H "$AUTH" -H "$CT" -d "$1" | jq -r '.stdout // ""'
}

echo "== 1) egress container probes (dedicated network) =="
# One egress run emits labeled lines. No double-quotes inside (JSON-safe).
CMD='echo IP=$(hostname -i); echo PUBDNS=$(getent hosts api.ipify.org >/dev/null 2>&1 && echo OK || echo FAIL); p(){ s=$(date +%s); curl -s -m6 -o /dev/null http://$1/ 2>/dev/null; echo $2=rc$? t$(( $(date +%s)-s )); }; s=$(date +%s); curl -s -m8 -o /dev/null https://1.1.1.1 2>/dev/null; echo PUBIP=rc$? t$(( $(date +%s)-s )); p '"$PEER"' PEER; p 169.254.169.254 META; p 10.0.0.1 RFC1918; dig +timeout=5 +tries=1 @100.100.100.100 google.com >/dev/null 2>&1; echo MAGICDNS=rc$?'
OUT=$(api "{\"network\":\"egress\",\"timeout\":40,\"command\":\"$CMD\"}")
echo "$OUT" | sed 's/^/    /'

grep -q "IP=${EGRESS_SUBNET_PREFIX}" <<<"$OUT" && ok "egress on dedicated subnet (${EGRESS_SUBNET_PREFIX}x)" || bad "egress NOT on ${EGRESS_SUBNET_PREFIX}x"
grep -q "PUBDNS=OK"        <<<"$OUT" && ok "public DNS name resolves"          || bad "public DNS name failed"
grep -q "PUBIP=rc0"        <<<"$OUT" && ok "public by IP reachable"            || bad "public by IP failed"
grep -q "PEER=rc28"        <<<"$OUT" && ok "tailnet peer BLOCKED ($PEER)"      || bad "tailnet peer NOT blocked"
grep -q "META=rc28"        <<<"$OUT" && ok "metadata BLOCKED"                  || bad "metadata NOT blocked"
grep -q "RFC1918=rc28"     <<<"$OUT" && ok "RFC1918 BLOCKED"                   || bad "RFC1918 NOT blocked"
grep -q "MAGICDNS=rc9"     <<<"$OUT" && ok "MagicDNS BLOCKED"                  || bad "MagicDNS NOT blocked (rc!=9)"

echo "== 2) docker build DNS (must be unaffected by the egress firewall) =="
if printf 'FROM alpine:latest\nRUN nslookup github.com\n' \
     | docker build --no-cache -t cyberexec-verify-build -f - . >/tmp/cyberexec-build.log 2>&1; then
  ok "docker build resolved DNS"
else
  bad "docker build DNS FAILED (see /tmp/cyberexec-build.log)"; tail -5 /tmp/cyberexec-build.log | sed 's/^/    /'
fi
docker rmi -f cyberexec-verify-build >/dev/null 2>&1 || true

echo "== 3) network=none detonation (zero network) =="
NONE=$(api '{"network":"none","timeout":15,"command":"curl -s -m6 -o /dev/null https://1.1.1.1 2>/dev/null && echo NET || echo NONET; ip -o -4 addr show 2>/dev/null | grep -v \" lo \" | wc -l"}')
echo "$NONE" | sed 's/^/    /'
grep -q "NONET" <<<"$NONE" && ok "network=none has no internet" || bad "network=none reached the internet!"

echo
if [ "$fails" -eq 0 ]; then
  printf '\033[32mALL CHECKS PASSED\033[0m\n'; exit 0
else
  printf '\033[31m%d CHECK(S) FAILED\033[0m\n' "$fails"; exit 1
fi
