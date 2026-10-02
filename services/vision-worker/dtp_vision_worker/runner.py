"""The worker loop.

Pulls one job at a time, runs it, reports, repeats. Drains the queue and exits
rather than idling, because an unnoticed running pod is the commonest way to burn
a compute budget.

See docs/vision/06-JOBS-AND-COMPUTE.md.
"""

from __future__ import annotations

import logging
import shutil
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from .config import WorkerConfig
from .control_plane import ContractMismatchError, ControlPlaneClient, JobSpec

log = logging.getLogger(__name__)


@dataclass
class StageContext:
    """Everything a stage is allowed to touch."""

    job: JobSpec
    work_dir: Path
    client: ControlPlaneClient
    http: httpx.Client
    progress: "ProgressReporter"


@dataclass
class StageResult:
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    summary: dict[str, Any] = field(default_factory=dict)
    bytes_read: int = 0
    bytes_written: int = 0
    class_a_operations: int = 0
    class_b_operations: int = 0
    #: Seconds this stage actually spent on a GPU, when it used one. `None` means the
    #: stage did not touch a GPU -- which was every stage until `detect` -- and is
    #: reported as zero. A stage that ran inference on CUDA and left this unset would
    #: bill the cost ledger for no GPU time at all, and the cost model would then
    #: understate the expensive half of the pipeline forever.
    gpu_seconds: float | None = None
    #: Model versions this stage ran, as the control plane named them in the job's
    #: inputs. Empty for a stage that runs no model. Reported on completion, where the
    #: control plane checks it against the job it dispatched.
    model_version_ids: list[str] = field(default_factory=list)


class StageRefusal(RuntimeError):
    """A stage declining to run because its inputs cannot produce a valid result.

    Not retryable: the same job on the same image fails the same way, and burning the
    remaining attempts on it is how a misconfigured dispatch costs three GPU minutes
    instead of none. The runner reads `retryable` off the exception.
    """

    retryable = False


class ProgressReporter:
    """Heartbeats on a timer, not on every loop iteration.

    Throttled because progress is a write to the control plane's database, and a
    chatty worker on a 2 GB box is a self-inflicted load problem.
    """

    def __init__(self, client: ControlPlaneClient, job_id: str, interval: float) -> None:
        self._client = client
        self._job_id = job_id
        self._interval = interval
        self._stage = "starting"
        self._fraction: float | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def set(self, stage: str, fraction: float | None = None) -> None:
        self._stage = stage
        self._fraction = fraction

    def __enter__(self) -> ProgressReporter:
        self._thread = threading.Thread(target=self._loop, name="heartbeat", daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _loop(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                self._client.heartbeat(self._job_id, self._stage, self._fraction)
            except Exception as exc:  # noqa: BLE001 - never kill the job over a heartbeat
                log.warning("heartbeat failed: %s", exc)


class Worker:
    def __init__(self, config: WorkerConfig, client: ControlPlaneClient | None = None) -> None:
        from .stages import STAGES

        self._config = config
        self._client = client or ControlPlaneClient(config)
        self._stages = STAGES
        self._http = httpx.Client(timeout=httpx.Timeout(60.0, read=1800.0))
        self.jobs_completed = 0
        self.jobs_failed = 0

    def run_forever(self) -> None:
        self._client.register()
        idle_since: float | None = None

        while True:
            try:
                job = self._client.claim()
            except ContractMismatchError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("claim failed, backing off: %s", exc)
                time.sleep(self._config.poll_seconds)
                continue

            if job is None:
                now = time.monotonic()
                idle_since = idle_since or now
                if now - idle_since >= self._config.idle_shutdown_seconds:
                    log.info("queue drained, shutting down")
                    return
                time.sleep(self._config.poll_seconds)
                continue

            idle_since = None
            self.run_one(job)

    def run_one(self, job: JobSpec) -> bool:
        """Run a single job. Returns True when it completed successfully."""
        handler = self._stages.get(job.type)
        if handler is None:
            # Not retryable: another attempt on this image would fail the same
            # way. A different image may well handle it.
            log.error("no handler for job type %s", job.type)
            self._client.fail(
                job.job_id,
                reason=f"unsupported job type {job.type}",
                detail=f"image {self._config.image} implements {sorted(self._stages)}",
                retryable=False,
            )
            self.jobs_failed += 1
            return False

        work_dir = Path(self._config.work_dir) / job.job_id / str(job.attempt_number)
        started = time.monotonic()
        log.info("starting %s job %s (attempt %s)", job.type, job.job_id, job.attempt_number)

        try:
            work_dir.mkdir(parents=True, exist_ok=True)
            with ProgressReporter(
                self._client, job.job_id, self._config.heartbeat_seconds
            ) as progress:
                ctx = StageContext(
                    job=job,
                    work_dir=work_dir,
                    client=self._client,
                    http=self._http,
                    progress=progress,
                )
                result = handler(ctx)

            elapsed = time.monotonic() - started
            self._client.complete(
                job.job_id,
                # Deterministic from the job and its attempt, so a retried
                # completion after a dropped connection is recognised rather than
                # double-applied.
                idempotency_key=f"{job.job_id}:{job.attempt_number}",
                artifacts=result.artifacts,
                summary=result.summary,
                model_version_ids=result.model_version_ids,
                cost={
                    "cpuSeconds": round(elapsed, 3),
                    "gpuSeconds": (
                        round(result.gpu_seconds, 3)
                        if result.gpu_seconds is not None
                        else 0
                    ),
                    "wallClockSeconds": round(elapsed, 3),
                    "bytesRead": result.bytes_read,
                    "bytesWritten": result.bytes_written,
                    "classAOperations": result.class_a_operations,
                    "classBOperations": result.class_b_operations,
                },
            )
            log.info("completed %s in %.1fs", job.job_id, elapsed)
            self.jobs_completed += 1
            return True

        except Exception as exc:  # noqa: BLE001 - one bad job must not kill the worker
            log.exception("job %s failed", job.job_id)
            self._client.fail(
                job.job_id,
                reason=type(exc).__name__,
                detail=str(exc),
                # A stage that refused its inputs says so; everything else is assumed
                # transient, which is the queue's default.
                retryable=bool(getattr(exc, "retryable", True)),
            )
            self.jobs_failed += 1
            return False

        finally:
            # Ephemeral hardware still has a finite disk, and a 6 GB master plus a
            # proxy per job fills it fast.
            shutil.rmtree(work_dir, ignore_errors=True)

    def close(self) -> None:
        self._http.close()
        self._client.close()


def download(ctx: StageContext, url: str, target: Path) -> int:
    """Stream an object to disk. Returns bytes written."""
    target.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    with ctx.http.stream("GET", url) as res:
        res.raise_for_status()
        with target.open("wb") as handle:
            for chunk in res.iter_bytes(8 * 1024 * 1024):
                handle.write(chunk)
                total += len(chunk)
    return total


def upload(ctx: StageContext, url: str, source: Path, content_type: str) -> int:
    """PUT an object through a presigned URL. Returns bytes sent."""
    size = source.stat().st_size
    with source.open("rb") as handle:
        res = ctx.http.put(
            url,
            content=handle,
            headers={"Content-Type": content_type, "Content-Length": str(size)},
        )
    res.raise_for_status()
    return size
