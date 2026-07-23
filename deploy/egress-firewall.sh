#!/usr/bin/env bash
# cyber-exec egress firewall (F1) — source-scoped to the dedicated egress net.
#
# cyber-exec runs network=="egress" containers on their OWN docker network
# (cyberexec-egress, subnet 172.31.255.0/24 by default — created by the app).
# That network routes through the host, so without filtering a container could
# reach the operator's TAILNET (100.64.0.0/10), the private LAN (RFC1918) and
# cloud metadata (169.254/16), not just the public internet.
#
# This script restricts ONLY that network (matched by SOURCE subnet) to the
# public internet. Because rules are scoped by source, `docker build` and any
# other containers on other networks are never affected, and reply traffic
# (whose source is the internet, not the egress subnet) is never dropped.
#
#   sudo ./deploy/egress-firewall.sh install|remove|status
#
# VPN kill-switch: set EGRESS_VPN=1 (usually via /etc/cyber-exec/egress.env,
# managed by deploy/vpn-egress.sh) to additionally drop any egress-subnet packet
# not leaving via $WG_IFACE — fail-closed VPN egress. Default off.
#
# EGRESS_SUBNET MUST match the app's SEC_TOOLBOX_EGRESS_SUBNET.
# Persistence: rules do not survive reboot / docker restart — use
# deploy/egress-firewall.service (PartOf=docker.service) to re-apply them.
set -euo pipefail

CHAIN="DOCKER-USER"
MARK="cyber-exec-egress"
EGRESS_SUBNET="${EGRESS_SUBNET:-172.31.255.0/24}"

# VPN kill-switch (fail-closed). When EGRESS_VPN=1, egress-subnet traffic is
# ALLOWED only if it leaves via the WireGuard interface ($WG_IFACE); anything
# else is dropped — so if the tunnel is down there is ZERO egress (no leak to
# the real IP), never a fallback. This rule is deliberately independent of the
# wg0 interface lifecycle (NOT in wg-quick PostDown) so it survives the tunnel
# going down. Default off, so pushing this changes nothing until you enable it.
EGRESS_VPN="${EGRESS_VPN:-0}"
WG_IFACE="${WG_IFACE:-wg0}"

# Destinations an egress container must NOT reach (private / tailnet / metadata).
V4_BLOCK=(
  "100.64.0.0/10"     # Tailscale CGNAT (tailnet peers)
  "10.0.0.0/8"        # RFC1918
  "172.16.0.0/12"     # RFC1918 (incl. docker networks / gateways)
  "192.168.0.0/16"    # RFC1918
  "169.254.0.0/16"    # link-local incl. cloud metadata 169.254.169.254
)
# Host-local tailnet (e.g. MagicDNS 100.100.100.100) is intercepted/DNAT'd by
# tailscale in nat PREROUTING BEFORE DOCKER-USER (FORWARD) and before INPUT, so
# it must be dropped in the raw PREROUTING hook (runs before conntrack/nat).
RAW_BLOCK=("100.64.0.0/10")

# --network none containers have NO network, so they are never affected here.

drop_args() { echo -s "$EGRESS_SUBNET" -d "$1" -j DROP -m comment --comment "$MARK"; }
raw_args()  { echo -s "$EGRESS_SUBNET" -d "$1" -j DROP -m comment --comment "$MARK-hostlocal"; }
# Kill-switch: drop egress-subnet packets NOT leaving via the WG interface.
# (Return traffic has source=internet, so it never matches -s $EGRESS_SUBNET.)
ks_args()   { echo -s "$EGRESS_SUBNET" ! -o "$WG_IFACE" -j DROP -m comment --comment "$MARK-killswitch"; }

ks_add() {
  if ! iptables -C "$CHAIN" $(ks_args) 2>/dev/null; then
    iptables -I "$CHAIN" $(ks_args); echo "  KILL-SWITCH: DROP $EGRESS_SUBNET not via $WG_IFACE (fail-closed)"
  else
    echo "  kill-switch already present"
  fi
}
ks_del() {
  while iptables -C "$CHAIN" $(ks_args) 2>/dev/null; do
    iptables -D "$CHAIN" $(ks_args); echo "  removed kill-switch ($WG_IFACE)"
  done
}

ensure_chain() {
  if ! iptables -n -L "$CHAIN" >/dev/null 2>&1; then
    echo "ERROR: iptables chain $CHAIN not found — is Docker installed/running?" >&2
    return 1
  fi
}

install_all() {
  ensure_chain || return 1
  echo "Scoping egress firewall to source subnet $EGRESS_SUBNET"
  for net in "${V4_BLOCK[@]}"; do
    if ! iptables -C "$CHAIN" $(drop_args "$net") 2>/dev/null; then
      iptables -I "$CHAIN" $(drop_args "$net"); echo "  DOCKER-USER DROP $EGRESS_SUBNET -> $net"
    else
      echo "  already present -> $net"
    fi
  done
  for net in "${RAW_BLOCK[@]}"; do
    if ! iptables -t raw -C PREROUTING $(raw_args "$net") 2>/dev/null; then
      iptables -t raw -I PREROUTING $(raw_args "$net"); echo "  raw/PREROUTING DROP $EGRESS_SUBNET -> $net (host-local tailnet)"
    else
      echo "  raw already present -> $net"
    fi
  done
  # VPN kill-switch: add when enabled, remove when disabled (idempotent toggle).
  if [ "$EGRESS_VPN" = "1" ]; then ks_add; else ks_del; fi
}

remove_all() {
  ensure_chain || return 1
  for net in "${V4_BLOCK[@]}"; do
    while iptables -C "$CHAIN" $(drop_args "$net") 2>/dev/null; do
      iptables -D "$CHAIN" $(drop_args "$net"); echo "  removed DOCKER-USER -> $net"
    done
  done
  for net in "${RAW_BLOCK[@]}"; do
    while iptables -t raw -C PREROUTING $(raw_args "$net") 2>/dev/null; do
      iptables -t raw -D PREROUTING $(raw_args "$net"); echo "  removed raw/PREROUTING -> $net"
    done
  done
  ks_del
}

case "${1:-install}" in
  install)
    echo "Installing $MARK rules (egress subnet $EGRESS_SUBNET -> internet only) ..."
    install_all
    echo "Done."
    ;;
  remove)
    echo "Removing $MARK rules ..."
    remove_all
    echo "Done."
    ;;
  status)
    echo "=== $CHAIN (source $EGRESS_SUBNET) ==="
    iptables -n -v -L "$CHAIN" --line-numbers | grep -E "pkts|$MARK" || true
    echo "=== raw/PREROUTING (host-local tailnet) ==="
    iptables -t raw -n -v -L PREROUTING --line-numbers | grep -E "pkts|$MARK-hostlocal" || true
    echo "=== VPN kill-switch (EGRESS_VPN=$EGRESS_VPN, iface $WG_IFACE) ==="
    iptables -n -v -L "$CHAIN" --line-numbers | grep -E "pkts|$MARK-killswitch" || echo "  (not installed)"
    ;;
  *)
    echo "usage: $0 {install|remove|status}" >&2; exit 2 ;;
esac
