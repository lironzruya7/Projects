#!/usr/bin/env bash
# Route the cyber-exec egress network (172.31.255.0/24) out through iVPN
# (WireGuard), fail-closed, WITHOUT touching the host default route / Tailscale /
# the OS -> /api/exec path. Run as root on the VPS.
#
#   sudo ./deploy/vpn-egress.sh install     # apt install wireguard-tools (no keys)
#   sudo ./deploy/vpn-egress.sh dry-run     # validate ip-rule + kill-switch logic (no keys, non-mutating)
#   sudo ./deploy/vpn-egress.sh up          # bring tunnel up + enable kill-switch (needs real wg0.conf)
#   sudo ./deploy/vpn-egress.sh down        # tunnel down (kill-switch STAYS = no leak)
#   sudo ./deploy/vpn-egress.sh status
#
# Build order: run `install` + `dry-run` now (scaffolding). The owner drops the
# real iVPN keys into /etc/wireguard/wg0.conf last, then runs `up`.
set -euo pipefail

WG_IFACE="${WG_IFACE:-wg0}"
WG_CONF="/etc/wireguard/${WG_IFACE}.conf"
EGRESS_SUBNET="${EGRESS_SUBNET:-172.31.255.0/24}"
TABLE="${WG_TABLE:-51820}"
RULE_PREF="${WG_RULE_PREF:-1000}"
ENV_DIR="/etc/cyber-exec"
ENV_FILE="${ENV_DIR}/egress.env"
FW="$(dirname "$0")/egress-firewall.sh"

need_root() { [ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }; }

write_env() {  # persist the toggle so egress-firewall.service re-applies the kill-switch
  mkdir -p "$ENV_DIR"
  printf 'EGRESS_VPN=%s\nWG_IFACE=%s\nEGRESS_SUBNET=%s\n' "$1" "$WG_IFACE" "$EGRESS_SUBNET" > "$ENV_FILE"
  echo "wrote $ENV_FILE (EGRESS_VPN=$1)"
}

case "${1:-}" in
  install)
    need_root
    apt-get update
    apt-get install -y --no-install-recommends wireguard-tools
    mkdir -p "$ENV_DIR"
    echo "wireguard-tools installed. Place your iVPN config at $WG_CONF (see deploy/wg0.conf.example),"
    echo "then run: sudo $0 up"
    ;;

  dry-run)
    need_root
    echo "== validating routing + kill-switch logic (no tunnel, non-mutating) =="
    echo "-- ip rule add/del (source-scoped, pref $RULE_PREF, table $TABLE) --"
    ip rule add pref "$RULE_PREF" from "$EGRESS_SUBNET" lookup "$TABLE"
    ip rule show | grep -E "\b${RULE_PREF}:" || true
    ip rule del pref "$RULE_PREF" from "$EGRESS_SUBNET" lookup "$TABLE"
    echo "   OK (rule adds & deletes cleanly; below Tailscale's ~5210)"
    echo "-- kill-switch iptables syntax (temp chain, then discarded) --"
    iptables -N CYBEREXEC_KS_TEST 2>/dev/null || iptables -F CYBEREXEC_KS_TEST
    iptables -A CYBEREXEC_KS_TEST -s "$EGRESS_SUBNET" ! -o "$WG_IFACE" -j DROP
    iptables -A CYBEREXEC_KS_TEST -t nat -s "$EGRESS_SUBNET" -o "$WG_IFACE" -j MASQUERADE 2>/dev/null || true
    echo "   OK (kill-switch rule is syntactically valid)"
    iptables -F CYBEREXEC_KS_TEST; iptables -X CYBEREXEC_KS_TEST
    echo "-- config presence --"
    if grep -q '<OWNER_PRIVATE_KEY' "$WG_CONF" 2>/dev/null; then
      echo "   $WG_CONF is still the PLACEHOLDER — fill in real iVPN keys before 'up'."
    elif [ -f "$WG_CONF" ]; then
      echo "   $WG_CONF present (looks populated)."
    else
      echo "   $WG_CONF not present yet (expected during scaffolding)."
    fi
    echo "== dry-run OK — scaffolding is valid. =="
    ;;

  up)
    need_root
    [ -f "$WG_CONF" ] || { echo "missing $WG_CONF (copy deploy/wg0.conf.example, add iVPN keys)" >&2; exit 1; }
    grep -q '<OWNER_PRIVATE_KEY' "$WG_CONF" && { echo "$WG_CONF still has placeholder keys" >&2; exit 1; }
    write_env 1
    echo "== bringing up $WG_IFACE =="
    wg-quick up "$WG_IFACE" || { echo "wg-quick up failed" >&2; exit 1; }
    systemctl enable "wg-quick@${WG_IFACE}" >/dev/null 2>&1 || true
    echo "== enabling fail-closed kill-switch via egress-firewall =="
    EGRESS_VPN=1 WG_IFACE="$WG_IFACE" EGRESS_SUBNET="$EGRESS_SUBNET" bash "$FW" install
    echo "== MTU / MSS belt-and-suspenders (the egress network MTU is the real"
    echo "   fix — set SEC_TOOLBOX_EGRESS_MTU=1280 in the app .env; these are backup) =="
    ip link set dev "$WG_IFACE" mtu "${WG_MTU:-1280}" 2>/dev/null || true
    # Clamp TCP MSS in BOTH directions on the tunnel (--tcp-flags SYN,RST SYN
    # matches SYN *and* SYN-ACK; a --syn-only rule misses the server's SYN-ACK
    # and the container keeps sending oversized segments).
    for dir in "-o $WG_IFACE" "-i $WG_IFACE"; do
      iptables -t mangle -C FORWARD $dir -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu -m comment --comment cyber-exec-mss 2>/dev/null \
        || iptables -t mangle -A FORWARD $dir -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu -m comment --comment cyber-exec-mss
    done
    # Masquerade egress-subnet traffic to the tunnel IP, ahead of docker's rule.
    iptables -t nat -C POSTROUTING -s "$EGRESS_SUBNET" -o "$WG_IFACE" -j MASQUERADE -m comment --comment cyber-exec-vpn-nat 2>/dev/null \
      || iptables -t nat -I POSTROUTING 1 -s "$EGRESS_SUBNET" -o "$WG_IFACE" -j MASQUERADE -m comment --comment cyber-exec-vpn-nat
    # Disable offload on the egress bridge (best-effort; bridge name is dynamic).
    PREFIX=$(echo "$EGRESS_SUBNET" | cut -d/ -f1 | cut -d. -f1-3)
    BR=$(ip -o -4 addr show 2>/dev/null | awk -v p="${PREFIX}." '$4 ~ ("^" p) {print $2; exit}')
    [ -n "$BR" ] && ethtool -K "$BR" gro off gso off tso off 2>/dev/null || true
    echo "== done. Verify: sudo $0 status  &&  scripts/smoke_vpn.sh =="
    ;;

  down)
    need_root
    echo "== bringing down $WG_IFACE (kill-switch stays — egress fails closed) =="
    wg-quick down "$WG_IFACE" || true
    echo "NOTE: kill-switch left in place (no leak). To fully disable VPN egress:"
    echo "  sudo $0 disable"
    ;;

  disable)
    need_root
    wg-quick down "$WG_IFACE" 2>/dev/null || true
    write_env 0
    EGRESS_VPN=0 WG_IFACE="$WG_IFACE" EGRESS_SUBNET="$EGRESS_SUBNET" bash "$FW" install
    systemctl disable "wg-quick@${WG_IFACE}" >/dev/null 2>&1 || true
    echo "VPN egress disabled; kill-switch removed; egress back to direct internet-only."
    ;;

  status)
    echo "=== wg $WG_IFACE ==="; wg show "$WG_IFACE" 2>/dev/null || echo "  (down)"
    echo "=== ip rule (egress source rule) ==="; ip rule show | grep -E "from ${EGRESS_SUBNET%/*}" || echo "  (none)"
    echo "=== table $TABLE ==="; ip route show table "$TABLE" 2>/dev/null || echo "  (empty)"
    EGRESS_VPN=1 WG_IFACE="$WG_IFACE" EGRESS_SUBNET="$EGRESS_SUBNET" bash "$FW" status | sed -n '/kill-switch/,$p'
    ;;

  *)
    echo "usage: $0 {install|dry-run|up|down|disable|status}" >&2; exit 2 ;;
esac
