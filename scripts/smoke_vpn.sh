#!/usr/bin/env bash
# Smoke test for VPN egress (iVPN/WireGuard) — run as root on the VPS AFTER
# `vpn-egress.sh up`. Verifies the egress network exits via the VPN, the host
# does not, the kill-switch is fail-closed, isolation is intact, and neither
# Tailscale nor the OS -> /api/exec path was broken.
#
#   CYBER_EXEC_TOKEN=... sudo -E ./scripts/smoke_vpn.sh [base_url] [wg_iface]
set -uo pipefail

BASE="${1:-http://127.0.0.1:8000}"
WG_IFACE="${2:-wg0}"
: "${CYBER_EXEC_TOKEN:?set CYBER_EXEC_TOKEN}"
AUTH="Authorization: Bearer ${CYBER_EXEC_TOKEN}"; CT='Content-Type: application/json'
IPSVC="https://ifconfig.me"
fails=0
ok()  { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails+1)); }
egress_ip() { curl -s -X POST "$BASE/api/exec" -H "$AUTH" -H "$CT" \
  -d "{\"network\":\"egress\",\"timeout\":25,\"command\":\"curl -s -m10 $IPSVC\"}" | jq -r '.stdout' | tr -d '[:space:]'; }

echo "== 1) egress exits via VPN, host does not =="
HOST_IP=$(curl -s -m10 "$IPSVC" | tr -d '[:space:]')
EGR_IP=$(egress_ip)
echo "    host_ip=$HOST_IP   egress_ip=$EGR_IP"
[ -n "$EGR_IP" ] && ok "egress reaches internet ($EGR_IP)" || bad "egress got no IP"
[ -n "$EGR_IP" ] && [ "$EGR_IP" != "$HOST_IP" ] && ok "egress IP != host IP (exiting via VPN)" || bad "egress IP == host IP (NOT via VPN!)"

echo "== 2) kill-switch is fail-closed (tunnel down => zero egress, no leak) =="
echo "    bringing $WG_IFACE down..."
wg-quick down "$WG_IFACE" >/dev/null 2>&1 || true
DOWN_IP=$(egress_ip)
if [ -z "$DOWN_IP" ]; then ok "egress blocked while tunnel down (no fallback to real IP)"; \
  else bad "LEAK: egress still reachable while tunnel down (got $DOWN_IP)"; fi
echo "    bringing $WG_IFACE back up..."
wg-quick up "$WG_IFACE" >/dev/null 2>&1 || true
sleep 2
UP_IP=$(egress_ip)
[ -n "$UP_IP" ] && [ "$UP_IP" != "$HOST_IP" ] && ok "egress restored via VPN ($UP_IP)" || bad "egress did not recover after tunnel up"

echo "== 3) isolation still intact (tailnet / metadata blocked from egress) =="
ISO=$(curl -s -X POST "$BASE/api/exec" -H "$AUTH" -H "$CT" -d '{"network":"egress","timeout":25,"command":"s=$(date +%s); curl -s -m6 -o /dev/null http://169.254.169.254/ 2>/dev/null; echo META_rc=$? t$(( $(date +%s)-s )); dig +timeout=5 +tries=1 @100.100.100.100 x >/dev/null 2>&1; echo MAGICDNS_rc=$?"}' | jq -r '.stdout')
echo "$ISO" | sed 's/^/    /'
grep -q "META_rc=28" <<<"$ISO" && ok "metadata still blocked" || bad "metadata reachable"
grep -q "MAGICDNS_rc=9" <<<"$ISO" && ok "MagicDNS still blocked" || bad "MagicDNS reachable"

echo "== 4) Tailscale + OS -> /api/exec path survived (host route intact) =="
if command -v tailscale >/dev/null 2>&1; then
  tailscale status >/dev/null 2>&1 && ok "tailscale status up" || bad "tailscale DOWN — default route may have been hijacked"
else echo "    (tailscale CLI not found — skipping)"; fi
OSCHK=$(curl -s -X POST "$BASE/api/exec" -H "$AUTH" -H "$CT" -d '{"network":"none","timeout":15,"command":"echo api-ok uid=$(id -u)"}' | jq -r '.stdout')
grep -q "api-ok" <<<"$OSCHK" && ok "OS still reaches /api/exec (cyber_exec runs)" || bad "/api/exec not reachable"

echo
[ "$fails" -eq 0 ] && { printf '\033[32mVPN EGRESS: ALL CHECKS PASSED\033[0m\n'; exit 0; } \
                   || { printf '\033[31m%d CHECK(S) FAILED\033[0m\n' "$fails"; exit 1; }
