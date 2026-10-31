"""Phase 5.5, part 3: the findings proposed for fixing before the pilot (docs/fairplay/residual-risks.md
R2, R3, R6):

  F9   cloud URLs are parsed as httpx sends them: no user part, https only beyond this machine,
       and evidence uploads only to the allowlisted storage hosts;
  F19  the unauthenticated sign-in status says only what sign-in needs, and an Edge serving
       beyond this machine answers only to its own names;
  F7   wrong PINs from one device cannot lock an operator out of another; PIN checks are
       bounded; oversized bodies are refused.
"""

import threading
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from fairplay_edge import auth, cloud
from fairplay_edge.api import create_app, problem_outline
from fairplay_edge.auth import AuthError, Sessions, SignInBusy
from fairplay_edge.config import url_allowed
from fairplay_edge.tlsgen import init as tls_init

from .test_auth import bundle, keys  # noqa: F401  (fixtures)
from .test_phase3_api import CSRF, clients, service  # noqa: F401  (fixtures)


# ── F9 ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url, ok", [
    ("https://api.dtp.africa", True),
    ("http://127.0.0.1:3190", True),
    ("http://localhost:3190/x", True),
    ("http://[::1]:3190", True),
    ("http://127.0.0.1:1@evil.example/", False),  # the bypass: plain http to evil.example
    ("https://user:pw@api.dtp.africa/", False),
    ("http://evil.example", False),
    ("ftp://127.0.0.1/", False),
    ("https://", False),
    ("not a url", False),
])
def test_cloud_urls_are_parsed_as_they_are_sent(url, ok):
    assert url_allowed(url) is ok


def test_uploads_go_only_to_the_allowlisted_storage_hosts():
    hosts = ("*.r2.cloudflarestorage.com",)
    assert url_allowed("https://bucket.acct.r2.cloudflarestorage.com/k?X-Amz-Signature=x", hosts)
    assert not url_allowed("https://evil.example/k", hosts)
    assert not url_allowed("https://acct.r2.cloudflarestorage.com.evil.example/k", hosts)
    assert not url_allowed("https://r2.cloudflarestorage.com.evil.example/k", hosts)
    assert url_allowed("http://127.0.0.1:9190/bucket/k", hosts)  # the test S3 server on this machine
    client = cloud.CloudClient("https://api.dtp.africa", "t", upload_hosts=hosts)
    with pytest.raises(cloud.CloudError, match="allowed storage host"):
        client.put({"method": "PUT", "url": "https://evil.example/k", "headers": {}}, __file__)  # type: ignore[arg-type]


def test_the_service_uses_the_configured_storage_hosts(env):
    from fairplay_edge.config import load_settings

    env.update(FAIRPLAY_CLOUD_SYNC_URL="https://api.dtp.africa", FAIRPLAY_CLOUD_DEVICE_TOKEN="d" * 48,
               FAIRPLAY_UPLOAD_HOSTS="*.r2.cloudflarestorage.com, files.dtp.africa")
    assert load_settings(env).upload_hosts == ("*.r2.cloudflarestorage.com", "files.dtp.africa")


# ── F19 ───────────────────────────────────────────────────────────────────

def test_the_sign_in_status_says_only_what_sign_in_needs(clients, service):  # noqa: F811
    with TestClient(create_app(service, run_loop=False)) as anon:
        status = anon.get("/edge/v1/auth/status").json()
    assert set(status) == {"bundleLoaded", "dev", "expiresUtc", "problem", "device", "secure"}
    assert problem_outline(None) is None
    assert problem_outline("no operator bundle installed") == "no operator list is installed"
    assert problem_outline("bundle expired at 2026-10-29T12:58:11Z") == "the operator list has expired"
    assert problem_outline("signed by untrusted key 3f9a… from /var/lib/fairplay/keys.json") == "the operator list is not valid"
    # Staff still see the detail.
    service.bundle_error = "signed by untrusted key 3f9a"
    assert clients["admin"].get("/edge/v1/health").json()["bundle"]["problem"] == "signed by untrusted key 3f9a"


def test_an_edge_beyond_this_machine_answers_only_to_its_own_names(service, tmp_path):  # noqa: F811
    paths = tls_init(tmp_path / "tls", ["192.168.1.20", "edge.venue.lan"], "test")
    service.settings = replace(service.settings, tls_cert=paths["cert"], tls_key=paths["key"])
    app = create_app(service, run_loop=False)
    for host, ok in (("edge.venue.lan", True), ("192.168.1.20", True), ("localhost", True),
                     ("evil.example", False), ("edge.venue.lan.evil.example", False)):
        with TestClient(app, base_url=f"https://{host}") as c:
            r = c.get("/edge/v1/healthz")
        assert (r.status_code == 200) is ok, (host, r.status_code)
    service.settings = replace(service.settings, allowed_hosts=("fairplay.local",))
    with TestClient(create_app(service, run_loop=False), base_url="https://fairplay.local") as c:
        assert c.get("/edge/v1/healthz").status_code == 200


# ── F7 ────────────────────────────────────────────────────────────────────

def test_wrong_pins_from_another_device_do_not_lock_an_operator_out(store, bundle):  # noqa: F811
    sessions = Sessions(store)
    for _ in range(10):
        with pytest.raises(AuthError):
            sessions.login(bundle, "op@dtp.test", "00000000", "10.0.0.66")  # someone else's laptop
    with pytest.raises(AuthError, match="too many"):
        sessions.login(bundle, "op@dtp.test", "12345678", "10.0.0.66")
    token, who = sessions.login(bundle, "op@dtp.test", "12345678", "10.0.0.5")  # the operator's own
    assert who.email == "op@dtp.test"


def test_a_guess_spread_over_many_devices_still_meets_a_ceiling(store, bundle):  # noqa: F811
    sessions = Sessions(store)
    for i in range(auth.EMAIL_FAILURES):
        with pytest.raises(AuthError):
            sessions.login(bundle, "op@dtp.test", "00000000", f"10.0.1.{i}")
    with pytest.raises(AuthError, match="too many"):
        sessions.login(bundle, "op@dtp.test", "12345678", "10.0.0.5")


def test_pin_checks_are_bounded_and_a_busy_refusal_counts_against_no_one(store, bundle, monkeypatch):  # noqa: F811
    monkeypatch.setattr(auth, "PIN_CHECKS", threading.BoundedSemaphore(1))
    monkeypatch.setattr(auth, "PIN_CHECK_WAIT_S", 0.05)
    auth.PIN_CHECKS.acquire()  # another sign-in is being checked
    try:
        with pytest.raises(SignInBusy):
            Sessions(store).login(bundle, "op@dtp.test", "12345678", "10.0.0.5")
    finally:
        auth.PIN_CHECKS.release()
    assert store.query("SELECT * FROM login_attempts") == []
    assert Sessions(store).login(bundle, "op@dtp.test", "12345678", "10.0.0.5")[1].email == "op@dtp.test"


def test_a_busy_sign_in_is_a_429(clients, service, monkeypatch):  # noqa: F811
    monkeypatch.setattr(auth, "PIN_CHECK_WAIT_S", 0.05)
    held = [auth.PIN_CHECKS.acquire() for _ in range(2)]
    try:
        with TestClient(create_app(service, run_loop=False)) as c:
            r = c.post("/edge/v1/auth/login", json={"email": "admin@dtp.test", "pin": "24681012"})
        assert r.status_code == 429 and r.json()["error"] == "busy"
    finally:
        for _ in held:
            auth.PIN_CHECKS.release()


def test_oversized_bodies_are_refused_declared_or_streamed(clients):  # noqa: F811
    admin = clients["admin"]
    big = {"label": "x" * (300 * 1024)}
    r = admin.post("/edge/v1/sessions", headers=CSRF, json=big)
    assert r.status_code == 413 and r.json()["error"] == "too_large"

    def stream():
        for _ in range(40):
            yield b"x" * 8192

    r = admin.post("/edge/v1/sessions", headers={**CSRF, "Content-Type": "application/json"}, content=stream())
    assert r.status_code == 413
    assert admin.post("/edge/v1/sessions", headers=CSRF, json={"label": "a normal one"}).status_code == 201
