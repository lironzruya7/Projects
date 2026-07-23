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
- `main` has PRs #1–#4 merged; **nothing pending**. (Repo-state line is kept
  hash-agnostic on purpose — the deployed baseline hash below is the meaningful
  one; `git log origin/main -1` for the exact tip.)
- Working branch: `claude/hardened-exec-agent-8a3obd` (restart from `origin/main`
  for follow-up work).
- **Convention:** "Deployed now" tracks what's actually running on the box;
  update it only when something is deployed/built/changed live. Docs/script PRs
  that aren't applied on the box don't change it — just add a History line.

## Host access
- **SSH is now tailnet-only** — `deploy/lockdown-ssh.sh lockdown` applied +
  `confirm` + `persist` (netfilter-persistent, survives reboot). Public TCP 22 is
  dropped; verified live: tailnet SSH (`root@100.116.160.2`) works, public does
  not. Out-of-band fallback = Hostinger console; rollback =
  `sudo ./deploy/lockdown-ssh.sh rollback`.
- With `/api/exec` already tailnet-only, the box now has **no public entry
  points** (dark on the public internet).

## OS-side integration
- **`docs/PLAYBOOK.md`** documents how the Claude OS session should drive
  `/api/exec` to use all current capabilities (network/image/raw fields, offline
  nuclei flags `-t $NUCLEI_TEMPLATES -disable-update-check`, heavy-image RE/mem
  recipes, VPN attribution, response handling). Contract is backward-compatible;
  old OS requests still work. **Owner: relay PLAYBOOK.md to the OS session.**

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
- **Added `docs/PLAYBOOK.md`**: OS-side integration playbook — how to invoke the
  new capabilities (image/raw/network, offline nuclei, heavy recipes, VPN). Relay
  to the OS session; no VPS change needed (contract is backward-compatible).
- **SSH locked to tailnet (LIVE)**: ran `lockdown-ssh.sh lockdown/confirm/persist`
  on the box; public TCP 22 dropped, tailnet SSH verified, persisted across
  reboot. Box now has no public entry points.
- **PR #4 merged**: `deploy/lockdown-ssh.sh` — tailnet-only SSH with safe
  pre-check + dead-man's-switch. Repo-only; **not yet applied on the box**.
- **PR #2 merged → `main @ f6f1647`**: docs installed as auto-loaded memory —
  stable CLAUDE.md operating brief, live docs/memory/STATE.md, SessionStart hook
  (Option B), reorganized README. Docs-only, no code/deploy change.
- **PR #1 merged → `main @ d5b23cb`**: full hardened cyber-exec system built and
  smoked live (service, base+heavy images, offensive tooling, egress firewall,
  iVPN VPN egress with MTU-black-hole fix).
