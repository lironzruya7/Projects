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
| `docker/Dockerfile.sec-toolbox` | The `sec-toolbox:latest` image |
| `deploy/cyber-exec.service` | systemd unit |
| `scripts/smoke_test.sh` | End-to-end smoke test |
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
- `503` — `CYBER_EXEC_TOKEN` not configured (fails closed).
- `422` — schema validation failure (unsafe file name, `timeout` out of
  `5..600`, bad `network` value).
- `400` — file `b64` is not valid base64.
- stdout/stderr are each capped at ~1 MB.

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

## Test

```bash
CYBER_EXEC_TOKEN=... ./scripts/smoke_test.sh
```
