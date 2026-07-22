"""
cyber-exec — a minimal, hardened command-execution agent.

Runs ONE shell command per request inside a FRESH, ephemeral Docker container
built from `sec-toolbox:latest`, then tears it down. Designed to be exposed
ONLY on the loopback interface (127.0.0.1:8000) and fronted by
`tailscale serve`, so it is reachable on the tailnet but never on the public
internet.

Security model:
  * Bearer-token auth (constant-time compare) read from CYBER_EXEC_TOKEN.
  * Every request gets a throwaway workdir + a throwaway container.
  * Containers run with all capabilities dropped, no-new-privileges,
    pids/memory/cpu limits, and `--network none` by DEFAULT.
  * Only the throwaway workdir is ever mounted into the container.
  * The command runs as a NON-root user inside the container.
  * Nothing persists between runs; the workdir is always deleted.
  * Defense-in-depth throttling: per-token rate limit + a hard concurrency cap
    (in-process, so the service MUST run single-worker).
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hmac
import logging
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from typing import List, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

IMAGE = os.environ.get("SEC_TOOLBOX_IMAGE", "sec-toolbox:latest")
CONTAINER_USER = os.environ.get("SEC_TOOLBOX_USER", "runner")
OUTPUT_CAP_BYTES = 1 * 1024 * 1024  # ~1 MB per stream
DOCKER_BIN = os.environ.get("DOCKER_BIN", "docker")

# Root for per-request throwaway workdirs. This MUST be a path the Docker
# daemon can see in ITS mount namespace, because the daemon resolves the
# `-v <workdir>:/work` bind-mount source. In particular it must NOT live under
# a systemd `PrivateTmp=true` /tmp — that /tmp is private to the service, so
# the daemon (host namespace) would bind-mount an empty dir and /work would
# appear empty. Default to a real host state dir; override for local dev.
WORK_ROOT = os.environ.get("CYBER_EXEC_WORKROOT", "/var/lib/cyber-exec/work")

# Resource limits applied to every container.
PIDS_LIMIT = os.environ.get("SEC_TOOLBOX_PIDS", "512")
MEMORY_LIMIT = os.environ.get("SEC_TOOLBOX_MEMORY", "2g")
CPUS_LIMIT = os.environ.get("SEC_TOOLBOX_CPUS", "2")

# Per-image profiles. "base" is the lean default (fast spin-up); "heavy" is the
# reserved, opt-in RE/forensics image. Each profile carries its OWN resource
# envelope and timeout default/cap — the base envelope is untouched. The heavy
# image is never used unless a request explicitly asks for {"image":"heavy"}.
IMAGE_PROFILES = {
    "base": {
        "image": IMAGE,
        "memory": MEMORY_LIMIT,
        "cpus": CPUS_LIMIT,
        "timeout_default": 60,
        "timeout_cap": 600,
    },
    "heavy": {
        "image": os.environ.get("SEC_TOOLBOX_HEAVY_IMAGE", "sec-toolbox-heavy:latest"),
        "memory": os.environ.get("SEC_TOOLBOX_HEAVY_MEMORY", "4g"),
        "cpus": os.environ.get("SEC_TOOLBOX_HEAVY_CPUS", "4"),
        "timeout_default": int(os.environ.get("SEC_TOOLBOX_HEAVY_TIMEOUT_DEFAULT", "300")),
        "timeout_cap": int(os.environ.get("SEC_TOOLBOX_HEAVY_TIMEOUT_CAP", "1800")),
    },
}
DEFAULT_IMAGE = "base"

# Optional, read-only Volatility3 symbol cache (host dir). When set AND the
# request uses the heavy image, it is bind-mounted read-only into the heavy
# container so pre-populated ISF symbols are available offline. Empty = no
# extra mount (the default: nothing beyond the ephemeral /work is ever mounted).
VOL_SYMBOL_CACHE = os.environ.get("SEC_TOOLBOX_VOL_CACHE", "")
# Where vol3 looks for extra symbol tables inside the container.
VOL_SYMBOL_MOUNT = "/opt/vol-symbols"

# Upper sanity bound for any timeout before per-image capping (== max heavy cap).
MAX_TIMEOUT_HARD = 1800

# --- Defense-in-depth throttling (in-process; single-worker uvicorn only) ---
# Rate limit: token-bucket per bearer token, checked BEFORE spinning a
# container. Concurrency cap: hard ceiling on simultaneous containers. These
# limit how MUCH a holder of the token can do if the token leaks (the Tailscale
# ACL limits WHO can reach the service; this limits how much).
EXEC_RATE_PER_MIN = int(os.environ.get("EXEC_RATE_PER_MIN", "30"))
EXEC_RATE_BURST = int(os.environ.get("EXEC_RATE_BURST", "10"))
EXEC_MAX_CONCURRENCY = int(os.environ.get("EXEC_MAX_CONCURRENCY", "3"))
# Retry-After (seconds) suggested on a concurrency rejection (a slot may free
# at any time, so this is only a hint).
EXEC_CONC_RETRY_AFTER = int(os.environ.get("EXEC_CONC_RETRY_AFTER", "5"))
# Optional coarse per-IP request rate to blunt token brute-force. Applied
# BEFORE auth. 0 disables it (default) — the Tailscale ACL already limits who
# can reach the service, so this is a minor extra.
EXEC_IP_RATE_PER_MIN = int(os.environ.get("EXEC_IP_RATE_PER_MIN", "0"))
EXEC_IP_RATE_BURST = int(os.environ.get("EXEC_IP_RATE_BURST", "20"))

TOKEN = os.environ.get("CYBER_EXEC_TOKEN", "")

# --------------------------------------------------------------------------- #
# Logging (commands are logged locally; the token is NEVER logged)
# --------------------------------------------------------------------------- #

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("cyber-exec")

# Ensure the workdir root exists and is usable, failing fast (and clearly) if
# it is misconfigured rather than silently producing empty /work mounts.
try:
    os.makedirs(WORK_ROOT, exist_ok=True)
except OSError as exc:  # pragma: no cover - startup misconfig
    raise RuntimeError(
        f"cannot create CYBER_EXEC_WORKROOT={WORK_ROOT!r}: {exc}. "
        "Point it at a host-visible, writable directory."
    ) from exc

# --------------------------------------------------------------------------- #
# Request / response models
# --------------------------------------------------------------------------- #

_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


class InputFile(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    b64: str

    @field_validator("name")
    @classmethod
    def _safe_name(cls, v: str) -> str:
        # Basenames only — no path traversal, no absolute paths.
        if v in (".", "..") or not _NAME_RE.match(v) or "/" in v or "\\" in v:
            raise ValueError("file name must be a simple basename")
        return v


class ExecRequest(BaseModel):
    command: str = Field(..., min_length=1)
    network: Literal["none", "egress"] = "none"
    # timeout is optional; when omitted it defaults to the selected image's
    # default, and is capped to that image's ceiling. Bounded to a hard max so
    # a request can never exceed the largest configured cap.
    timeout: Optional[int] = Field(None, ge=5, le=MAX_TIMEOUT_HARD)
    files: Optional[List[InputFile]] = None
    # Opt-in raw sockets (e.g. nmap -sS, masscan). ONLY honored when
    # network == "egress"; ignored under "none" (raw sockets are meaningless
    # without a network). When honored, adds *only* CAP_NET_RAW on top of the
    # default --cap-drop ALL — no other capability.
    raw: bool = False
    # Which toolbox image to run. "base" (lean, default) or "heavy" (reserved
    # RE/forensics). Absent/unknown/wrong-type ALL fall back to "base" — this
    # field must never break existing flows, so it is normalized, not validated.
    image: str = DEFAULT_IMAGE

    @field_validator("image", mode="before")
    @classmethod
    def _normalize_image(cls, v) -> str:
        return v if v in IMAGE_PROFILES else DEFAULT_IMAGE


class ExecResponse(BaseModel):
    ok: bool
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    duration_s: float


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #


def require_auth(authorization: str = Header(default="")) -> str:
    """Constant-time bearer-token check. Missing/wrong -> 401. Returns the
    validated token, used as the rate-limit key."""
    if not TOKEN:
        # Fail closed: never run without a configured token.
        raise HTTPException(status_code=503, detail="server token not configured")

    expected = f"Bearer {TOKEN}"
    provided = authorization or ""
    # hmac.compare_digest is constant-time for equal-length inputs; comparing
    # the full "Bearer <token>" strings avoids leaking the scheme boundary.
    if not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="unauthorized")
    return TOKEN


# --------------------------------------------------------------------------- #
# Throttling: token-bucket rate limit + hard concurrency cap
# (in-process, single-worker only — in-memory counters are not shared across
# workers, which is why the box must stay single-worker.)
# --------------------------------------------------------------------------- #


class RateLimited(Exception):
    """Raised to reject a request with 429. `error` is a short machine token
    (no internals leaked); `retry_after` is seconds."""

    def __init__(self, error: str, retry_after: int) -> None:
        self.error = error
        self.retry_after = max(1, int(retry_after))


class TokenBucket:
    """Classic token bucket keyed by an arbitrary string. Capacity == burst;
    refill == rate_per_min/60 tokens per second. Not awaited between check and
    mutate, so it is race-free under single-threaded asyncio."""

    def __init__(self, rate_per_min: int, burst: int) -> None:
        self.rate = rate_per_min / 60.0
        self.burst = float(max(1, burst))
        self._state: dict[str, tuple[float, float]] = {}

    def allow(self, key: str) -> tuple[bool, int]:
        now = time.monotonic()
        tokens, last = self._state.get(key, (self.burst, now))
        tokens = min(self.burst, tokens + (now - last) * self.rate)
        if tokens >= 1.0:
            self._state[key] = (tokens - 1.0, now)
            return True, 0
        self._state[key] = (tokens, now)
        if self.rate <= 0:
            return False, 60
        retry = math.ceil((1.0 - tokens) / self.rate)
        return False, max(1, retry)


class ConcurrencyGuard:
    """Non-blocking counting guard. try_acquire()/release() have no await
    between the check and the mutation, so the cap is never exceeded."""

    def __init__(self, limit: int) -> None:
        self.limit = max(1, limit)
        self.active = 0

    def try_acquire(self) -> bool:
        if self.active >= self.limit:
            return False
        self.active += 1
        return True

    def release(self) -> None:
        if self.active > 0:
            self.active -= 1


_token_bucket = TokenBucket(EXEC_RATE_PER_MIN, EXEC_RATE_BURST)
_ip_bucket = TokenBucket(EXEC_IP_RATE_PER_MIN, EXEC_IP_RATE_BURST)
_concurrency = ConcurrencyGuard(EXEC_MAX_CONCURRENCY)


# --------------------------------------------------------------------------- #
# Execution helpers
# --------------------------------------------------------------------------- #


def _capped_reader(stream, cap: int, sink: list) -> None:
    """Read a byte stream, keeping at most `cap` bytes, always draining the
    rest so the child never blocks on a full pipe."""
    read = 0
    while True:
        chunk = stream.read(65536)
        if not chunk:
            break
        if read < cap:
            take = cap - read
            sink.append(chunk[:take])
            read += min(len(chunk), take)
        # else: keep draining, discard.
    try:
        stream.close()
    except Exception:
        pass


def _decode_to_str(sink: list, cap: int) -> str:
    data = b"".join(sink)[:cap]
    return data.decode("utf-8", errors="replace")


def run_command(req: ExecRequest) -> ExecResponse:
    # Create the throwaway workdir under WORK_ROOT (host-visible), NOT the
    # process /tmp — see the WORK_ROOT note above.
    workdir = tempfile.mkdtemp(prefix="cyber-exec-", dir=WORK_ROOT)
    # The non-root container user (uid 1000) must be able to traverse the
    # workdir and read the inputs; make the throwaway dir world-usable.
    os.chmod(workdir, 0o777)

    container_name = f"cyberexec-{os.path.basename(workdir)}"
    started = time.monotonic()
    timed_out = False

    try:
        # 1) Materialize any supplied files into the workdir.
        if req.files:
            for f in req.files:
                try:
                    raw = base64.b64decode(f.b64, validate=True)
                except (binascii.Error, ValueError) as exc:
                    raise HTTPException(
                        status_code=400,
                        detail=f"invalid base64 for file {f.name!r}: {exc}",
                    )
                dest = os.path.join(workdir, f.name)
                with open(dest, "wb") as fh:
                    fh.write(raw)
                os.chmod(dest, 0o644)

        # 2) Resolve the per-image profile (image, resources, timeout). The
        # `image` field is already normalized to a known key ("base"/"heavy").
        profile = IMAGE_PROFILES[req.image]
        # Effective timeout: caller value or the image default, capped to the
        # image ceiling. Security envelope differs per image; base is untouched.
        effective_timeout = req.timeout if req.timeout is not None else profile["timeout_default"]
        effective_timeout = max(5, min(effective_timeout, profile["timeout_cap"]))

        # Clamp --cpus to the host's CPU count: docker errors hard (exit 125) if
        # asked for more CPUs than exist. This lets the heavy profile ask for
        # "more CPU" where the hardware allows, without failing on small boxes.
        cpus = profile["cpus"]
        try:
            host_cpus = os.cpu_count() or 1
            if float(cpus) > host_cpus:
                cpus = str(host_cpus)
        except (TypeError, ValueError):
            pass

        # 3) Assemble the hardened `docker run` invocation.
        network = "none" if req.network == "none" else "bridge"

        # Raw sockets: only when explicitly requested AND egress is on. Under
        # --network none there is nothing to send raw packets over, so raw is
        # silently ignored there. When granted, add ONLY CAP_NET_RAW.
        raw_granted = req.raw and req.network == "egress"

        argv = [
            DOCKER_BIN, "run", "--rm",
            "--name", container_name,
            "--network", network,
            "--cap-drop", "ALL",
        ]
        if raw_granted:
            argv += ["--cap-add", "NET_RAW"]
        argv += [
            "--security-opt", "no-new-privileges",
            "--pids-limit", PIDS_LIMIT,
            "--memory", profile["memory"],
            "--cpus", cpus,
            "--user", CONTAINER_USER,
            "-v", f"{workdir}:/work:rw",
        ]
        # Optional, read-only Volatility3 symbol cache — heavy image only.
        if req.image == "heavy" and VOL_SYMBOL_CACHE:
            argv += ["-v", f"{VOL_SYMBOL_CACHE}:{VOL_SYMBOL_MOUNT}:ro"]
        argv += [
            "-w", "/work",
            profile["image"],
            "bash", "-lc", req.command,
        ]

        log.info(
            "exec image=%s network=%s raw=%s(granted=%s) timeout=%ds files=%d cmd=%r",
            req.image, req.network, req.raw, raw_granted, effective_timeout,
            len(req.files or []), req.command,
        )

        proc = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
        )

        out_sink: list = []
        err_sink: list = []
        t_out = threading.Thread(
            target=_capped_reader, args=(proc.stdout, OUTPUT_CAP_BYTES, out_sink)
        )
        t_err = threading.Thread(
            target=_capped_reader, args=(proc.stderr, OUTPUT_CAP_BYTES, err_sink)
        )
        t_out.start()
        t_err.start()

        try:
            proc.wait(timeout=effective_timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            log.warning("timeout after %ds; killing container %s",
                        effective_timeout, container_name)
            # Kill the container itself (fast, reaps everything inside).
            _docker_kill(container_name)
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()

        t_out.join(timeout=5)
        t_err.join(timeout=5)

        exit_code = proc.returncode if proc.returncode is not None else -1
        duration = round(time.monotonic() - started, 3)

        stdout = _decode_to_str(out_sink, OUTPUT_CAP_BYTES)
        stderr = _decode_to_str(err_sink, OUTPUT_CAP_BYTES)

        return ExecResponse(
            ok=(not timed_out and exit_code == 0),
            exit_code=exit_code,
            stdout=stdout,
            stderr=stderr,
            timed_out=timed_out,
            duration_s=duration,
        )

    finally:
        # Always teardown the container (belt-and-suspenders with --rm) and
        # delete the throwaway workdir. No persistence between runs.
        _docker_rm(container_name)
        _cleanup_workdir(workdir)


def _docker_kill(name: str) -> None:
    try:
        subprocess.run(
            [DOCKER_BIN, "kill", name],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=20, check=False,
        )
    except Exception as exc:  # pragma: no cover - best effort
        log.warning("docker kill failed for %s: %s", name, exc)


def _docker_rm(name: str) -> None:
    try:
        subprocess.run(
            [DOCKER_BIN, "rm", "-f", name],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=20, check=False,
        )
    except Exception as exc:  # pragma: no cover - best effort
        log.warning("docker rm failed for %s: %s", name, exc)


def _cleanup_workdir(workdir: str) -> None:
    """Delete the throwaway workdir. A container-created subdir may be owned by
    the container uid with a restrictive mode (e.g. 0700) that the (different)
    service user cannot traverse, so a plain rmtree would silently leave data
    behind. In that case wipe the contents from inside a throwaway root
    container (no network, all caps dropped), then drop the empty dir. Log a
    LEAK if anything survives instead of swallowing it (F2)."""
    shutil.rmtree(workdir, ignore_errors=True)
    if not os.path.exists(workdir):
        return
    log.warning("workdir %s not fully removed; using root-container cleanup", workdir)
    try:
        subprocess.run(
            [DOCKER_BIN, "run", "--rm", "--network", "none",
             "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
             "--user", "0", "-v", f"{workdir}:/work:rw", IMAGE,
             "find", "/work", "-mindepth", "1", "-delete"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=60, check=False,
        )
    except Exception as exc:  # pragma: no cover - best effort
        log.warning("root-container cleanup failed for %s: %s", workdir, exc)
    shutil.rmtree(workdir, ignore_errors=True)
    if os.path.exists(workdir):
        log.error("workdir LEAK: could not remove %s", workdir)


def _startup_sweep() -> None:
    """Remove stale throwaway workdirs and dangling `cyberexec-*` containers on
    startup. The per-request finally teardown does not run on SIGKILL/OOM/power
    loss, so a hard-killed run can orphan its workdir and container (F3)."""
    try:
        for name in os.listdir(WORK_ROOT):
            if name.startswith("cyber-exec-"):
                _cleanup_workdir(os.path.join(WORK_ROOT, name))
    except FileNotFoundError:
        pass
    except Exception as exc:  # pragma: no cover - best effort
        log.warning("startup workdir sweep failed: %s", exc)
    try:
        res = subprocess.run(
            [DOCKER_BIN, "ps", "-aq", "--filter", "name=cyberexec-"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=20, check=False, text=True,
        )
        ids = [x for x in (res.stdout or "").split() if x]
        if ids:
            log.warning("startup: removing %d stale cyberexec-* container(s)", len(ids))
            subprocess.run(
                [DOCKER_BIN, "rm", "-f", *ids],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=60, check=False,
            )
    except Exception as exc:  # pragma: no cover - best effort
        log.warning("startup container sweep failed: %s", exc)


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #

app = FastAPI(title="cyber-exec", version="1.0.0")

# Sweep any workdirs/containers orphaned by a previous hard-killed run (F3).
_startup_sweep()


@app.exception_handler(RateLimited)
async def _rate_limited_handler(request: Request, exc: RateLimited) -> JSONResponse:
    # Uniform 429 body + Retry-After; no internals leaked.
    return JSONResponse(
        status_code=429,
        content={"error": exc.error, "retry_after": exc.retry_after},
        headers={"Retry-After": str(exc.retry_after)},
    )


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def ip_guard(request: Request) -> None:
    """Optional coarse per-IP rate limit, applied BEFORE auth to blunt token
    brute-force. Disabled unless EXEC_IP_RATE_PER_MIN > 0."""
    if EXEC_IP_RATE_PER_MIN <= 0:
        return
    ok, retry = _ip_bucket.allow(_client_ip(request))
    if not ok:
        raise RateLimited("rate_limited", retry)


@app.get("/healthz")
def healthz() -> dict:
    # Exempt from auth + throttling: must answer even while saturated.
    return {"ok": True}


@app.post("/api/exec", response_model=ExecResponse)
async def exec_endpoint(
    req: ExecRequest,
    _ip: None = Depends(ip_guard),          # optional per-IP guard (pre-auth)
    token: str = Depends(require_auth),      # auth first -> 401 before any 429
) -> ExecResponse:
    # Rate limit (token bucket) — checked BEFORE spinning a container.
    ok, retry = _token_bucket.allow(token)
    if not ok:
        raise RateLimited("rate_limited", retry)

    # Hard concurrency cap — fail closed, never exceed N live containers.
    if not _concurrency.try_acquire():
        raise RateLimited("concurrency_limited", EXEC_CONC_RETRY_AFTER)
    try:
        # Offload the blocking docker run so the event loop stays responsive
        # (health checks answer, overflow requests get rejected) while busy.
        return await asyncio.to_thread(run_command, req)
    finally:
        # Release on success, timeout, OR crash — the slot is never leaked.
        _concurrency.release()
