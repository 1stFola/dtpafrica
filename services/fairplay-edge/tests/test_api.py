import pytest
from fastapi.testclient import TestClient

from fairplay_edge.api import create_app
from fairplay_edge.service import EdgeService

from .conftest import SECRET, at, fmp4, write_segment
from .fakes import FakeMediaMtx

TOKEN = SECRET + "-api"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def service(settings, fake_probe):
    svc = EdgeService(settings)
    svc.mediamtx = FakeMediaMtx()
    svc.watchdog.mediamtx = svc.mediamtx
    return svc


@pytest.fixture
def client(service):
    with TestClient(create_app(service, run_loop=False)) as c:
        yield c


def test_liveness_needs_no_token_and_says_nothing(client):
    r = client.get("/edge/v1/healthz")
    assert r.status_code == 200 and r.json() == {"ok": True}


@pytest.mark.parametrize("path", ["/edge/v1/health", "/edge/v1/sources", "/edge/v1/segments", "/edge/v1/alerts",
                                  "/edge/v1/openapi.json", "/edge/v1/sources/ground/spans",
                                  "/edge/v1/media/ground?start=2026-10-27T14:00:00Z&durationMs=1000"])
def test_everything_else_needs_the_token(client, path):
    assert client.get(path).status_code == 401
    assert client.get(path, headers={"Authorization": "Bearer wrong-token"}).status_code == 401


def test_no_public_docs(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_no_cors(client):
    r = client.options("/edge/v1/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}
    r = client.get("/edge/v1/health", headers={**AUTH, "Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}
    assert r.headers["cache-control"] == "no-store"


def test_health_and_sources(client, service):
    service.mediamtx.ready = {"ground": True, "drone": False}
    service.run_once()
    health = client.get("/edge/v1/health", headers=AUTH).json()
    assert health["status"] == "degraded"  # the drone is down: a warning
    assert health["mediaServer"]["up"] is True
    assert {s["name"]: s["publishing"] for s in health["sources"]} == {"ground": True, "drone": False}
    ground = client.get("/edge/v1/sources/ground", headers=AUTH).json()
    assert ground["codecProps"][0]["width"] == 1280 and ground["recording"] is False
    assert client.get("/edge/v1/sources/nope", headers=AUTH).status_code == 404


def test_gaps_from_recorded_spans(client, service):
    service.mediamtx.recorded["drone"] = [
        {"start": "2026-10-27T14:00:00Z", "duration": 60.0},
        {"start": "2026-10-27T14:01:30Z", "duration": 30.0},
    ]
    r = client.get("/edge/v1/sources/drone/gaps", headers=AUTH,
                   params={"start": "2026-10-27T14:00:00Z", "end": "2026-10-27T14:03:00Z"}).json()
    assert r["basis"] == "mediamtx_playback"
    assert r["notRecorded"] == [
        {"fromUtc": "2026-10-27T14:01:00.000Z", "toUtc": "2026-10-27T14:01:30.000Z", "durationMs": 30000},
        {"fromUtc": "2026-10-27T14:02:00.000Z", "toUtc": "2026-10-27T14:03:00.000Z", "durationMs": 60000},
    ]


def test_window_names_its_original_segments(client, service, settings):
    for t in (0, 300):
        write_segment(settings.recordings_dir, "ground", at(t), fmp4(2))
    service.mediamtx.ready = {"ground": True}
    service.run_once()
    service.mediamtx.recorded["ground"] = [{"start": "2026-10-27T14:00:00Z", "duration": 310.0}]
    r = client.get("/edge/v1/sources/ground/window", headers=AUTH,
                   params={"start": "2026-10-27T14:00:02Z", "durationMs": 5000}).json()
    assert r["coverage"] == "full" and r["coveredMs"] == 5000
    first = service.store.one("SELECT id, sha256 FROM segments ORDER BY start_utc LIMIT 1")
    assert [s["id"] for s in r["segments"]] == [first["id"]] and r["segments"][0]["sha256"] == first["sha256"]
    assert r["playbackPath"].startswith("/edge/v1/media/ground?start=2026-10-27T14:00:02.000Z&durationMs=5000")


def test_window_limits(client):
    assert client.get("/edge/v1/sources/ground/window", headers=AUTH,
                      params={"start": "2026-10-27T14:00:00Z", "durationMs": 10 * 60 * 1000 + 1}).status_code == 422
    assert client.get("/edge/v1/sources/ground/window", headers=AUTH,
                      params={"start": "yesterday", "durationMs": 1000}).status_code == 400


def test_spans_fall_back_to_the_manifest_when_mediamtx_is_down(client, service, settings):
    write_segment(settings.recordings_dir, "ground", at(0), fmp4(2))
    write_segment(settings.recordings_dir, "ground", at(300), fmp4(2))
    service.mediamtx.ready = {"ground": True}
    service.run_once()
    service.mediamtx.down = True
    r = client.get("/edge/v1/sources/ground/spans", headers=AUTH).json()
    assert r["basis"] == "manifest" and r["spans"][0]["durationMs"] == 10000


def test_segments_paging_and_manifest(client, service, settings):
    for t in (0, 300, 600):
        write_segment(settings.recordings_dir, "ground", at(t), fmp4(2))
    service.mediamtx.ready = {"ground": True}
    service.run_once()
    page = client.get("/edge/v1/segments", headers=AUTH, params={"limit": 2}).json()
    assert len(page["items"]) == 2 and page["next"]
    rest = client.get("/edge/v1/segments", headers=AUTH, params={"limit": 2, "after": page["next"]}).json()
    assert len(rest["items"]) == 1 and rest["next"] is None
    seg = page["items"][0]["id"]
    assert client.get(f"/edge/v1/segments/{seg}", headers=AUTH).json()["schema"] == "fairplay.segment-manifest/v1"
    assert client.post(f"/edge/v1/segments/{seg}/verify", headers=AUTH).json()["result"] == "match"
    assert client.post(f"/edge/v1/segments/{seg}/repair", headers=AUTH).status_code == 409


def test_holds_and_retention_preview(client):
    body = {"source": "ground", "fromUtc": "2026-10-27T14:00:00Z", "toUtc": "2026-10-27T14:00:30Z",
            "reason": "incident", "ref": "inc-1"}
    hold = client.post("/edge/v1/holds", headers=AUTH, json=body)
    assert hold.status_code == 201
    assert client.post("/edge/v1/holds", headers=AUTH, json={**body, "reason": "whim"}).status_code == 422
    assert len(client.get("/edge/v1/holds", headers=AUTH).json()) == 1
    assert client.post(f"/edge/v1/holds/{hold.json()['id']}/release", headers=AUTH,
                       json={"reason": "closed"}).status_code == 200
    assert client.get("/edge/v1/retention/plan", headers=AUTH).status_code == 400  # off unless days given
    assert client.get("/edge/v1/retention/plan", headers=AUTH, params={"days": 30}).json()["enabled"] is False


# ── Phase 2: operators, the console, the time model ───────────────────────

import json as _json  # noqa: E402

from fairplay_edge.auth import generate_key, key_id  # noqa: E402
from fairplay_edge.config import load_settings  # noqa: E402

from .test_auth import make_bundle  # noqa: E402

CSRF = {"X-FairPlay-Request": "1"}


@pytest.fixture
def op_service(env, tmp_path, fake_probe):
    private, public = generate_key()
    keys = tmp_path / "trusted-keys.json"
    keys.write_text(_json.dumps({key_id(public): {"publicKey": public, "issuer": "dev-local"}}))
    bundle = tmp_path / "bundle.json"
    bundle.write_text(_json.dumps(make_bundle(private)))
    console = tmp_path / "console"
    (console / "assets").mkdir(parents=True)
    (console / "index.html").write_text("<!doctype html><title>FairPlay</title>")
    (console / "assets" / "app.js").write_text("console.log('ok')")
    env.update(FAIRPLAY_TRUSTED_KEYS_FILE=str(keys), FAIRPLAY_BUNDLE_FILE=str(bundle),
               FAIRPLAY_ALLOW_DEV_BUNDLES="1", FAIRPLAY_CONSOLE_DIR=str(console))
    svc = EdgeService(load_settings(env))
    svc.mediamtx = FakeMediaMtx()
    svc.watchdog.mediamtx = svc.mediamtx
    return svc


@pytest.fixture
def op(op_service):
    with TestClient(create_app(op_service, run_loop=False)) as c:
        yield c


def _login(c, email="op@dtp.test", pin="123456"):
    return c.post("/edge/v1/auth/login", json={"email": email, "pin": pin})


def test_status_needs_no_auth_and_names_nobody(op):
    s = op.get("/edge/v1/auth/status").json()
    assert s["bundleLoaded"] and s["dev"] is True and "members" not in s


def test_login_sets_a_strict_httponly_cookie(op):
    r = _login(op)
    assert r.status_code == 200 and r.json()["permissions"] == ["fairplay.incident.operate"]
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/" in cookie
    assert op.get("/edge/v1/auth/me").json()["email"] == "op@dtp.test"


def test_wrong_pin_is_refused(op):
    assert _login(op, pin="000000").status_code == 401


def test_cookie_writes_need_the_csrf_header(op):
    _login(op)
    session = op.post("/edge/v1/sessions", json={"label": "x"})
    assert session.status_code == 403  # the operator lacks session.manage AND sent no header
    hold = {"fromUtc": "2026-10-27T14:00:00Z", "toUtc": "2026-10-27T14:00:30Z", "reason": "incident"}
    assert op.post("/edge/v1/holds", json=hold).status_code == 403
    assert op.post("/edge/v1/holds", json=hold, headers=CSRF).status_code == 201
    assert op.post("/edge/v1/holds", json=hold, headers={**CSRF, "Origin": "https://evil.example"}).status_code == 403


def test_permissions_are_enforced(op):
    _login(op, "view@dtp.test", "654321")
    # Signed in, but with no venue permission: sees nothing (Phase 2 let any member look).
    assert op.get("/edge/v1/health").status_code == 403
    assert op.get("/edge/v1/auth/me").status_code == 200
    hold = {"fromUtc": "2026-10-27T14:00:00Z", "toUtc": "2026-10-27T14:00:30Z", "reason": "incident"}
    assert op.post("/edge/v1/holds", json=hold, headers=CSRF).status_code == 403


def test_logout_ends_the_session(op):
    _login(op)
    assert op.post("/edge/v1/auth/logout", headers=CSRF).status_code == 200
    assert op.get("/edge/v1/auth/me").status_code == 401


def test_media_and_live_need_auth(op):
    assert op.get("/edge/v1/live/ground/index.m3u8").status_code == 401
    _login(op)
    assert op.get("/edge/v1/live/ground/..%2Fsecret").status_code in (400, 404)
    assert op.get("/edge/v1/live/nope/index.m3u8").status_code == 404


def test_console_is_served_with_a_strict_csp(op):
    r = op.get("/")
    assert r.status_code == 200 and "FairPlay" in r.text
    csp = r.headers["content-security-policy"]
    assert "default-src 'self'" in csp and "connect-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert "http:" not in csp and "https:" not in csp and "*" not in csp
    assert r.headers["x-frame-options"] == "DENY"
    assert op.get("/assets/app.js").headers["cache-control"].startswith("public")
    assert op.get("/some/console/route").text == r.text  # client-side routes fall back to the console
    assert op.get("/../../etc/passwd").text == r.text  # never a file outside the console folder
    assert op.get("/edge/v1/nope").status_code in (401, 404)


def test_session_incident_calibration_flow(op, op_service):
    dev = {"Authorization": f"Bearer {TOKEN}"}
    s = op.post("/edge/v1/sessions", json={"label": "UFC R3: Lions v Eagles"}, headers=dev).json()
    assert s["mode"] == "shadow"
    assert op.post("/edge/v1/sessions", json={"label": "x", "mode": "var"}, headers=dev).status_code == 422
    _login(op)
    mark = op.post(f"/edge/v1/sessions/{s['id']}/periods", json={"period": "1", "edge": "start"}, headers=CSRF)
    assert mark.status_code == 201
    cal = op.post(f"/edge/v1/sessions/{s['id']}/calibrations", headers=CSRF, json={
        "source": "drone", "referenceUtc": "2026-10-27T14:01:00.000Z", "observedIngestUtc": "2026-10-27T14:01:00.400Z",
        "uncertaintyMs": 80, "method": "marker"})
    assert cal.status_code == 201 and cal.json()["offset_ms"] == 400
    inc = op.post("/edge/v1/incidents", headers=CSRF, json={"sessionId": s["id"], "category": "penalty"}).json()
    assert inc["state"] == "flagged" and inc["basis"] == "operator_now"
    op_service.mediamtx.recorded["ground"] = [{"start": "2000-01-01T00:00:00Z", "duration": 10**10}]
    windows = op.get(f"/edge/v1/incidents/{inc['id']}/windows").json()
    by = {w["source"]: w for w in windows["perSource"]}
    assert by["ground"]["state"] == "uncalibrated" and by["drone"]["state"] == "no_footage"
    assert by["drone"]["offsetMs"] == 400 and by["drone"]["uncertaintyMs"] == 80
    stale = op.patch(f"/edge/v1/incidents/{inc['id']}", headers={**CSRF, "If-Match": "7"}, json={"postRollMs": 5000})
    assert stale.status_code == 409
    fresh = op.patch(f"/edge/v1/incidents/{inc['id']}", headers={**CSRF, "If-Match": "1"}, json={"postRollMs": 5000})
    assert fresh.status_code == 200 and fresh.json()["version"] == 2
    sync = op.get(f"/edge/v1/sessions/{s['id']}/sync-test", params={"at": inc["event_utc"]}).json()
    assert sync["aligned"] is False


def test_replay_metrics_round_trip(op):
    _login(op)
    for ms in (800, 1200, 950):
        assert op.post("/edge/v1/metrics/replay", headers=CSRF, json={
            "source": "ground", "windowStartUtc": "2026-10-27T14:00:00Z", "durationMs": 30000,
            "toPlayableMs": ms, "outcome": "playable"}).status_code == 201
    s = op.get("/edge/v1/metrics/replay").json()
    assert s["playable"] == 3 and s["p50Ms"] == 950 and s["p95Ms"] == 1200


def test_media_windows_are_seekable_and_cached(op, op_service):
    """A browser seeks only what answers byte ranges; MediaMTX's /get does not, so the Edge does."""
    calls = []

    async def fake_fetch(url, params, target):
        calls.append(params)
        target.write_bytes(bytes(range(256)) * 40)  # 10240 bytes standing in for an MP4
        return 200

    op.app.state.fetch_window = fake_fetch
    _login(op)
    path = "/edge/v1/media/ground?start=2026-10-27T14:00:00Z&durationMs=10000"
    whole = op.get(path)
    assert whole.status_code == 200 and whole.headers["content-type"] == "video/mp4"
    assert whole.headers["accept-ranges"] == "bytes" and whole.headers["content-length"] == "10240"
    part = op.get(path, headers={"Range": "bytes=100-199"})
    assert part.status_code == 206 and part.headers["content-range"] == "bytes 100-199/10240"
    assert part.content == whole.content[100:200]
    assert len(calls) == 1  # the second request was served from the cache


def test_missing_recording_is_a_404(op):
    async def none(url, params, target):
        return 404

    op.app.state.fetch_window = none
    _login(op)
    r = op.get("/edge/v1/media/ground?start=2026-10-27T14:00:00Z&durationMs=10000")
    assert r.status_code == 404 and r.json()["error"] == "no_recording"
