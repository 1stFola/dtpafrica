"""HTTP client for the control plane.

The worker's entire view of the outside world. It pulls work, reports progress,
and asks permission for every object it reads or writes — it holds no storage
credential of its own, so there is nothing here that can reach an object the
control plane did not hand it.

See docs/vision/07-API-CONTRACTS.md.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from typing import Any, Callable

import httpx

from .config import CONTRACT_VERSION, WorkerConfig

log = logging.getLogger(__name__)


class ControlPlaneError(RuntimeError):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class JobLostError(ControlPlaneError):
    """The control plane says this worker no longer holds the job.

    It was reaped, cancelled, ran over budget or was handed to another worker. The
    job is not ours to finish or to fail, so the stage stops and nothing is reported.
    """


#: Heartbeat answers that mean the job is gone, not that the network blinked.
JOB_LOST_STATUSES = frozenset({403, 404, 409, 410})

#: Answers that mean this worker's credential or contract is no good. A retry will
#: not fix them; the supervisor provisions a fresh worker.
FATAL_CLAIM_STATUSES = frozenset({400, 401, 403})

_URL_QUERY = re.compile(r"(https?://[^\s?\"']+)\?[^\s\"']*")


def redact_urls(text: str) -> str:
    """Drops the query string from every URL in `text`.

    A presigned URL's query is its signature. An httpx error message carries the full
    URL, and that message reaches the log and the job's stored error (docs/vision/50).
    """
    return _URL_QUERY.sub(r"\1?<redacted>", text)


class ContractMismatchError(ControlPlaneError):
    """The control plane speaks a different contract version than this image.

    Fatal on purpose: a worker that guesses at a changed job spec corrupts data
    quietly, which is far worse than refusing to start.
    """


@dataclass
class JobSpec:
    job_id: str
    type: str
    resource_class: str
    attempt_number: int
    inputs: dict[str, Any]
    output_prefix: str
    budget_seconds: int
    budget_usd_cents: int

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> JobSpec:
        version = payload.get("contractVersion")
        if version != CONTRACT_VERSION:
            raise ContractMismatchError(
                f"Control plane sent contract {version!r}; this image speaks {CONTRACT_VERSION!r}"
            )
        budget = payload.get("budget") or {}
        return cls(
            job_id=payload["jobId"],
            type=payload["type"],
            resource_class=payload["resourceClass"],
            attempt_number=payload.get("attemptNumber", 1),
            inputs=payload.get("inputs") or {},
            output_prefix=payload["outputPrefix"],
            budget_seconds=int(budget.get("maxRuntimeSeconds", 0)),
            budget_usd_cents=int(budget.get("maxCostUsdCents", 0)),
        )


class ControlPlaneClient:
    def __init__(self, config: WorkerConfig, client: httpx.Client | None = None) -> None:
        self._config = config
        self._client = client or httpx.Client(
            base_url=config.callback_url,
            timeout=httpx.Timeout(30.0, read=120.0),
            verify=config.verify_tls,
        )
        self._worker_token: str | None = None
        self.worker_id: str | None = None
        self.resource_classes: tuple[str, ...] = ()
        #: What the control plane asked for at registration. Its reaper counts missed
        #: heartbeats against its own interval, not the worker's.
        self.server_heartbeat_seconds: float | None = None
        self._sleep: Callable[[float], None] = time.sleep

    # ── lifecycle ────────────────────────────────────────────────────────────

    def register(self) -> None:
        """Exchange the bootstrap token for a worker token.

        The bootstrap token stops working the moment this succeeds, so it cannot
        be replayed from a captured launch spec.
        """
        res = self._client.post(
            "/register", headers={"x-vision-bootstrap-token": self._config.bootstrap_token}
        )
        self._raise_for_status(res, "register")
        body = res.json()

        version = body.get("contractVersion")
        if version != CONTRACT_VERSION:
            raise ContractMismatchError(
                f"Control plane speaks contract {version!r}; this image speaks {CONTRACT_VERSION!r}"
            )

        self._worker_token = body["workerToken"]
        self.worker_id = body["workerId"]
        self.resource_classes = tuple(body.get("resourceClasses") or ())
        interval = body.get("heartbeatIntervalSeconds")
        if isinstance(interval, (int, float)) and interval > 0:
            self.server_heartbeat_seconds = float(interval)
        log.info("registered as worker %s for %s", self.worker_id, ", ".join(self.resource_classes))

    def claim(self) -> JobSpec | None:
        res = self._client.post(
            "/jobs/claim",
            headers=self._auth(),
            json={
                "resourceClasses": list(self._config.resource_classes),
                "contractVersion": CONTRACT_VERSION,
            },
        )
        self._raise_for_status(res, "claim")
        payload = res.json().get("job")
        return JobSpec.from_payload(payload) if payload else None

    # ── during a job ─────────────────────────────────────────────────────────

    def heartbeat(self, job_id: str, stage: str, fraction: float | None = None) -> None:
        res = self._client.post(
            f"/jobs/{job_id}/heartbeat",
            headers=self._auth(),
            json={"progress": {"stage": stage, "fraction": fraction}},
        )
        if res.status_code in JOB_LOST_STATUSES:
            raise JobLostError(f"heartbeat refused: HTTP {res.status_code} {res.text[:300]}", res.status_code)
        self._raise_for_status(res, "heartbeat")

    def input_url(self, job_id: str, role: str, key: str | None = None) -> str:
        """Ask for an input by role. The control plane resolves the key.

        The `declared` role names a key the job listed in `readKeys`; the control
        plane refuses any other. A worker still cannot choose what it reads -- it
        can only ask for what it was told it may.
        """
        body: dict[str, str] = {"role": role}
        if key is not None:
            body["key"] = key
        res = self._client.post(f"/jobs/{job_id}/input-url", headers=self._auth(), json=body)
        self._raise_for_status(res, "input-url")
        return res.json()["url"]

    def presign_output(self, job_id: str, key: str, content_type: str) -> str:
        """Ask for a write URL. Refused unless the key sits under the job's prefix."""
        res = self._client.post(
            f"/jobs/{job_id}/presign",
            headers=self._auth(),
            json={"key": key, "contentType": content_type},
        )
        self._raise_for_status(res, "presign")
        return res.json()["url"]

    def complete(
        self,
        job_id: str,
        idempotency_key: str,
        artifacts: list[dict[str, Any]],
        summary: dict[str, Any],
        cost: dict[str, Any],
        model_version_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        # Retried: the uploads are already done, and a dropped connection here used to
        # re-run the whole job. The idempotency key makes a repeat safe.
        res = self._retrying("complete", lambda: self._client.post(
            f"/jobs/{job_id}/complete",
            headers=self._auth(),
            json={
                "idempotencyKey": idempotency_key,
                "artifacts": artifacts,
                "summary": summary,
                "workerImage": self._config.image,
                # Which model versions actually ran. The control plane refuses a
                # completion whose list disagrees with the job it dispatched, so a
                # stage that ran a model must say so here rather than only in its
                # artifact.
                "modelVersionIds": list(model_version_ids or []),
                "cost": cost,
            },
        ))
        self._raise_for_status(res, "complete")
        return res.json()

    def fail(self, job_id: str, reason: str, detail: str = "", retryable: bool = True) -> None:
        """Report a failure. Never raises.

        Called from `except` blocks: a network blip here used to escape the loop and
        exit the worker (docs/vision/50, C). Retried a few times, then logged.
        """
        try:
            res = self._retrying("fail", lambda: self._client.post(
                f"/jobs/{job_id}/fail",
                headers=self._auth(),
                json={"reason": reason[:200], "detail": redact_urls(detail)[:8000], "retryable": retryable},
            ))
        except Exception as exc:  # noqa: BLE001 - must not mask the original error
            log.error("could not report failure for %s: %s", job_id, redact_urls(str(exc)))
            return
        if res.status_code >= 400:
            log.error("could not report failure for %s: HTTP %s", job_id, res.status_code)

    # ── plumbing ─────────────────────────────────────────────────────────────

    def _retrying(
        self, action: str, send: Callable[[], httpx.Response], attempts: int = 4, base_seconds: float = 1.0
    ) -> httpx.Response:
        """Sends, retrying a network error or a 5xx with backoff. A 4xx is an answer."""
        for attempt in range(1, attempts + 1):
            try:
                res = send()
            except httpx.TransportError as exc:
                if attempt == attempts:
                    raise
                log.warning("%s: network error (%s), retry %s/%s", action, type(exc).__name__, attempt, attempts - 1)
            else:
                if res.status_code < 500 or attempt == attempts:
                    return res
                log.warning("%s: HTTP %s, retry %s/%s", action, res.status_code, attempt, attempts - 1)
            self._sleep(base_seconds * 2 ** (attempt - 1))
        raise AssertionError("unreachable")

    def _auth(self) -> dict[str, str]:
        if not self._worker_token:
            raise ControlPlaneError("Worker is not registered")
        return {"x-vision-worker-token": self._worker_token}

    @staticmethod
    def _raise_for_status(res: httpx.Response, action: str) -> None:
        if res.status_code < 400:
            return
        body = res.text[:500]
        raise ControlPlaneError(f"{action} failed: HTTP {res.status_code} {body}", res.status_code)

    def close(self) -> None:
        self._client.close()
