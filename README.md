# cyber-exec

A minimal, **hardened** command-execution agent for a security-analysis VPS.

It runs **one shell command per request** inside a **fresh, ephemeral Docker
container** built from `sec-toolbox:latest`, then tears the container down and
deletes the working directory. It is meant to be reachable **only over your
tailnet** — bound to loopback and fronted by `tailscale serve`.

```
tailnet client ──HTTPS──▶ tailscale serve :443 ──▶ 127.0.0.1:8000 (cyber-exec)
                                                        │  per request
                                                        ▼
                                          docker run --rm  (fresh container)
                                          --network none | bridge
                                          --cap-drop ALL --no-new-privileges
                                          -v <throwaway workdir>:/work
                                          sec-toolbox:latest  bash -lc "<cmd>"
```

## Layout

| Path | Purpose |
|------|---------|
| `app/main.py` | FastAPI service (`POST /api/exec`) |
| `app/run.sh` | Start the service bound to `127.0.0.1:8000` |
| `app/requirements.txt` | Python deps |
| `docker/Dockerfile.sec-toolbox` | The lean default `sec-toolbox:latest` image |
| `docker/Dockerfile.heavy` | Reserved, opt-in `sec-toolbox-heavy:latest` (Ghidra/Volatility3/…) |
| `deploy/cyber-exec.service` | systemd unit |
| `scripts/smoke_test.sh` | End-to-end smoke test (base) |
| `scripts/smoke_heavy.sh` | Smoke test for the heavy image |
| `.env.example` | Token + optional overrides |

## Setup

### 1. Build the toolbox image

```bash
docker build -t sec-toolbox:latest -f docker/Dockerfile.sec-toolbox docker/
```

Included: `nmap`, `masscan`, `whois`, `dnsutils`, `ffuf`, `nuclei`, `nikto`,
`sqlmap`, `testssl.sh`, `curl`, `jq`, `binwalk`, `yara`, `radare2`,
`exiftool`, `oletools`, `pdfid`/`pdf-parser`, `tshark`, `python3` + `requests`.
(Volatility3 + Ghidra are intentionally left for a heavier optional image.)

### 2. Configure the token

```bash
cp .env.example .env
python3 -c "import secrets; print('CYBER_EXEC_TOKEN=' + secrets.token_urlsafe(48))" >> .env
# then edit .env to remove the placeholder line
```

### 3. Run the service

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r app/requirements.txt
./app/run.sh          # binds 127.0.0.1:8000 ONLY
```

### 4. Expose on the tailnet (never public)

```bash
tailscale serve --bg --https=443 http://127.0.0.1:8000
```

## API

### `POST /api/exec`

Headers: `Authorization: Bearer <CYBER_EXEC_TOKEN>`

Request:

```json
{
  "command": "nmap -sV -Pn scanme.nmap.org",
  "network": "none",
  "timeout": 120,
  "files": [{ "name": "sample.bin", "b64": "..." }]
}
```

| Field | Type | Notes |
|-------|------|-------|
| `command` | string | Runs as `bash -lc "<command>"` in `/work` |
| `network` | `"none"` \| `"egress"` | **Default `none`** (isolated detonation). `egress` = bridge networking |
| `timeout` | int | Seconds, `5..600`. Container is killed on overrun |
| `files` | array (optional) | `{name, b64}`; base64-decoded into `/work`. `name` must be a plain basename |
| `raw` | bool (optional) | **Default `false`**. When `true` **and** `network == "egress"`, adds **only** `--cap-add NET_RAW` (for `nmap -sS`, `masscan`, etc.). Ignored under `network: "none"`. No other capability is ever added |
| `image` | `"base"` \| `"heavy"` (optional) | **Default `"base"`** (lean, fast). `"heavy"` uses the reserved RE/forensics image. Absent/unknown/wrong-type → falls back to `base` (never errors) |

`timeout` defaults and caps are **per image**: base = default `60`, cap `600`;
heavy = default `300`, cap `1800`. Omit `timeout` to take the image default; a
value above the image cap is clamped down (never an error).

Response:

```json
{
  "ok": true,
  "exit_code": 0,
  "stdout": "...",
  "stderr": "...",
  "timed_out": false,
  "duration_s": 3.42
}
```

- `401` — missing/invalid bearer token (constant-time compare).
- `429` — throttled (see below). Body `{"error": "...", "retry_after": N}` with a
  `Retry-After` header. No container is spun for a rejected request.
- `503` — `CYBER_EXEC_TOKEN` not configured (fails closed).
- `422` — schema validation failure (unsafe file name, `timeout` out of
  `5..600`, bad `network` value).
- `400` — file `b64` is not valid base64.
- stdout/stderr are each capped at ~1 MB.

## Throttling (defense-in-depth)

`cyber_exec` is approval-gated on the OS side, **not** on the VPS — the VPS
trusts only the bearer token. So if the token leaks, an attacker could hit
`/api/exec` directly and spin unlimited containers. The Tailscale ACL limits
**who** can reach the service; these in-process limits cap **how much**:

- **Rate limit** — token-bucket **per bearer token**, checked *before* spinning
  a container. `EXEC_RATE_PER_MIN=30`, `EXEC_RATE_BURST=10`.
- **Concurrency cap** — hard ceiling on simultaneous containers,
  `EXEC_MAX_CONCURRENCY=3`. Acquired before `docker run`, released in `finally`
  (frees on success, timeout, or crash) — **fail closed**, never exceeds N.
- Optional coarse **per-IP** rate (`EXEC_IP_RATE_PER_MIN`, default `0`/off) to
  blunt token brute-force, applied pre-auth.

Order: **auth (`401`) → rate/concurrency (`429`)**. `/healthz` is exempt and
answers even while saturated. Overflow returns `429` with `Retry-After` and a
`{"error","retry_after"}` body — no internals leaked, no container spun.

> These counters are **in-memory**, so the service **must stay single-worker**
> (`--workers 1`, as shipped in `run.sh` and the systemd unit). Multiple workers
> would each keep their own counters and break the caps.

## Hardening

Every container runs with:

- `--network none` **by default** (only `bridge` when `network: "egress"`).
- `--cap-drop ALL` and `--security-opt no-new-privileges`. The **only**
  capability that can be added back is `NET_RAW`, and only when the caller
  explicitly sets `raw: true` together with `network: "egress"` — never
  otherwise.
- `--pids-limit 512 --memory 2g --cpus 2`.
- `--user runner` (**non-root** inside the container).
- Only the **throwaway workdir** is mounted (`-v <workdir>:/work:rw`). No other
  host paths are ever mounted.
- `--rm` plus an explicit `docker rm -f` and `rmtree` in `finally` — **no
  persistence** between runs.
- The container is **never** added to the tailnet.

Service-level:

- Binds `127.0.0.1:8000` only; tailnet exposure via `tailscale serve`.
- Bearer-token auth with `hmac.compare_digest` (constant-time), token read
  from `.env` and **never logged**. Commands *are* logged locally.
- `deploy/cyber-exec.service` adds `NoNewPrivileges`, `ProtectSystem=strict`,
  `PrivateTmp`, etc. for the service process itself.

## Heavy image (`sec-toolbox-heavy:latest`) — reserved, opt-in

The lean `sec-toolbox:latest` stays the **default** for fast spin-up. A separate
`sec-toolbox-heavy:latest` (from `docker/Dockerfile.heavy`) adds RE/forensics
tooling and is **only** used when a request sets `{"image":"heavy"}`. It is
built **FROM** the base, so it is literally base + additions; the base build and
tag are never modified.

Heavy adds: **OpenJDK 21**, **Ghidra** (headless only — `analyzeHeadless` on
`PATH`, no GUI), **Volatility3**, plus **yara** (already in base), **capa**,
**floss**. No GUI/Android tooling. No Windows symbol packs are baked in — vol3
resolves ISF symbols from an optional, pre-populated cache (see below).

Build order (base first, then heavy):

```bash
docker build -t sec-toolbox:latest       -f docker/Dockerfile.sec-toolbox docker/
docker build -t sec-toolbox-heavy:latest -f docker/Dockerfile.heavy       docker/
# For a verified Ghidra download, pass the release's SHA-256:
#   --build-arg GHIDRA_SHA256=<sha256 from the Ghidra release page>
# If the pinned Ghidra asset 404s (superseded), also override:
#   --build-arg GHIDRA_VERSION=<x.y.z> --build-arg GHIDRA_DATE=<YYYYMMDD>
```

**Resource envelope** (per image; base untouched):

| image | memory | cpus | timeout default | timeout cap |
|-------|--------|------|-----------------|-------------|
| base  | 2g     | 2    | 60s             | 600s        |
| heavy | 4g     | 4    | 300s            | 1800s       |

`--cpus` is clamped to the host's CPU count, so the heavy profile asking for `4`
on a 2-CPU box runs with `2` instead of failing (`docker` errors hard if asked
for more CPUs than exist). On larger hardware it uses the full value.

**Security is identical to base** and non-negotiable: `--network none` is still
the **default** for heavy (RE/forensics is offline; egress is opt-in + `raw`
exactly as base), `--cap-drop ALL`, non-root (`uid 999`), `--rm`, rlimits, and
**no host mounts beyond the ephemeral `/work`** — plus one optional, read-only
Volatility symbol cache.

**Volatility3 symbol cache (optional):** set `SEC_TOOLBOX_VOL_CACHE=<host dir>`.
When set, it is bind-mounted **read-only** at `/opt/vol-symbols` in the heavy
container *only*. Pre-populate it offline (network is `none` at analysis time).

**Smoke** (run on the box after building; see `scripts/smoke_heavy.sh`):

```bash
CYBER_EXEC_TOKEN=... ./scripts/smoke_heavy.sh [base_url] [linux_dump_path]
```

Covers: (a) `analyzeHeadless` decompiles a small binary → pseudo-C; (b) `vol -h`
(+ `linux.pslist` on a provided dump); (c) re-confirms non-root, `--network
none`, and no network reachable.

## Workdir root & `files`

Each request writes its `files[]` into a throwaway workdir that is bind-mounted
to `/work` inside the container. That workdir lives under **`CYBER_EXEC_WORKROOT`**
(systemd: `/var/lib/cyber-exec/work`; `run.sh`: `<repo>/.work`).

It must be a **real host path the Docker daemon can see** — do **not** place it
under a systemd `PrivateTmp` `/tmp`. The daemon resolves the bind-mount source
in its own mount namespace, so a private `/tmp` would mount an *empty* `/work`
and uploaded files would be missing. The shipped unit therefore uses
`StateDirectory=cyber-exec` and no `PrivateTmp`.

## Test

```bash
CYBER_EXEC_TOKEN=... ./scripts/smoke_test.sh
```
