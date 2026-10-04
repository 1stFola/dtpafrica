"""The control-plane client and the loop's handling of its failures (docs/vision/50, PR-3).

A worker on a GPU pod is billed by the minute. These tests are about the ways it used
to keep running, or stop, for the wrong reasons: a claim that kept failing, a `fail`
that raised from inside an `except`, a heartbeat refused because the job was gone,
and a presigned URL's signature written into the job's stored error.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from dtp_vision_worker.config import CONTRACT_VERSION, load_config
from dtp_vision_worker.control_plane import ControlPlaneClient, ControlPlaneError, JobLostError, redact_urls
from dtp_vision_worker.runner import ProgressReporter, StageContext, StageResult, Worker

ENV = {
    "VISION_WORKER_CALLBACK_URL": "https://api.example.test/api/v1/vision/worker",
    "VISION_BOOTSTRAP_TOKEN": "b" * 64,
    "VISION_RESOURCE_CLASS": "cpu_small",
    "VISION_IDLE_SHUTDOWN_SECONDS": "0.05",
    "VISION_POLL_SECONDS": "0.01",
    "VISION_HEARTBEAT_SECONDS": "60",
}


def client_with(handler) -> ControlPlaneClient:
    config = load_config(ENV)
    http = httpx.Client(base_url=config.callback_url, transport=httpx.MockTransport(handler))
    c = ControlPlaneClient(config, client=http)
    c._worker_token = "w" * 64  # noqa: SLF001 - registered, for these tests
    c._sleep = lambda s: None  # noqa: SLF001
    return c


def test_redact_urls_drops_the_signature_and_keeps_the_object() -> None:
    text = "GET https://bucket.r2.example/inference/j/1/proxy.mp4?X-Amz-Signature=abc&X-Amz-Credential=k failed"
    out = redact_urls(text)
    assert "X-Amz" not in out and "abc" not in out
    assert "https://bucket.r2.example/inference/j/1/proxy.mp4?<redacted>" in out


def test_fail_never_raises_even_when_the_network_is_down() -> None:
    calls: list[int] = []

    def down(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        raise httpx.ConnectError("refused")

    client_with(down).fail("job-1", "RuntimeError", "boom")
    assert len(calls) == 4  # retried, then gave up quietly


def test_fail_redacts_urls_in_the_detail_it_sends() -> None:
    sent: list[dict[str, Any]] = []

    def ok(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})

    client_with(ok).fail("job-1", "RuntimeError", "PUT https://x.example/k?X-Amz-Signature=secret answered 403")
    assert "secret" not in sent[0]["detail"]


def test_complete_is_retried_through_a_5xx_and_a_dropped_connection() -> None:
    answers = iter(["drop", 503, 200])

    def flaky(request: httpx.Request) -> httpx.Response:
        a = next(answers)
        if a == "drop":
            raise httpx.ReadError("connection reset")
        return httpx.Response(a, json={"ok": True, "alreadyApplied": False})

    out = client_with(flaky).complete("job-1", "job-1:1", [], {}, {})
    assert out["ok"] is True


def test_complete_does_not_retry_a_refusal() -> None:
    calls: list[int] = []

    def refused(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(409, json={"error": "JobNotClaimable"})

    with pytest.raises(ControlPlaneError) as caught:
        client_with(refused).complete("job-1", "job-1:1", [], {}, {})
    assert caught.value.status == 409 and len(calls) == 1


@pytest.mark.parametrize("status", [403, 404, 409, 410])
def test_a_refused_heartbeat_means_the_job_is_lost(status: int) -> None:
    c = client_with(lambda r: httpx.Response(status, json={}))
    with pytest.raises(JobLostError):
        c.heartbeat("job-1", "transcode")


def test_a_lost_job_stops_the_stage_at_its_next_progress_call() -> None:
    reporter = ProgressReporter(client=None, job_id="job-1", interval=60)  # type: ignore[arg-type]
    reporter.set("download")
    reporter.lost = JobLostError("gone", 409)
    with pytest.raises(JobLostError):
        reporter.set("transcode")


def test_register_records_the_server_heartbeat_and_the_worker_uses_the_tighter() -> None:
    def registered(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "workerId": "w-1", "workerToken": "t" * 64, "resourceClasses": ["cpu_small"],
            "contractVersion": CONTRACT_VERSION, "heartbeatIntervalSeconds": 20, "pollIntervalMs": 4000,
        })

    c = client_with(registered)
    c.register()
    assert c.server_heartbeat_seconds == 20.0
    worker = Worker(load_config(ENV), client=c)
    assert worker.heartbeat_seconds == 20.0  # ours is 60


# ── The loop ────────────────────────────────────────────────────────────────


class Plane:
    def __init__(self, claims: list[Any]) -> None:
        self.claims = list(claims)
        self.failures: list[dict[str, Any]] = []
        self.completions: list[dict[str, Any]] = []

    def register(self) -> None:
        pass

    def claim(self):
        if not self.claims:
            return None
        item = self.claims.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    def heartbeat(self, *a: object, **k: object) -> None:
        pass

    def complete(self, job_id: str, **kwargs: Any) -> dict[str, Any]:
        self.completions.append({"jobId": job_id, **kwargs})
        return {"ok": True}

    def fail(self, job_id: str, reason: str, detail: str = "", retryable: bool = True) -> None:
        self.failures.append({"jobId": job_id, "reason": reason, "detail": detail})

    def close(self) -> None:
        pass


def test_a_refused_claim_stops_the_worker_instead_of_looping(tmp_path: Path) -> None:
    plane = Plane([ControlPlaneError("claim failed: HTTP 401", 401)] + [None] * 1000)
    worker = Worker(load_config({**ENV, "VISION_WORK_DIR": str(tmp_path)}), client=plane)  # type: ignore[arg-type]
    worker.run_forever()
    assert len(plane.claims) == 1000  # stopped at the refusal, did not poll on


def test_claims_that_keep_failing_count_toward_idle_shutdown(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("dtp_vision_worker.runner.time.sleep", lambda s: None)
    plane = Plane([httpx.ConnectError("refused")] * 100000)
    worker = Worker(load_config({**ENV, "VISION_WORK_DIR": str(tmp_path)}), client=plane)  # type: ignore[arg-type]
    worker.run_forever()  # returns: before PR-3 this never did
    assert plane.claims  # gave up long before exhausting them


def test_a_job_taken_away_mid_stage_is_abandoned_not_failed(tmp_path: Path) -> None:
    from dtp_vision_worker.control_plane import JobSpec

    spec = JobSpec.from_payload({
        "contractVersion": CONTRACT_VERSION, "jobId": "job-1", "type": "probe", "resourceClass": "cpu_small",
        "attemptNumber": 1, "inputs": {}, "outputPrefix": "inference/job-1/1/",
        "budget": {"maxRuntimeSeconds": 60, "maxCostUsdCents": 10},
    })
    plane = Plane([])

    def stage(ctx: StageContext) -> StageResult:
        ctx.progress.lost = JobLostError("cancelled", 409)
        ctx.progress.set("next")
        return StageResult()

    worker = Worker(load_config({**ENV, "VISION_WORK_DIR": str(tmp_path)}), client=plane)  # type: ignore[arg-type]
    worker._stages = {"probe": stage}  # noqa: SLF001
    assert worker.run_one(spec) is False
    assert plane.failures == [] and plane.completions == []


# ── which control plane a job may come from (docs/vision/58) ─────────────────


def _payload(version: object) -> dict:
    return {
        "contractVersion": version, "jobId": "job-1", "type": "probe", "resourceClass": "cpu_small",
        "attemptNumber": 1, "inputs": {}, "outputPrefix": "inference/job-1/1/",
        "budget": {"maxRuntimeSeconds": 60, "maxCostUsdCents": 10},
    }


def test_a_job_from_a_newer_control_plane_of_the_same_major_is_taken() -> None:
    from dtp_vision_worker.control_plane import JobSpec

    major, minor, patch = (int(p) for p in CONTRACT_VERSION.split("."))
    assert JobSpec.from_payload(_payload(CONTRACT_VERSION)).job_id == "job-1"
    # The control plane was bumped and this image was not rebuilt: it still serves.
    assert JobSpec.from_payload(_payload(f"{major}.{minor + 1}.0")).type == "probe"
    assert JobSpec.from_payload(_payload(f"{major}.{minor}.{patch + 1}")).type == "probe"


def test_a_job_from_another_major_or_an_older_control_plane_is_refused() -> None:
    from dtp_vision_worker.control_plane import ContractMismatchError, JobSpec

    major, minor, _patch = (int(p) for p in CONTRACT_VERSION.split("."))
    for version in (f"{major + 1}.0.0", f"{major}.{minor - 1}.0", None, "latest"):
        with pytest.raises(ContractMismatchError):
            JobSpec.from_payload(_payload(version))
