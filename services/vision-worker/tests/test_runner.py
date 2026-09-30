"""Worker loop behaviour, with a fake control plane.

Covers what the loop owes its operator: never die over one bad job, never retry
something a retry cannot fix, always report, always clean up its disk.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from dtp_vision_worker.config import CONTRACT_VERSION, load_config
from dtp_vision_worker.control_plane import ContractMismatchError, JobSpec
from dtp_vision_worker.runner import StageContext, StageResult, Worker

ENV = {
    "VISION_WORKER_CALLBACK_URL": "https://api.example.test/api/v1/vision/worker",
    "VISION_BOOTSTRAP_TOKEN": "b" * 64,
    "VISION_RESOURCE_CLASS": "cpu_small",
    "VISION_IDLE_SHUTDOWN_SECONDS": "0.01",
    "VISION_POLL_SECONDS": "0.01",
    "VISION_HEARTBEAT_SECONDS": "60",
}


def spec(job_type: str = "probe", attempt: int = 1) -> JobSpec:
    return JobSpec.from_payload(
        {
            "contractVersion": CONTRACT_VERSION,
            "jobId": "job-1",
            "type": job_type,
            "resourceClass": "cpu_small",
            "attemptNumber": attempt,
            "inputs": {"videoAssetId": "asset-1"},
            "outputPrefix": "inference/job-1/1/",
            "budget": {"maxRuntimeSeconds": 60, "maxCostUsdCents": 10},
        }
    )


class FakeControlPlane:
    def __init__(self, jobs: list[JobSpec] | None = None) -> None:
        self._jobs = list(jobs or [])
        self.registered = False
        self.completions: list[dict[str, Any]] = []
        self.failures: list[dict[str, Any]] = []
        self.heartbeats = 0

    def register(self) -> None:
        self.registered = True

    def claim(self) -> JobSpec | None:
        return self._jobs.pop(0) if self._jobs else None

    def heartbeat(self, *_a: object, **_k: object) -> None:
        self.heartbeats += 1

    def complete(self, job_id: str, idempotency_key: str, artifacts, summary, cost):
        self.completions.append(
            {
                "jobId": job_id,
                "idempotencyKey": idempotency_key,
                "artifacts": artifacts,
                "summary": summary,
                "cost": cost,
            }
        )
        return {"ok": True, "alreadyApplied": False}

    def fail(self, job_id: str, reason: str, detail: str = "", retryable: bool = True) -> None:
        self.failures.append(
            {"jobId": job_id, "reason": reason, "detail": detail, "retryable": retryable}
        )

    def close(self) -> None:
        pass


def make_worker(tmp_path: Path, plane: FakeControlPlane, stages: dict[str, Any]) -> Worker:
    config = load_config({**ENV, "VISION_WORK_DIR": str(tmp_path)})
    worker = Worker(config, client=plane)  # type: ignore[arg-type]
    worker._stages = stages  # noqa: SLF001 - substituting the stage table is the point
    return worker


def test_reports_a_completion_with_a_deterministic_idempotency_key(tmp_path: Path) -> None:
    plane = FakeControlPlane()
    worker = make_worker(
        tmp_path,
        plane,
        {"probe": lambda ctx: StageResult(summary={"ok": True}, bytes_read=10)},
    )

    assert worker.run_one(spec()) is True
    assert len(plane.completions) == 1
    # Derived from job + attempt, so a retried completion after a dropped
    # connection is recognised rather than double-applied.
    assert plane.completions[0]["idempotencyKey"] == "job-1:1"
    assert plane.completions[0]["cost"]["gpuSeconds"] == 0


def test_a_retry_of_the_same_job_uses_a_different_key(tmp_path: Path) -> None:
    plane = FakeControlPlane()
    worker = make_worker(tmp_path, plane, {"probe": lambda ctx: StageResult()})
    worker.run_one(spec(attempt=1))
    worker.run_one(spec(attempt=2))
    keys = [c["idempotencyKey"] for c in plane.completions]
    assert keys == ["job-1:1", "job-1:2"]


def test_one_bad_job_does_not_kill_the_worker(tmp_path: Path) -> None:
    plane = FakeControlPlane()

    def boom(_ctx: StageContext) -> StageResult:
        raise RuntimeError("ffmpeg fell over")

    worker = make_worker(tmp_path, plane, {"probe": boom})

    assert worker.run_one(spec()) is False
    assert worker.jobs_failed == 1
    assert plane.failures[0]["reason"] == "RuntimeError"
    assert "ffmpeg fell over" in plane.failures[0]["detail"]
    # Retryable by default: a transient decode failure may well succeed next time.
    assert plane.failures[0]["retryable"] is True


def test_an_unsupported_job_type_is_not_retryable(tmp_path: Path) -> None:
    """Another attempt on this image would fail identically. A different image
    may handle it, so the job fails terminally rather than burning attempts."""
    plane = FakeControlPlane()
    worker = make_worker(tmp_path, plane, {"probe": lambda ctx: StageResult()})

    assert worker.run_one(spec("detect")) is False
    assert plane.failures[0]["retryable"] is False
    assert "unsupported job type detect" in plane.failures[0]["reason"]


def test_cleans_up_its_working_directory_even_after_a_failure(tmp_path: Path) -> None:
    plane = FakeControlPlane()

    def leave_a_big_file(ctx: StageContext) -> StageResult:
        (ctx.work_dir / "source").write_bytes(b"x" * 1024)
        raise RuntimeError("failed after downloading")

    worker = make_worker(tmp_path, plane, {"probe": leave_a_big_file})
    worker.run_one(spec())

    # Ephemeral hardware still has a finite disk, and a master plus a proxy per
    # job fills it fast.
    assert not (tmp_path / "job-1" / "1").exists()


def test_drains_the_queue_then_exits_rather_than_idling(tmp_path: Path) -> None:
    plane = FakeControlPlane([spec(), spec()])
    worker = make_worker(tmp_path, plane, {"probe": lambda ctx: StageResult()})

    worker.run_forever()

    assert plane.registered is True
    assert worker.jobs_completed == 2
    assert len(plane.completions) == 2


def test_a_contract_mismatch_is_fatal(tmp_path: Path) -> None:
    """Restarting cannot fix a version mismatch, and a worker that guesses at a
    changed job spec corrupts data quietly."""
    plane = FakeControlPlane()

    def mismatched() -> JobSpec | None:
        raise ContractMismatchError("control plane speaks 2.0.0")

    plane.claim = mismatched  # type: ignore[method-assign]
    worker = make_worker(tmp_path, plane, {})

    with pytest.raises(ContractMismatchError):
        worker.run_forever()


def test_job_spec_rejects_a_foreign_contract_version() -> None:
    with pytest.raises(ContractMismatchError):
        JobSpec.from_payload(
            {
                "contractVersion": "0.0.1",
                "jobId": "j",
                "type": "probe",
                "resourceClass": "cpu_small",
                "outputPrefix": "inference/j/1/",
            }
        )


def test_a_gpu_stage_bills_the_gpu_seconds_it_reports(tmp_path: Path) -> None:
    """`gpuSeconds` used to be the literal 0 for every job, which was true while every
    stage was CPU. A GPU stage reporting real inference time would have had it thrown away
    on the way to the cost ledger -- and GPU seconds are the expensive half of the unit
    economics Spike S0 exists to measure."""
    plane = FakeControlPlane()
    worker = make_worker(
        tmp_path, plane, {"probe": lambda ctx: StageResult(gpu_seconds=12.3456)}
    )

    assert worker.run_one(spec()) is True
    assert plane.completions[0]["cost"]["gpuSeconds"] == 12.346
