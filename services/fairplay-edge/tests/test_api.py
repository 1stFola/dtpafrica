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
