# cyber-exec

A minimal, **hardened** command-execution agent for a security-analysis VPS. It
runs **one shell command per request** inside a **fresh, ephemeral Docker
container** built from `sec-toolbox:latest`, then tears the container down and
deletes the working directory. It is reachable **only over your tailnet** —
bound to loopback and fronted by `tailscale serve`, token-authed, and heavily
sandboxed.

```
tailnet client ──HTTPS──▶ tailscale serve :443 ──▶ 127.0.0.1:8000 (cyber-exec)
                                                        │  per request
                            auth(401) → rate/concurrency(429)
                                                        ▼
                                    docker run --rm  (fresh container)
                                    --network none | <egress-net>
                                    --cap-drop ALL --no-new-privileges
                                    --user runner -v <throwaway>:/work
                                    sec-toolbox:latest  bash -lc "<cmd>"
```

## Contents
- [Quick start](#quick-start)
- [API](#api)
- [Security & hardening](#security--hardening)
- [Throttling](#throttling-defense-in-depth)
- [Images: base & heavy](#images-base--heavy)
- [Egress isolation & firewall](#egress-isolation--firewall)
- [VPN egress via iVPN (optional OPSEC)](#vpn-egress-via-ivpn-optional-opsec)
- [Operations](#operations)
- [Testing](#testing)
- [Configuration reference](#configuration-reference)
- [Troubleshooting / lessons learned](#troubleshooting--lessons-learned)
- [Repository layout](#repository-layout)

---

## Quick start

```bash
# 1. Build the lean toolbox image
docker build -t sec-toolbox:latest -f docker/Dockerfile.sec-toolbox docker/

# 2. Configure the token
cp .env.example .env
python3 -c "import secrets; print('CYBER_EXEC_TOKEN=' + secrets.token_urlsafe(48))" >> .env

# 3. Run the service (binds 127.0.0.1:8000 ONLY)
python3 -m venv .venv && . .venv/bin/activate
pip install -r app/requirements.txt
./app/run.sh

# 4. Expose on the tailnet (never public)
tailscale serve --bg --https=443 http://127.0.0.1:8000
```

For a persistent install use the systemd unit — see [Operations](#operations).

---

## API

### `POST /api/exec`

Headers: `Authorization: Bearer <CYBER_EXEC_TOKEN>`

```json
{
  "command": "nmap -sV -Pn scanme.nmap.org",
  "network": "none",
  "timeout": 120,
  "files": [{ "name": "sample.bin", "b64": "..." }],
  "raw": false,
  "image": "base"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `command` | string | Runs as `bash -lc "<command>"` in `/work` |
| `network` | `"none"` \| `"egress"` | **Default `none`** (isolated detonation); `egress` uses the dedicated egress network |
| `timeout` | int (optional) | Seconds. Per-image default & cap (base `60`/`600`, heavy `300`/`1800`); omit for default, over-cap is clamped |
| `files` | array (optional) | `{name, b64}` base64-decoded into `/work`; `name` must be a plain basename (no traversal) |
| `raw` | bool (optional) | **Default `false`**. `true` **and** `network:"egress"` adds **only** `--cap-add NET_RAW` (e.g. `nmap -sS`, `masscan`). Ignored under `none` |
| `image` | `"base"` \| `"heavy"` (optional) | **Default `base`** (lean). `heavy` = RE/forensics image. Absent/unknown/wrong-type → `base` (never errors) |

Response:

```json
{ "ok": true, "exit_code": 0, "stdout": "...", "stderr": "...", "timed_out": false, "duration_s": 3.42 }
```

Status codes: `401` bad/missing token (constant-time) · `429` throttled
(`{"error","retry_after"}` + `Retry-After`; no container spun) · `503` token not
configured (fails closed) · `422` schema (unsafe name / bad `network`) · `400`
bad base64. stdout/stderr are each capped at ~1 MB. `/healthz` is unauthenticated
and exempt from throttling.

---

## Security & hardening

Every container runs with:

- `--network none` **by default** (only the dedicated egress network when `network:"egress"`).
- `--cap-drop ALL` + `--security-opt no-new-privileges`. The **only** capability
  ever added back is `NET_RAW`, and only with `raw:true` **and** `network:"egress"`.
- `--pids-limit 512`, per-image `--memory` / `--cpus` (cpus clamped to host count).
- `--user runner` (**non-root** inside).
- Only the **throwaway workdir** is mounted (`-v <workdir>:/work:rw`) — plus one
  optional read-only Volatility symbol cache on heavy. No docker socket, no other host paths.
- `--rm` + explicit `docker rm -f` + `rmtree` in `finally` — **no persistence**.
  A startup sweep removes workdirs/containers orphaned by SIGKILL/OOM.
- The container is **never** added to the tailnet.

Service-level:

- Binds `127.0.0.1:8000` only; tailnet exposure via `tailscale serve`.
- Bearer auth with `hmac.compare_digest` (constant-time); token read from `.env`,
  **never logged** (commands *are* logged locally).
- `deploy/cyber-exec.service` adds `NoNewPrivileges`, `ProtectSystem=strict`,
  `StateDirectory`, etc. for the service process.

---

## Throttling (defense-in-depth)

`cyber_exec` is approval-gated on the OS side, **not** on the VPS — the VPS trusts
only the bearer token. If the token leaks, these in-process limits cap **how much**
a holder can do (the Tailscale ACL limits **who** can reach it):

- **Rate limit** — token-bucket per bearer token, before spinning a container
  (`EXEC_RATE_PER_MIN=30`, `EXEC_RATE_BURST=10`).
- **Concurrency cap** — hard ceiling (`EXEC_MAX_CONCURRENCY=3`), acquired before
  `docker run`, released in `finally` — fail-closed, never exceeds N.
- Optional coarse **per-IP** rate (`EXEC_IP_RATE_PER_MIN`, default off), pre-auth.

Order: **auth (`401`) → rate/concurrency (`429`)**. Rejections spin no container.

> Counters are **in-memory** ⇒ the service **must stay single-worker** (`--workers 1`,
> as shipped). Multiple workers would each keep their own counters and break the caps.

---

## Images: base & heavy

### `sec-toolbox:latest` (default, lean, Kali base)

`nmap`, `masscan`, `whois`, `dnsutils`, `nikto`, `ffuf`, `nuclei`,
`feroxbuster`, `hydra`, `whatweb`, `sqlmap`, `testssl.sh`, `curl`, `jq`,
`binwalk`, `yara`, `radare2`, `exiftool`, `oletools`, `pdfid`/`pdf-parser`
(SHA-256 pinned), `tshark`, `python3`+`requests` (and `httpx` if the Kali
package is present).

**Offensive tooling** is gated exactly like everything else (OS approval +
scope-guard, egress firewall, ephemeral `--cap-drop ALL`/`--network none`/`--rm`
container) — installing relaxes nothing. **nuclei templates are baked at build
time** (`git clone` → `$NUCLEI_TEMPLATES` = `/opt/nuclei-templates`) so scans run
offline under `--network none`; invoke `nuclei -t $NUCLEI_TEMPLATES -disable-update-check`.

### `sec-toolbox-heavy:latest` (reserved, opt-in `image:"heavy"`)

Built **FROM** the base (= base + additions; the base tag is never modified).
Adds **OpenJDK 21**, **Ghidra** (headless — `analyzeHeadless` on `PATH`, no GUI),
**Volatility3**, plus **capa**/**floss**. No GUI/Android tooling. No Windows
symbol packs baked in.

```bash
docker build -t sec-toolbox:latest -f docker/Dockerfile.sec-toolbox docker/
# GHIDRA_SHA256 is REQUIRED (integrity-verified build):
docker build -t sec-toolbox-heavy:latest -f docker/Dockerfile.heavy docker/ \
  --build-arg GHIDRA_SHA256=<sha256 from the Ghidra release page>
# If the pinned asset 404s: also --build-arg GHIDRA_VERSION=x.y.z GHIDRA_DATE=YYYYMMDD
```

Resource envelope (per image; base untouched; `--cpus` clamped to host):

| image | memory | cpus | timeout default | timeout cap |
|-------|--------|------|-----------------|-------------|
| base  | 2g     | 2    | 60s             | 600s        |
| heavy | 4g     | 4    | 300s            | 1800s       |

**Volatility3 symbol cache (optional):** `SEC_TOOLBOX_VOL_CACHE=<host dir>` →
bind-mounted **read-only** at `/opt/vol-symbols` in the heavy container only;
pre-populate offline.

---

## Egress isolation & firewall

- `network:"none"` (default) = **no network at all** — fully isolated.
- `network:"egress"` runs the container on a **dedicated** docker network
  (`cyberexec-egress`, `172.31.255.0/24`, created at startup), not the shared
  default bridge — so the firewall is scoped by **source subnet** and `docker
  build` / other containers are never affected.
- `sudo deploy/egress-firewall.sh install` restricts egress to the **public
  internet only**: DROP tailnet (`100.64.0.0/10`) / RFC1918 / metadata
  (`169.254.169.254`) in `DOCKER-USER`; host-local **MagicDNS** (`100.100.100.100`)
  in `raw/PREROUTING` (tailscale DNATs it before FORWARD/INPUT).
- Install `deploy/egress-firewall.service` (`PartOf=docker.service`) to re-apply
  across reboots and docker restarts. The firewall's `EGRESS_SUBNET` must match
  the app's `SEC_TOOLBOX_EGRESS_SUBNET`.

---

## VPN egress via iVPN (optional OPSEC)

Route **only** the egress network out through iVPN (WireGuard) so authorized
scans exit from the VPN IP, not the VPS's real IP. **This is OPSEC, not
authorization** — the OS scope-guard is unchanged; a VPN never permits an
unauthorized target. **Off by default.**

- **No default-route takeover.** WireGuard's `0.0.0.0/0` goes into a **custom
  table (51820)**; a source `ip rule` (`from 172.31.255.0/24`, pref 1000) makes
  only the egress subnet use it. Tailscale, image pulls, and the OS → `/api/exec`
  path stay on the main route.
- **Fail-closed kill-switch.** `EGRESS_VPN=1` adds a `DOCKER-USER` rule dropping
  any egress-subnet packet not leaving via `wg0` — tunnel down ⇒ zero egress, no
  leak. Persisted via the boot unit + `/etc/cyber-exec/egress.env`, independent
  of the `wg0` lifecycle.
- **DNS + MTU through the tunnel.** Egress containers use `--dns`
  (`SEC_TOOLBOX_EGRESS_DNS=1.1.1.1`) so DNS doesn't leak, and the egress network
  MTU is **1280** (`SEC_TOOLBOX_EGRESS_MTU`) to avoid the tunnel MTU black hole
  (see [Troubleshooting](#troubleshooting--lessons-learned)).

Bring-up (scaffolding first, real iVPN keys last):

```bash
sudo ./deploy/vpn-egress.sh install     # wireguard-tools (no keys)
sudo ./deploy/vpn-egress.sh dry-run     # validate ip-rule + kill-switch (no keys, non-mutating)
# owner: put real iVPN config at /etc/wireguard/wg0.conf (see wg0.conf.example);
#        set SEC_TOOLBOX_EGRESS_DNS=1.1.1.1 and SEC_TOOLBOX_EGRESS_MTU=1280 in .env; restart service
sudo ./deploy/vpn-egress.sh up          # tunnel up + kill-switch on
CYBER_EXEC_TOKEN=... sudo -E ./scripts/smoke_vpn.sh
```

---

## Operations

**systemd:**
```bash
sudo cp deploy/cyber-exec.service deploy/egress-firewall.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cyber-exec egress-firewall
```

**Workdir / `files`:** each request writes its `files[]` into a throwaway workdir
bind-mounted to `/work`, under **`CYBER_EXEC_WORKROOT`** (systemd:
`/var/lib/cyber-exec/work`; `run.sh`: `<repo>/.work`). It **must** be a real host
path the Docker daemon can see — **not** a systemd `PrivateTmp` `/tmp`, or `/work`
mounts empty. The unit uses `StateDirectory=cyber-exec` and no `PrivateTmp`.

---

## Testing

```bash
CYBER_EXEC_TOKEN=... ./scripts/smoke_test.sh            # base: exec/files/timeout/egress
CYBER_EXEC_TOKEN=... ./scripts/smoke_offensive.sh       # offensive tools + offline nuclei templates
CYBER_EXEC_TOKEN=... ./scripts/smoke_heavy.sh [url] [dump]   # Ghidra decompile + vol3
CYBER_EXEC_TOKEN=... sudo -E ./scripts/smoke_vpn.sh     # VPN exit IP, kill-switch, isolation, Tailscale intact
CYBER_EXEC_TOKEN=... ./scripts/verify_egress.sh         # regression gate (run after any egress/firewall/network change)
```

---

## Configuration reference

All via env / `.env` (see `.env.example`). Defaults shown.

| Var | Default | Purpose |
|-----|---------|---------|
| `CYBER_EXEC_TOKEN` | *(required)* | Bearer token; service fails closed if unset |
| `CYBER_EXEC_WORKROOT` | `/var/lib/cyber-exec/work` | Host-visible throwaway-workdir root (never PrivateTmp) |
| `SEC_TOOLBOX_IMAGE` / `_HEAVY_IMAGE` | `sec-toolbox:latest` / `-heavy:latest` | Image tags |
| `SEC_TOOLBOX_MEMORY` / `_CPUS` / `_PIDS` | `2g` / `2` / `512` | Base limits |
| `SEC_TOOLBOX_HEAVY_MEMORY` / `_CPUS` / `_TIMEOUT_DEFAULT` / `_TIMEOUT_CAP` | `4g` / `4` / `300` / `1800` | Heavy envelope |
| `SEC_TOOLBOX_VOL_CACHE` | *(empty)* | RO Volatility symbol cache (heavy only) |
| `SEC_TOOLBOX_EGRESS_NETWORK` / `_SUBNET` | `cyberexec-egress` / `172.31.255.0/24` | Dedicated egress network |
| `SEC_TOOLBOX_EGRESS_DNS` | *(empty)* | Egress container `--dns` (`1.1.1.1` for VPN; empty = embedded resolver) |
| `SEC_TOOLBOX_EGRESS_MTU` | *(empty)* | Egress network MTU (`1280` for VPN; empty = docker default 1500) |
| `EXEC_RATE_PER_MIN` / `_BURST` | `30` / `10` | Token-bucket rate limit |
| `EXEC_MAX_CONCURRENCY` / `EXEC_CONC_RETRY_AFTER` | `3` / `5` | Concurrency cap |
| `EXEC_IP_RATE_PER_MIN` / `_BURST` | `0` (off) / `20` | Optional pre-auth per-IP rate |
| `EGRESS_VPN` / `WG_IFACE` | `0` / `wg0` | Firewall VPN kill-switch (via `/etc/cyber-exec/egress.env`) |

---

## Troubleshooting / lessons learned

Hard-won gotchas from building this on a live Kali/Tailscale/Docker box:

- **`/work` mounts empty** → the workdir was under a systemd `PrivateTmp` `/tmp`
  the Docker daemon can't see. Use `StateDirectory` / a host-visible `CYBER_EXEC_WORKROOT`.
- **`testssl.sh: command not found`** → Kali's package installs the binary as
  `testssl`; the Dockerfile symlinks it. (nikto/radare2 are Kali-only → Kali base.)
- **Ghidra `analyzeHeadless` crashes in font code** → needs `libfreetype6
  fontconfig libfontconfig1 libharfbuzz0b fonts-dejavu-core` (baked in the heavy image).
- **nuclei has no templates offline** → they're git-cloned at build to
  `$NUCLEI_TEMPLATES`; pass `-t $NUCLEI_TEMPLATES -disable-update-check`.
- **heavy request errors `exit 125` re CPUs** → `--cpus` is clamped to the host
  CPU count (docker refuses more CPUs than exist).
- **`docker build` DNS breaks after enabling the firewall** → don't scope firewall
  rules to `docker0`-wide; the egress network is dedicated and rules are
  source-scoped to `172.31.255.0/24` only.
- **MagicDNS still reachable from a container** → `100.100.100.100` is host-local;
  FORWARD/`DOCKER-USER` never sees it (tailscale DNATs in nat PREROUTING). Drop it
  in `raw/PREROUTING`.
- **VPN: HTTPS hangs but HTTP works ("MTU black hole")** → the egress network MTU
  was 1500; the TLS ClientHello (1452B, DF) exceeds the tunnel MTU and is dropped
  in `ip_forward()` before FORWARD. **Root fix: egress network MTU 1280**
  (`SEC_TOOLBOX_EGRESS_MTU`). Belt: bidirectional MSS clamp (`-i` **and** `-o wg0`,
  `--tcp-flags SYN,RST SYN` not `--syn`), `rp_filter=2` (loose), MASQUERADE
  `-I POSTROUTING 1 -o wg0`.
- **VPN breaks Tailscale / SSH** → the WireGuard config took the default route. Use
  `Table = 51820` + a source `ip rule` (never `Table = auto` with `0.0.0.0/0` in main).

---

## Repository layout

| Path | Purpose |
|------|---------|
| `CLAUDE.md` | Quick-reference memory file |
| `app/main.py` | FastAPI service (auth, throttling, exec, sweep) |
| `app/run.sh` / `app/requirements.txt` | Loopback launcher / deps |
| `docker/Dockerfile.sec-toolbox` | Lean default image (`sec-toolbox:latest`) |
| `docker/Dockerfile.heavy` | Opt-in heavy image (`sec-toolbox-heavy:latest`) |
| `deploy/cyber-exec.service` | Service systemd unit |
| `deploy/egress-firewall.sh` + `.service` | Source-scoped egress firewall + boot re-apply |
| `deploy/wg0.conf.example` | WireGuard template (no default-route takeover) |
| `deploy/vpn-egress.sh` | iVPN egress lifecycle (install/dry-run/up/down/status) |
| `scripts/smoke_test.sh` | Base end-to-end smoke |
| `scripts/smoke_offensive.sh` | Offensive tooling smoke |
| `scripts/smoke_heavy.sh` + `scripts/ghidra/DecompileFirst.py` | Heavy image smoke |
| `scripts/smoke_vpn.sh` | VPN egress smoke |
| `scripts/verify_egress.sh` | Post-change egress regression gate |
| `.env.example` | Config template |
