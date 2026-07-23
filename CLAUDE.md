# CLAUDE.md — cyber-exec quick reference

Memory file for fast, economical context. Read this first; only open source files
when you need detail beyond what's here.

## What this is
A **hardened command-execution agent** for a security-analysis VPS. `POST /api/exec`
runs ONE shell command inside a FRESH, ephemeral Docker container (from a security
toolbox image), then tears it down. Loopback-only + `tailscale serve` (tailnet-only,
never public), bearer-token auth, heavily sandboxed. Single FastAPI file.

## Request flow
```
tailnet ─HTTPS→ tailscale serve :443 → 127.0.0.1:8000 (FastAPI, --workers 1)
  auth(401) → rate/concurrency(429) → docker run --rm (fresh, torn down) → JSON
```

## File map
| Path | What |
|---|---|
| `app/main.py` | **The whole service.** Auth, throttling, request model, `run_command`, docker argv, startup sweep, egress-network ensure. |
| `app/run.sh` / `app/requirements.txt` | Local launcher (binds 127.0.0.1 only) / deps |
| `docker/Dockerfile.sec-toolbox` | `sec-toolbox:latest` (Kali base) — default lean image + offensive tools + baked nuclei templates |
| `docker/Dockerfile.heavy` | `sec-toolbox-heavy:latest` — FROM base + OpenJDK/Ghidra/Volatility3 (opt-in `image:"heavy"`) |
| `deploy/cyber-exec.service` | systemd unit for the service (StateDirectory, no PrivateTmp) |
| `deploy/egress-firewall.sh` + `.service` | Source-scoped host firewall (internet-only) + boot re-apply. Kill-switch when `EGRESS_VPN=1`. |
| `deploy/vpn-egress.sh` + `wg0.conf.example` | iVPN/WireGuard egress (install/dry-run/up/down/status), fail-closed |
| `scripts/smoke_*.sh`, `verify_egress.sh` | Smoke + regression checks (run on the box) |

## API (`POST /api/exec`, `Authorization: Bearer <CYBER_EXEC_TOKEN>`)
Request: `{command, network:"none"|"egress"=none, timeout:5..1800(per-image default/cap), files:[{name,b64}], raw:bool=false, image:"base"|"heavy"=base}`
Response: `{ok, exit_code, stdout, stderr, timed_out, duration_s}` (stdout/stderr ~1MB cap).
Codes: 401 auth · 429 throttled (`{error,retry_after}`+Retry-After) · 422 schema · 400 bad b64 · 503 no token.
Unknown `image`/wrong-type → falls back to `base` (never errors). `raw` adds NET_RAW ONLY with `egress`.

## Container invariants (MUST NOT REGRESS)
`docker run --rm --network none|<egress-net> --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory <p> --cpus <clamped-to-host> --user runner -v <throwaway>:/work:rw`
- `--network none` is the DEFAULT. Non-root inside. Only the throwaway workdir mounted (+ optional RO vol-symbols on heavy). No docker socket, no host paths.
- Teardown always: `--rm` + `docker rm -f` + workdir rmtree in `finally`; startup sweep for SIGKILL/OOM orphans.
- Token never logged; constant-time compare; fails closed if unset.
- In-memory rate/concurrency ⇒ **single-worker only**.

## Common commands
```bash
# build
docker build -t sec-toolbox:latest -f docker/Dockerfile.sec-toolbox docker/
docker build -t sec-toolbox-heavy:latest -f docker/Dockerfile.heavy docker/ --build-arg GHIDRA_SHA256=<sha>
# run (local)
./app/run.sh                                   # 127.0.0.1:8000 only
# deploy (VPS)
sudo systemctl restart cyber-exec
sudo cp deploy/*.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo ./deploy/egress-firewall.sh install|status
sudo ./deploy/vpn-egress.sh install|dry-run|up|down|status
# test
CYBER_EXEC_TOKEN=... ./scripts/smoke_test.sh          # base
CYBER_EXEC_TOKEN=... ./scripts/smoke_offensive.sh     # offensive tools + offline nuclei
CYBER_EXEC_TOKEN=... ./scripts/smoke_heavy.sh         # Ghidra + vol3
CYBER_EXEC_TOKEN=... sudo -E ./scripts/smoke_vpn.sh   # VPN egress
CYBER_EXEC_TOKEN=... ./scripts/verify_egress.sh       # regression gate
```

## Config env (.env / SEC_TOOLBOX_*)
`CYBER_EXEC_TOKEN` (required) · `CYBER_EXEC_WORKROOT` (host-visible; systemd=/var/lib/cyber-exec/work) ·
`SEC_TOOLBOX_IMAGE/HEAVY_IMAGE`, `..._MEMORY/CPUS/PIDS`, `..._HEAVY_MEMORY/CPUS/TIMEOUT_*` ·
`SEC_TOOLBOX_VOL_CACHE` (heavy RO symbol cache) ·
`SEC_TOOLBOX_EGRESS_NETWORK/SUBNET` · `SEC_TOOLBOX_EGRESS_DNS` (=1.1.1.1 for VPN) · `SEC_TOOLBOX_EGRESS_MTU` (=1280 for VPN) ·
`EXEC_RATE_PER_MIN=30 / _BURST=10 / EXEC_MAX_CONCURRENCY=3 / EXEC_IP_RATE_PER_MIN=0`.
Firewall/VPN: `EGRESS_VPN`, `WG_IFACE`, `EGRESS_SUBNET` (in `/etc/cyber-exec/egress.env`).

## Egress & VPN model
- Egress runs on a DEDICATED docker network `cyberexec-egress` (172.31.255.0/24), so the firewall is scoped by **source subnet** (never touches `docker build`/other containers).
- Firewall (internet-only): DROP tailnet(100.64/10)/RFC1918/metadata in DOCKER-USER; MagicDNS (host-local) in **raw/PREROUTING**.
- VPN (iVPN/WireGuard, opt-in): custom table **51820** + source `ip rule` pref 1000 ⇒ never takes host default route (Tailscale + /api/exec survive). Kill-switch `-s 172.31.255.0/24 ! -o wg0 -j DROP` in DOCKER-USER (fail-closed, independent of wg0 lifecycle).

## GOTCHAS / hard-won lessons (don't re-discover these)
- **PrivateTmp breaks bind-mounts**: workdir must be host-visible (StateDirectory, NOT systemd PrivateTmp `/tmp`), else `/work` mounts empty.
- **Kali package names**: `testssl.sh` pkg installs binary as `testssl` → symlink. nikto/radare2 exist in Kali, not Debian (reason for Kali base). httpx is `httpx-toolkit` (best-effort).
- **pdfid/pdf-parser**: not on PyPI → fetched from DidierStevensSuite, shebang rewritten `env python`→`python3`, pinned by SHA-256.
- **Ghidra headless needs a font stack** (`libfreetype6 fontconfig libfontconfig1 libharfbuzz0b fonts-dejavu-core`) or it crashes in AWT font metrics during analysis.
- **nuclei templates**: git-clone `projectdiscovery/nuclei-templates` at build → `/opt/nuclei-templates` (`NUCLEI_TEMPLATES`), so scans run under `--network none`. Use `nuclei -t $NUCLEI_TEMPLATES -disable-update-check`.
- **`--cpus` must clamp to `os.cpu_count()`** — docker errors hard (exit 125) if asked for more CPUs than exist.
- **DOCKER_CONFIG** set in the unit to silence the `~/.docker/config.json` warning that otherwise pollutes every response's stderr.
- **MagicDNS 100.100.100.100 is host-local** → FORWARD/DOCKER-USER never sees it (tailscale DNATs in nat PREROUTING) → drop it in `raw/PREROUTING`.
- **VPN MTU black hole (the big one)**: egress network MTU must be **1280** (`com.docker.network.driver.mtu`) — a default-1500 container emits oversized DF packets (TLS ClientHello) the tunnel silently drops in `ip_forward()` before FORWARD (small requests work, HTTPS hangs). This is the ROOT fix. Belt: bidirectional MSS clamp (`-i` AND `-o wg0`, `--tcp-flags SYN,RST SYN` NOT `--syn`), `rp_filter=2` (loose), MASQUERADE `-I POSTROUTING 1 -o wg0`.
- **VPN DNS leak**: embedded docker resolver forwards from the HOST → use `--dns 1.1.1.1` (SEC_TOOLBOX_EGRESS_DNS) so DNS follows the tunnel.

## Git / workflow
Feature branch: `claude/hardened-exec-agent-8a3obd`. PR #1 already merged to `main`.
A merged PR is finished — for follow-up work, restart the branch from latest `main`
(`git checkout -B <branch> origin/main`) and push there; a new PR is a NEW PR.
Commit trailers used: `Co-Authored-By: Claude ...` + `Claude-Session: ...`.

## Environment notes
- Dev/CI sandbox here has **no docker daemon** and github.com is proxy-blocked — image builds & live smokes run on the VPS, not here. Validate what you can (py_compile, bash -n, JSON, stub-docker) and be honest about what only the VPS can confirm.
- No secrets in repo: `.env` gitignored; `.env.example`/`wg0.conf.example` are placeholders.
