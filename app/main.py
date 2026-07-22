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
"""

from __future__ import annotations

import base64
import binascii
import hmac
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from typing import List, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
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
    timeout: int = Field(60, ge=5, le=600)
    files: Optional[List[InputFile]] = None
    # Opt-in raw sockets (e.g. nmap -sS, masscan). ONLY honored when
    # network == "egress"; ignored under "none" (raw sockets are meaningless
    # without a network). When honored, adds *only* CAP_NET_RAW on top of the
    # default --cap-drop ALL — no other capability.
    raw: bool = False


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


def require_auth(authorization: str = Header(default="")) -> None:
    """Constant-time bearer-token check. Missing/wrong -> 401."""
    if not TOKEN:
        # Fail closed: never run without a configured token.
        raise HTTPException(status_code=503, detail="server token not configured")

    expected = f"Bearer {TOKEN}"
    provided = authorization or ""
    # hmac.compare_digest is constant-time for equal-length inputs; comparing
    # the full "Bearer <token>" strings avoids leaking the scheme boundary.
    if not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="unauthorized")


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

        # 2) Assemble the hardened `docker run` invocation.
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
            "--memory", MEMORY_LIMIT,
            "--cpus", CPUS_LIMIT,
            "--user", CONTAINER_USER,
            "-v", f"{workdir}:/work:rw",
            "-w", "/work",
            IMAGE,
            "bash", "-lc", req.command,
        ]

        log.info(
            "exec network=%s raw=%s(granted=%s) timeout=%ds files=%d cmd=%r",
            req.network, req.raw, raw_granted, req.timeout,
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
            proc.wait(timeout=req.timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            log.warning("timeout after %ds; killing container %s",
                        req.timeout, container_name)
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
        shutil.rmtree(workdir, ignore_errors=True)


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


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #

app = FastAPI(title="cyber-exec", version="1.0.0")


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/api/exec", response_model=ExecResponse)
def exec_endpoint(req: ExecRequest, _: None = Depends(require_auth)) -> ExecResponse:
    return run_command(req)
