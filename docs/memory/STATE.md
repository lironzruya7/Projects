# STATE.md — live deployment state (READ FIRST)

Append-only log of what's deployed, current HEAD, open items, and rollback.
Update at each stop-point; add new entries at the top of History, don't rewrite.

## Deployed now
- **main @ `d5b23cb`** (PR #1 merged) is the deployed baseline on `srv1848452`.
- Hardened exec service: loopback+tailnet, constant-time bearer, rate-limit +
  concurrency cap (3). Ephemeral container: `network=none` default, `--cap-drop
  ALL`, non-root, `--rm`, rlimits, startup sweep.
- **sec-toolbox (base)** built & smoked: recon/forensics + offensive (nuclei +
  ~13.4k templates baked offline, ffuf, feroxbuster, hydra, sqlmap, whatweb).
- **sec-toolbox-heavy (opt-in)** built & smoked: Ghidra headless + Volatility3.
- **Egress firewall** source-scoped (internet-only) + boot unit — live, verified.
- **VPN egress via iVPN** live & smoked: exits iVPN IP `64.120.120.239` region,
  kill-switch fail-closed, Tailscale + `/api/exec` intact, egress net MTU 1280,
  `SEC_TOOLBOX_EGRESS_DNS=1.1.1.1` set on the box.
- All smoke/verify scripts passing live.

## Repo state
- Working branch: `claude/hardened-exec-agent-8a3obd`.
- Docs commit (CLAUDE.md + reorganized README + this STATE.md + SessionStart
  hook) is on the branch, **ahead of merged `main`** — open a PR to merge if wanted.

## Open / future (do ONLY if the owner relays a spec)
- **Volatility3 symbol-seed** — populate a matching Linux ISF into a cache
  OFFLINE (analysis runs `network=none`, can't fetch live). Not started.
- **Metasploit** — deferred (heavy); heavy image only, on request.

## Rollback
- Revert to the deployed baseline: `git checkout main` (`d5b23cb`), rebuild images
  if changed, `sudo systemctl restart cyber-exec`.
- Disable VPN egress (back to direct internet-only): `sudo ./deploy/vpn-egress.sh disable`.
- Remove egress firewall entirely: `sudo ./deploy/egress-firewall.sh remove`.
- The box is rebuildable from the repo + the owner re-dropping secrets (token,
  `/etc/wireguard/wg0.conf`).

## History (newest first)
- **PR #1 merged → `main @ d5b23cb`**: full hardened cyber-exec system built and
  smoked live (service, base+heavy images, offensive tooling, egress firewall,
  iVPN VPN egress with MTU-black-hole fix). Then docs (CLAUDE.md, README, this
  STATE.md, SessionStart hook) added on the working branch.
