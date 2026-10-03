"""The compose-stack worker provisions its own bootstrap token, then runs, then retires."""

from __future__ import annotations

import json

import httpx
import pytest

from dtp_vision_worker.bootstrap import BootstrapError, admin_base, main, provision, retire

CALLBACK = "http://api:3000/api/v1/vision/worker"


def test_the_admin_base_is_the_callback_without_the_worker_path() -> None:
    assert admin_base(CALLBACK) == "http://api:3000/api/v1"
    assert admin_base(CALLBACK + "/") == "http://api:3000/api/v1"
    with pytest.raises(BootstrapError, match="must end in"):
        admin_base("http://api:3000/api/v1")


class Api:
    """A fake control plane: scripted answers, and a record of what was asked."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        answer = self.answers.pop(0) if self.answers else ("json", 201, {"workerId": "w-1", "bootstrapToken": "tok-1"})
        if answer[0] == "raise":
            raise httpx.ConnectError("refused")
        return httpx.Response(answer[1], json=answer[2])

    @property
    def transport(self):
        return httpx.MockTransport(self.handler)


def test_provision_asks_with_the_operator_key_and_returns_the_token() -> None:
    api = Api([("json", 201, {"workerId": "w-9", "bootstrapToken": "tok-9", "providerId": "local"})])
    out = provision(CALLBACK, "operator-key", "cpu_small", transport=api.transport, sleep=lambda s: None)
    assert out["workerId"] == "w-9" and out["bootstrapToken"] == "tok-9"
    req = api.requests[0]
    assert str(req.url) == "http://api:3000/api/v1/vision/workers/provision"
    assert req.headers["x-admin-api-key"] == "operator-key"
    assert json.loads(req.content) == {"resourceClass": "cpu_small", "providerId": "local"}


def test_provision_waits_for_an_api_that_is_still_starting() -> None:
    api = Api([("raise",), ("raise",), ("json", 503, {"message": "warming"}), ("json", 201, {"workerId": "w-2", "bootstrapToken": "tok-2"})])
    slept: list[float] = []
    out = provision(CALLBACK, "k", "cpu_small", transport=api.transport, sleep=slept.append, wait_seconds=60)
    assert out["workerId"] == "w-2"
    assert len(api.requests) == 4 and len(slept) == 3


def test_provision_does_not_retry_a_refusal() -> None:
    api = Api([("json", 401, {"message": "bad key"})])
    with pytest.raises(BootstrapError, match="refused \\(401\\)"):
        provision(CALLBACK, "wrong", "cpu_small", transport=api.transport, sleep=lambda s: None)
    assert len(api.requests) == 1
    api = Api([("json", 404, {"message": "Provider nowhere does not offer cpu_small"})])
    with pytest.raises(BootstrapError, match="refused \\(404\\)"):
        provision(CALLBACK, "k", "cpu_small", provider_id="nowhere", transport=api.transport, sleep=lambda s: None)


def test_provision_gives_up_after_the_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = iter([0.0, 0.0, 100.0, 100.0, 100.0])
    monkeypatch.setattr("dtp_vision_worker.bootstrap.time.monotonic", lambda: next(clock))
    api = Api([("raise",), ("raise",)])
    with pytest.raises(BootstrapError, match="did not answer within 50s"):
        provision(CALLBACK, "k", "cpu_small", transport=api.transport, sleep=lambda s: None, wait_seconds=50)


def test_provision_refuses_an_answer_without_a_token() -> None:
    api = Api([("json", 201, {"workerId": "w-3"})])
    with pytest.raises(BootstrapError, match="without a token"):
        provision(CALLBACK, "k", "cpu_small", transport=api.transport, sleep=lambda s: None)


def test_retire_is_best_effort() -> None:
    api = Api([("json", 201, {"ok": True})])
    assert retire(CALLBACK, "k", "w-1", transport=api.transport) is True
    assert str(api.requests[0].url) == "http://api:3000/api/v1/vision/workers/w-1/retire"
    api = Api([("json", 404, {"message": "unknown"})])
    assert retire(CALLBACK, "k", "w-1", transport=api.transport) is False
    api = Api([("raise",)])
    assert retire(CALLBACK, "k", "w-1", transport=api.transport) is False


def test_main_runs_straight_away_when_a_provider_handed_over_a_token() -> None:
    ran = []
    env = {"VISION_BOOTSTRAP_TOKEN": "given"}
    assert main(env, run=lambda: ran.append(1) or 0) == 0
    assert ran == [1]


def test_main_refuses_to_provision_without_what_it_needs() -> None:
    assert main({"VISION_WORKER_CALLBACK_URL": CALLBACK}, run=lambda: 0) == 2


def test_main_provisions_sets_the_token_runs_and_retires(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr("dtp_vision_worker.bootstrap.provision", lambda *a, **k: calls.append("provision") or {"workerId": "w-5", "bootstrapToken": "tok-5"})
    monkeypatch.setattr("dtp_vision_worker.bootstrap.retire", lambda cb, key, wid: calls.append(f"retire:{wid}") or True)
    env = {"VISION_WORKER_CALLBACK_URL": CALLBACK, "VISION_PROVISION_API_KEY": "k", "VISION_RESOURCE_CLASS": "cpu_small"}

    def run() -> int:
        calls.append(f"run:{env['VISION_BOOTSTRAP_TOKEN']}")
        return 0

    assert main(env, run=run) == 0
    assert calls == ["provision", "run:tok-5", "retire:w-5"]


def test_main_retires_even_when_the_worker_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr("dtp_vision_worker.bootstrap.provision", lambda *a, **k: {"workerId": "w-6", "bootstrapToken": "t"})
    monkeypatch.setattr("dtp_vision_worker.bootstrap.retire", lambda cb, key, wid: calls.append(f"retire:{wid}") or True)
    env = {"VISION_WORKER_CALLBACK_URL": CALLBACK, "VISION_PROVISION_API_KEY": "k", "VISION_RESOURCE_CLASS": "cpu_small"}

    def run() -> int:
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        main(env, run=run)
    assert calls == ["retire:w-6"]
