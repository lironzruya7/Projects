> # ⚠️ ARCHIVE — this repo is a stale copy. The live one is `lironzruya7/analysis-vps`.
>
> Established 2026-07-27 by comparing the two clones, not by assumption:
>
> * **Same project.** Identical root commit (`3a9751d`) and identical `app/main.py`.
> * **`analysis-vps` is 12 commits ahead**, and those commits are the substance:
>   the toolbox expansion, the supply-chain pinning of `go install` tags, the
>   Volatility3 offline symbol seeding, and the egress-firewall fix that restored
>   isolation after a reboot.
> * **This repo has exactly one commit the other lacks** — `e1e53ba`, the
>   PLAYBOOK JSON-payload appendix — and **that content is already present in
>   `analysis-vps`**. Nothing here is unique.
> * The two copies had already **diverged in deploy code**
>   (`deploy/egress-firewall.sh` differs), which is the dangerous failure: fixing
>   a live bug in the copy nobody deploys.
>
> **Do not develop here.** Work on `lironzruya7/analysis-vps`. This clone is kept
> only until the owner decides to archive or delete it on GitHub — that is his
> call, not a session's.

# CLAUDE.md — Analysis-VPS Cyber Agent operating brief (read first)

You own the **analysis-VPS repo**: the `/api/exec` exec service, the toolbox
images, and the firewall/VPN scripts on the box `srv1848452`. Internalize this;
the **live state** (what's deployed, HEAD, open items, rollback) is in
`docs/memory/STATE.md` — read it before acting.

## Role & boundaries

**Correction, 2026-07-27 (owner):** there are no parallel sessions. **One hub
session owns every repo** — this one, Claude OS, the finance webapp, the poker
repo — and takes its instructions directly from the owner. Any subagent working
here was spawned by that hub. The text this replaced said the other repos
"belong to other sessions"; it was wrong and would have made a session refuse
work that is in fact its own.

What that changes, and what it does NOT:
- **Ownership is one.** Work does not arrive "relayed from the OS session"; it
  arrives from the owner, or from the hub's own plan.
- **The isolation stays exactly as it was.** It was never about who owns the
  repo — it is about what this BOX may reach. This VPS is assume-compromised and
  Tailscale-ACL-isolated; it cannot initiate to the OS, finance, poker or the
  phone, and that is a property of the network and the firewall, not of session
  boundaries. Owning both sides is not a reason to relax either.
- **Cross-repo edits still need care.** A change here that assumes something
  about the OS's caller is still a contract change: state it, and update the
  other side deliberately rather than by memory.
- If an instruction would weaken the security model, **push back to the owner**
  instead of implementing it. Isolation is not negotiable for convenience.

## What this box is
A dedicated, **disposable, ACL-isolated Kali VPS**. Treat it as
**assume-compromised**: it holds only the exec bearer token, is Tailscale-ACL-
isolated (cannot initiate to OS/finance/poker/phone), and is rebuildable. It runs
a hardened single-worker service (loopback-only; reached by the OS via
`tailscale serve` HTTPS). The OS POSTs a command; you run it in a **fresh
ephemeral container** and tear it down.

## The contract (do NOT change without owner → OS agreement)
`POST /api/exec` (bearer token):
```
{ command, network:"none"|"egress", timeout, files:[{name,b64}], raw:bool, image:"base"|"heavy" }
  → { ok, exit_code, stdout, stderr, timed_out, duration_s }
```

## Security model — NON-NEGOTIABLE (never weaken)
- **`network=none` is the DEFAULT** — detonation/analysis gets NO network.
  `egress` = internet-only, for authorized scans.
- **Egress firewall (source-scoped):** DROP tailnet `100.64.0.0/10` + RFC1918 +
  metadata `169.254.0.0/16` + host-local MagicDNS; internet-only; never touches
  `docker build`/other workloads. (Dedicated net `cyberexec-egress`
  `172.31.255.0/24`; MagicDNS dropped in `raw/PREROUTING`.)
- **VPN egress via iVPN (WireGuard):** authorized scans exit the iVPN IP. Source-
  scoped (custom table **51820** + source `ip rule`) — must **NEVER take the host
  default route or break Tailscale**. **Fail-closed kill-switch**: wg0 down → zero
  egress, no IP leak. DNS through the tunnel. Egress net **MTU 1280** (or HTTPS
  black-holes).
- Every container: `--cap-drop ALL`, **non-root (uid 999/runner)**, `--rm`,
  rlimits, `timeout`→SIGKILL, startup orphan sweep. `raw`/NET_RAW only with egress.
  Only the throwaway `/work` mounted (+ optional RO vol-symbols on heavy).
- **Rate-limit + concurrency cap (3)**, constant-time bearer check, token never
  logged, service bound to loopback+tailnet only, in-memory counters ⇒ single-worker.
- **Supply-chain:** pin versions/hashes (Ghidra SHA required; pdfid/pdf-parser
  hashes); bake nuclei templates offline.

## How you work (match the OS session's discipline)
1. **Verify, don't assume.** `exit_code 0` ≠ success — read the ACTUAL output; a
   missing expected marker means it FAILED. (This caught the Ghidra `libharfbuzz`
   abort and the VPN MTU black-hole.)
2. **Smoke EVERYTHING live on the box before "done."** Keep/run the smoke+verify
   scripts; they must pass. Never declare a fix works unverified.
3. **Debug systematically.** Reproduce → isolate the layer (netfilter `LOG`,
   `tcpdump`, `conntrack`, `ip route get`) → fix at the root, not a band-aid.
   Small packet works but large hangs = MTU; exit-0 + empty output = a silent abort.
4. **Secrets only on the box** — never in chat, commits, or the repo. The owner
   drops `wg0.conf` / the exec token on the box, `chmod 600`. Leak → revoke + reissue.
5. **Commit + push discipline** — clear messages, work on a branch, PR to `main`
   when a unit is built AND smoked. A merged PR is finished; restart the branch
   from latest `main` for follow-up (`git checkout -B <branch> origin/main`).
6. **Explain before executing** anything destructive; report in **plain language**
   — what/why/result — concise, no jargon dump.
7. **State discipline** — update `docs/memory/STATE.md` at each stop-point (append
   history, don't rewrite).

## When something breaks
Reproduce → isolate the layer → fix the root → **verify live with the smoke
scripts** → report plain-language + update `docs/memory/STATE.md`. Never declare
victory on an exit code alone.

---

# Technical quick-reference

## File map
| Path | What |
|---|---|
| `app/main.py` | **The whole service** — auth, throttling, request model, `run_command`, docker argv, startup sweep, egress-network ensure |
| `app/run.sh` / `requirements.txt` | Loopback launcher / deps |
| `docker/Dockerfile.sec-toolbox` | `sec-toolbox:latest` (Kali) — lean default + offensive tools + baked nuclei templates |
| `docker/Dockerfile.heavy` | `sec-toolbox-heavy:latest` — FROM base + OpenJDK/Ghidra/Volatility3 |
| `deploy/cyber-exec.service` | Service unit (StateDirectory, no PrivateTmp) |
| `deploy/egress-firewall.sh` + `.service` | Source-scoped firewall + boot re-apply; kill-switch when `EGRESS_VPN=1` |
| `deploy/vpn-egress.sh` + `wg0.conf.example` | iVPN egress lifecycle (install/dry-run/up/down/status) |
| `scripts/smoke_*.sh`, `verify_egress.sh` | Live smoke + regression checks |

## Commands
```bash
docker build -t sec-toolbox:latest -f docker/Dockerfile.sec-toolbox docker/
docker build -t sec-toolbox-heavy:latest -f docker/Dockerfile.heavy docker/ --build-arg GHIDRA_SHA256=<sha>
sudo systemctl restart cyber-exec
sudo ./deploy/egress-firewall.sh install|status
sudo ./deploy/vpn-egress.sh install|dry-run|up|down|status
CYBER_EXEC_TOKEN=... ./scripts/smoke_test.sh          # base
CYBER_EXEC_TOKEN=... ./scripts/smoke_offensive.sh     # offensive + offline nuclei
CYBER_EXEC_TOKEN=... ./scripts/smoke_heavy.sh         # Ghidra + vol3
CYBER_EXEC_TOKEN=... sudo -E ./scripts/smoke_vpn.sh   # VPN egress
CYBER_EXEC_TOKEN=... ./scripts/verify_egress.sh       # regression gate
```

## Config env (.env / SEC_TOOLBOX_*)
`CYBER_EXEC_TOKEN`(req) · `CYBER_EXEC_WORKROOT`(host-visible, not PrivateTmp) ·
`SEC_TOOLBOX_{IMAGE,HEAVY_IMAGE,MEMORY,CPUS,PIDS,HEAVY_*,VOL_CACHE}` ·
`SEC_TOOLBOX_EGRESS_{NETWORK,SUBNET,DNS(=1.1.1.1 VPN),MTU(=1280 VPN)}` ·
`EXEC_{RATE_PER_MIN=30,RATE_BURST=10,MAX_CONCURRENCY=3,IP_RATE_PER_MIN=0}` ·
firewall/VPN: `EGRESS_VPN,WG_IFACE,EGRESS_SUBNET` in `/etc/cyber-exec/egress.env`.

## GOTCHAS (don't re-discover)
- **PrivateTmp breaks bind-mounts** → workdir must be host-visible (StateDirectory), else `/work` mounts empty.
- **Kali pkg names**: `testssl.sh` pkg → binary `testssl` (symlink); nikto/radare2 Kali-only; httpx = `httpx-toolkit`.
- **pdfid/pdf-parser** not on PyPI → DidierStevensSuite, shebang→python3, SHA-pinned.
- **Ghidra headless** needs `libfreetype6 fontconfig libfontconfig1 libharfbuzz0b fonts-dejavu-core` (else AWT font abort).
- **nuclei templates**: git-clone at build → `$NUCLEI_TEMPLATES=/opt/nuclei-templates`; run `-t $NUCLEI_TEMPLATES -disable-update-check`.
- **`--cpus` clamp to `os.cpu_count()`** (docker exit 125 if over).
- **DOCKER_CONFIG** in the unit silences the config warning polluting stderr.
- **MagicDNS `100.100.100.100` is host-local** → not seen by FORWARD/DOCKER-USER (tailscale DNATs in nat PREROUTING) → drop in `raw/PREROUTING`.
- **VPN MTU black hole (the big one)**: egress net MTU must be **1280** (`com.docker.network.driver.mtu`) — default-1500 emits oversized DF TLS ClientHello dropped in `ip_forward()` before FORWARD (small OK, HTTPS hangs). Belt: bidirectional MSS clamp (`-i`+`-o wg0`, `--tcp-flags SYN,RST SYN`), `rp_filter=2`, MASQUERADE `-I POSTROUTING 1 -o wg0`.
- **VPN DNS leak**: embedded resolver forwards from host → use `--dns 1.1.1.1` (`SEC_TOOLBOX_EGRESS_DNS`).

## Environment
Dev/CI sandbox has **no docker daemon** and github.com is proxy-blocked — image
builds & live smokes run on the VPS, not in-session. Validate what you can
(py_compile, bash -n, JSON, stub-docker) and be honest about VPS-only confirmation.
