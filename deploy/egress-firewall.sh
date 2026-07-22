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
# Docker bridge interface egress containers attach to (--network bridge).
DOCKER_IFACE="${DOCKER_IFACE:-docker0}"

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

# HOST-LOCAL tailnet addresses (e.g. MagicDNS 100.100.100.100 and the host's
# own tailnet IP) are handled on the host's INPUT chain, NOT FORWARD, so the
# DOCKER-USER DROP above does NOT catch them. Without this a container could
# still query MagicDNS to enumerate tailnet peer names (recon). Drop container
# traffic (arriving on the docker bridge) to the whole tailnet range in INPUT.
V4_INPUT_BLOCK=("100.64.0.0/10")
V6_INPUT_BLOCK=("fd7a:115c:a1e0::/48")

rule_args() { echo -d "$1" -j DROP -m comment --comment "$MARK"; }
# DNS must keep working (name resolution for egress AND for docker builds),
# otherwise blocking RFC1918 also blocks a private resolver / the docker0
# gateway that forwards DNS. Allow port 53 to RETURN *above* the DROP rules.
dns_args() { echo -p "$1" --dport 53 -j RETURN -m comment --comment "$MARK-dns"; }
# CRITICAL: a container's own IP is in docker's 172.17.x range (inside the
# 172.16/12 DROP). Return packets of an ALLOWED outbound connection are
# addressed to that container IP, so without this they'd be dropped and even
# public-internet connections would never complete. Allow established/related
# return traffic ABOVE all DROPs; NEW outbound to private ranges still falls
# through to the DROP rules.
est_args() { echo -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN -m comment --comment "$MARK-est"; }
# Container -> host-local tailnet (MagicDNS etc.), matched on the INPUT chain.
input_args() { echo -i "$DOCKER_IFACE" -d "$1" -j DROP -m comment --comment "$MARK-hostlocal"; }

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
  # Inserted last -> ends up at the very TOP of the chain (above DNS + DROPs).
  if ! "$ipt" -C "$CHAIN" $(est_args) 2>/dev/null; then
    "$ipt" -I "$CHAIN" $(est_args); echo "  [$ipt] ALLOW established/related (RETURN, top)"
  fi
}

# Host-local tailnet block lives in INPUT (FORWARD/DOCKER-USER never sees
# traffic destined to an address that is local to the host, e.g. MagicDNS).
install_input() {
  local ipt="$1"; shift
  local nets=("$@")
  for net in "${nets[@]}"; do
    if ! "$ipt" -C INPUT $(input_args "$net") 2>/dev/null; then
      "$ipt" -I INPUT $(input_args "$net"); echo "  [$ipt] INPUT DROP ${DOCKER_IFACE} -> $net (host-local tailnet)"
    else
      echo "  [$ipt] INPUT already present -> $net"
    fi
  done
}

remove_input() {
  local ipt="$1"; shift
  local nets=("$@")
  for net in "${nets[@]}"; do
    while "$ipt" -C INPUT $(input_args "$net") 2>/dev/null; do
      "$ipt" -D INPUT $(input_args "$net"); echo "  [$ipt] removed INPUT -> $net"
    done
  done
}

remove_rules() {
  local ipt="$1"; shift
  local nets=("$@")
  ensure_chain "$ipt" || return 0
  while "$ipt" -C "$CHAIN" $(est_args) 2>/dev/null; do
    "$ipt" -D "$CHAIN" $(est_args); echo "  [$ipt] removed established/related"
  done
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
    install_input iptables "${V4_INPUT_BLOCK[@]}"
    if command -v ip6tables >/dev/null 2>&1; then
      install_rules ip6tables "${V6_BLOCK[@]}"
      install_input ip6tables "${V6_INPUT_BLOCK[@]}"
    fi
    echo "Done. Egress containers can resolve DNS + reach the public internet only."
    ;;
  remove)
    echo "Removing $MARK rules ..."
    remove_rules iptables "${V4_BLOCK[@]}"
    remove_input iptables "${V4_INPUT_BLOCK[@]}"
    if command -v ip6tables >/dev/null 2>&1; then
      remove_rules ip6tables "${V6_BLOCK[@]}"
      remove_input ip6tables "${V6_INPUT_BLOCK[@]}"
    fi
    echo "Done."
    ;;
  status)
    echo "=== $CHAIN (FORWARD) ==="; iptables -n -L "$CHAIN" --line-numbers || true
    echo "=== INPUT (host-local, $MARK-hostlocal only) ==="
    iptables -n -L INPUT --line-numbers | grep -E "NUM|$MARK-hostlocal" || true
    if command -v ip6tables >/dev/null 2>&1; then
      echo "--- IPv6 $CHAIN ---"; ip6tables -n -L "$CHAIN" --line-numbers || true
      echo "--- IPv6 INPUT ---"; ip6tables -n -L INPUT --line-numbers | grep -E "NUM|$MARK-hostlocal" || true
    fi
    ;;
  *)
    echo "usage: $0 {install|remove|status}" >&2; exit 2 ;;
esac
