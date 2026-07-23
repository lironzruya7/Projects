#!/usr/bin/env bash
# Restrict SSH to the tailnet only (drop public TCP 22), with a built-in
# "tailnet reachable?" pre-check and a dead-man's-switch auto-rollback so you
# can't lock yourself out. Run as root ON THE VPS.
#
#   sudo ./deploy/lockdown-ssh.sh check        # is the tailnet path usable? (no changes)
#   sudo ./deploy/lockdown-ssh.sh lockdown     # apply, with a GRACE-second auto-revert
#   sudo ./deploy/lockdown-ssh.sh confirm      # you verified tailnet SSH → cancel the auto-revert
#   sudo ./deploy/lockdown-ssh.sh rollback     # remove the lockdown (public SSH back)
#   sudo ./deploy/lockdown-ssh.sh persist      # make it survive reboot (netfilter-persistent)
#   sudo ./deploy/lockdown-ssh.sh status
#
# ALWAYS keep the Hostinger web console (VNC/serial) open as an out-of-band
# lifeline, and disable Tailscale key expiry for this node, before locking down.
# This only touches TCP $SSH_PORT — Tailscale (UDP), `tailscale serve` → /api/exec
# (tailscale0:443), and the egress firewall/VPN are untouched.
set -euo pipefail

SSH_PORT="${SSH_PORT:-22}"
TS_IFACE="${TS_IFACE:-tailscale0}"
GRACE="${GRACE:-180}"                       # seconds before auto-rollback unless confirmed
MARK="cyber-ssh-lockdown"
SCRIPT="$(readlink -f "$0")"
CONFIRM=/run/cyber-ssh-confirmed
DEADMAN=/run/cyber-ssh-deadman.pid

need_root() { [ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }; }

c() { echo -m comment --comment "$MARK"; }   # common comment args
lo_rule()   { echo -i lo           -p tcp --dport "$SSH_PORT" -j ACCEPT $(c); }
ts_rule()   { echo -i "$TS_IFACE"  -p tcp --dport "$SSH_PORT" -j ACCEPT $(c); }
est_rule()  { echo -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT $(c); }
drop_rule() { echo               -p tcp --dport "$SSH_PORT" -j DROP   $(c); }

# tailnet reachable? interface up + has an IPv4 + tailscaled reporting up.
tailnet_ok() {
  ip -o -4 addr show dev "$TS_IFACE" 2>/dev/null | grep -q 'inet ' || return 1
  command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1 || return 1
  return 0
}

add_top() { iptables -C INPUT $1 2>/dev/null || iptables -I INPUT 1 $1; }
add_end() { iptables -C INPUT $1 2>/dev/null || iptables -A INPUT $1; }
del_all() { while iptables -C INPUT $1 2>/dev/null; do iptables -D INPUT $1; done; }

case "${1:-}" in
  check)
    if tailnet_ok; then
      ip=$(ip -o -4 addr show dev "$TS_IFACE" | awk '{print $4}' | cut -d/ -f1)
      echo "OK: $TS_IFACE up, tailnet IP $ip, tailscaled reporting up."
      echo "    Verify from another tailnet node:  ssh root@$ip"
    else
      echo "NOT SAFE: $TS_IFACE has no IPv4 or tailscaled is down — do NOT lock down." >&2
      exit 1
    fi
    ;;

  lockdown)
    need_root
    tailnet_ok || { echo "REFUSING: tailnet path not usable (would lock you out). Fix Tailscale first." >&2; exit 1; }
    echo "Applying SSH lockdown (public TCP $SSH_PORT dropped; $TS_IFACE + lo allowed) ..."
    # ACCEPTs first (top of chain), DROP last.
    add_top "$(est_rule)"; add_top "$(ts_rule)"; add_top "$(lo_rule)"
    add_end "$(drop_rule)"
    # Dead-man's switch: auto-rollback after GRACE unless 'confirm' ran.
    rm -f "$CONFIRM"
    setsid bash -c "sleep $GRACE; [ -f '$CONFIRM' ] || bash '$SCRIPT' rollback" </dev/null >/dev/null 2>&1 &
    echo $! > "$DEADMAN"
    echo "Dead-man's switch armed: auto-rollback in ${GRACE}s unless you confirm."
    echo "  1) From another terminal / tailnet node:  ssh root@<tailnet-ip>"
    echo "  2) If it works:  sudo $SCRIPT confirm     (then: sudo $SCRIPT persist)"
    echo "  If you get locked out, do nothing — it reverts in ${GRACE}s (or use the Hostinger console)."
    ;;

  confirm)
    need_root
    touch "$CONFIRM"
    [ -f "$DEADMAN" ] && kill "$(cat "$DEADMAN")" 2>/dev/null || true
    rm -f "$DEADMAN"
    echo "Confirmed — auto-rollback cancelled. Lockdown holds for this boot."
    echo "Run 'sudo $SCRIPT persist' to survive reboot."
    ;;

  rollback)
    # no need_root guard here so the dead-man's switch (root child) always works
    del_all "$(drop_rule)"; del_all "$(lo_rule)"; del_all "$(ts_rule)"; del_all "$(est_rule)"
    rm -f "$CONFIRM" "$DEADMAN"
    echo "Rolled back — public SSH on TCP $SSH_PORT is allowed again."
    ;;

  persist)
    need_root
    if command -v netfilter-persistent >/dev/null 2>&1; then
      netfilter-persistent save && echo "Saved via netfilter-persistent (survives reboot)."
    else
      echo "Install iptables-persistent first:  apt-get install -y iptables-persistent"
      echo "then re-run:  sudo $SCRIPT persist   (or block TCP $SSH_PORT in the Hostinger panel)."
      exit 1
    fi
    ;;

  status)
    echo "=== INPUT rules ($MARK) ==="
    iptables -n -v -L INPUT --line-numbers | grep -E "pkts|$MARK" || echo "  (none — not locked down)"
    echo "=== tailnet ==="; tailnet_ok && echo "  $TS_IFACE up" || echo "  $TS_IFACE NOT usable"
    [ -f "$DEADMAN" ] && echo "=== dead-man's switch ARMED (pid $(cat "$DEADMAN")) — run 'confirm' ===" || true
    ;;

  *)
    echo "usage: $0 {check|lockdown|confirm|rollback|persist|status}" >&2; exit 2 ;;
esac
