#!/usr/bin/env bash
# cyber-exec egress firewall (F1).
#
# In network=="egress" mode a container uses plain Docker bridge networking,
# which routes through the host — so it can reach the operator's TAILNET
# (100.64.0.0/10), the private LAN (RFC1918) and cloud metadata (169.254/16),
# not just the public internet. This installs DROP rules in the DOCKER-USER
# iptables chain so bridged containers can reach ONLY the public internet.
#
# It does NOT affect network=="none" runs (they have no network at all).
#
# Usage (run as root ON THE VPS):
#   sudo ./deploy/egress-firewall.sh install     # add the rules (idempotent)
#   sudo ./deploy/egress-firewall.sh remove      # remove them
#   sudo ./deploy/egress-firewall.sh status      # show current DOCKER-USER
#
# Persistence: iptables rules do not survive reboot. Persist with e.g.
#   apt-get install iptables-persistent && netfilter-persistent save
# or re-run this script from a boot unit.
set -euo pipefail

CHAIN="DOCKER-USER"
MARK="cyber-exec-egress"

# Destinations a bridged container must NOT reach (private / tailnet / metadata).
V4_BLOCK=(
  "100.64.0.0/10"     # Tailscale CGNAT (tailnet peers + MagicDNS 100.100.100.100)
  "10.0.0.0/8"        # RFC1918
  "172.16.0.0/12"     # RFC1918 (incl. docker networks / docker0 gateway)
  "192.168.0.0/16"    # RFC1918
  "169.254.0.0/16"    # link-local incl. cloud metadata 169.254.169.254
)
V6_BLOCK=(
  "fd7a:115c:a1e0::/48"  # Tailscale ULA
  "fc00::/7"             # unique local addresses
  "fe80::/10"            # link-local
)

rule_args() { echo -d "$1" -j DROP -m comment --comment "$MARK"; }
# DNS must keep working (name resolution for egress AND for docker builds),
# otherwise blocking RFC1918 also blocks a private resolver / the docker0
# gateway that forwards DNS. Allow port 53 to RETURN *above* the DROP rules.
dns_args() { echo -p "$1" --dport 53 -j RETURN -m comment --comment "$MARK-dns"; }

ensure_chain() {
  local ipt="$1"
  if ! "$ipt" -n -L "$CHAIN" >/dev/null 2>&1; then
    echo "ERROR: $ipt chain $CHAIN not found — is Docker installed/running?" >&2
    return 1
  fi
}

# Insert the DROP rules (they land at the top of the chain, above docker's
# trailing RETURN), then insert the DNS RETURN rules AFTER — so DNS ends up
# ABOVE the DROPs and is evaluated first.
install_rules() {
  local ipt="$1"; shift
  local nets=("$@")
  ensure_chain "$ipt" || return 0
  for net in "${nets[@]}"; do
    if ! "$ipt" -C "$CHAIN" $(rule_args "$net") 2>/dev/null; then
      "$ipt" -I "$CHAIN" $(rule_args "$net"); echo "  [$ipt] DROP -> $net"
    else
      echo "  [$ipt] already present -> $net"
    fi
  done
  for proto in udp tcp; do
    if ! "$ipt" -C "$CHAIN" $(dns_args "$proto") 2>/dev/null; then
      "$ipt" -I "$CHAIN" $(dns_args "$proto"); echo "  [$ipt] ALLOW dns/$proto (RETURN, above DROPs)"
    fi
  done
}

remove_rules() {
  local ipt="$1"; shift
  local nets=("$@")
  ensure_chain "$ipt" || return 0
  for proto in udp tcp; do
    while "$ipt" -C "$CHAIN" $(dns_args "$proto") 2>/dev/null; do
      "$ipt" -D "$CHAIN" $(dns_args "$proto"); echo "  [$ipt] removed dns/$proto"
    done
  done
  for net in "${nets[@]}"; do
    while "$ipt" -C "$CHAIN" $(rule_args "$net") 2>/dev/null; do
      "$ipt" -D "$CHAIN" $(rule_args "$net"); echo "  [$ipt] removed -> $net"
    done
  done
}

case "${1:-install}" in
  install)
    echo "Installing $MARK rules into $CHAIN (DNS allowed, private ranges dropped) ..."
    install_rules iptables "${V4_BLOCK[@]}"
    command -v ip6tables >/dev/null 2>&1 && install_rules ip6tables "${V6_BLOCK[@]}" || true
    echo "Done. Egress containers can resolve DNS + reach the public internet only."
    ;;
  remove)
    echo "Removing $MARK rules ..."
    remove_rules iptables "${V4_BLOCK[@]}"
    command -v ip6tables >/dev/null 2>&1 && remove_rules ip6tables "${V6_BLOCK[@]}" || true
    echo "Done."
    ;;
  status)
    iptables -n -L "$CHAIN" --line-numbers || true
    command -v ip6tables >/dev/null 2>&1 && { echo "--- IPv6 ---"; ip6tables -n -L "$CHAIN" --line-numbers || true; }
    ;;
  *)
    echo "usage: $0 {install|remove|status}" >&2; exit 2 ;;
esac
