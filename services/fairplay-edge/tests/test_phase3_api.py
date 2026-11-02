"""Phase 3 through the API: who may do what, double submission, the rights gate, and what an
organiser can and cannot see."""

import hashlib
import io
import json
import uuid
import zipfile

import pytest
from fastapi.testclient import TestClient

from fairplay_edge import audit, evidence
from fairplay_edge.api import create_app
from fairplay_edge.auth import generate_key, hash_pin, key_id
from fairplay_edge.config import load_settings
from fairplay_edge.service import EdgeService

from .conftest import at, fmp4, write_segment
from .fakes import FakeMediaMtx
from .schema_check import errors
from .test_auth import make_bundle
from .test_evidence import FakeCutter

CSRF = {"X-FairPlay-Request": "1"}
ALL = ["fairplay.incident.operate", "fairplay.incident.review", "fairplay.session.manage", "fairplay.edge.admin",
       "fairplay.evidence.view_original", "fairplay.evidence.export"]
PEOPLE = {
    "operator": ["fairplay.incident.operate", "fairplay.evidence.view_original"],
    "assessor": ["fairplay.incident.operate", "fairplay.incident.review"],
    "admin": ALL,
    "organiser": ["fairplay.report.view"],
    "exporter": ["fairplay.evidence.export"],
}


@pytest.fixture
def service(env, tmp_path, fake_probe):
    private, public = generate_key()
    keys = tmp_path / "trusted-keys.json"
    keys.write_text(json.dumps({key_id(public): {"publicKey": public, "issuer": "dev-local"}}))
    members = [{"userId": f"u-{name}", "email": f"{name}@dtp.test", "name": name.title(), "permissions": perms,
                "pinHash": hash_pin("24681012")} for name, perms in PEOPLE.items()]
    bundle = tmp_path / "bundle.json"
    bundle.write_text(json.dumps(make_bundle(private, members=members)))
    env.update(FAIRPLAY_TRUSTED_KEYS_FILE=str(keys), FAIRPLAY_BUNDLE_FILE=str(bundle), FAIRPLAY_ALLOW_DEV_BUNDLES="1")
    svc = EdgeService(load_settings(env))
    svc.mediamtx = FakeMediaMtx()
    svc.watchdog.mediamtx = svc.mediamtx
    svc.cutter = FakeCutter()
    for t in range(0, 60, 10):
        write_segment(svc.settings.recordings_dir, "ground", at(t), fmp4(3))
    svc.run_once()
    svc.mediamtx.recorded["ground"] = [{"start": "2026-10-27T14:00:00Z", "duration": 60.0}]
    return svc


@pytest.fixture
def clients(service):
    """One signed-in browser per person."""
    app = create_app(service, run_loop=False)
    out = {}
    for name in PEOPLE:
        c = TestClient(app)
        c.__enter__()
        assert c.post("/edge/v1/auth/login", json={"email": f"{name}@dtp.test", "pin": "24681012"}).status_code == 200
        out[name] = c
    yield out
    for c in out.values():
        c.__exit__(None, None, None)


@pytest.fixture
def session_id(clients):
    s = clients["admin"].post("/edge/v1/sessions", headers=CSRF, json={"label": "Lions v Eagles", "matchRef": "m-1"})
    return s.json()["id"]


def flag(c, session_id, **extra):
    return c.post("/edge/v1/incidents", headers={**CSRF, **extra.pop("headers", {})},
                  json={"sessionId": session_id, "eventUtc": "2026-10-27T14:00:40.000Z", "basis": "manual",
                        "category": "foul", **extra})


def to_reviewed(clients, service, session_id, release_rights=True):
    inc = flag(clients["operator"], session_id).json()
    job = clients["operator"].post(f"/edge/v1/incidents/{inc['id']}/clips", headers=CSRF, json={"source": "ground"})
    assert job.status_code == 202
    assert service.run_jobs_once()
    ev = clients["assessor"].get(f"/edge/v1/evidence?incidentId={inc['id']}").json()[0]
    r = clients["assessor"].post(f"/edge/v1/incidents/{inc['id']}/review/start", headers={**CSRF, "If-Match": "1"})
    assert r.status_code == 200, r.text
    r = clients["assessor"].post(f"/edge/v1/incidents/{inc['id']}/review/complete",
                                 headers={**CSRF, "If-Match": "2"},
                                 json={"result": "supports_original", "factualNotes": "Clean tackle; ball first.",
                                       "onFieldDecision": "play on", "evidenceIds": [ev["id"]]})
    assert r.status_code == 200, r.text
    if release_rights:
        clients["admin"].post(f"/edge/v1/sessions/{session_id}/rights", headers=CSRF, json={
            "footageKind": "synthetic", "status": "not_recorded", "minorsPresent": "no"})
    return r.json(), ev


def test_who_may_do_what(clients, session_id):
    assert flag(clients["organiser"], session_id).status_code == 403
    inc = flag(clients["operator"], session_id)
    assert inc.status_code == 201
    iid = inc.json()["id"]
    start = f"/edge/v1/incidents/{iid}/review/start"
    assert clients["operator"].post(start, headers={**CSRF, "If-Match": "1"}).status_code == 403
    assert clients["assessor"].post(start, headers={**CSRF, "If-Match": "1"}).status_code == 200
    rights = {"footageKind": "real", "status": "internal_review_only", "minorsPresent": "yes"}
    assert clients["assessor"].post(f"/edge/v1/sessions/{session_id}/rights", headers=CSRF, json=rights).status_code == 403
    assert clients["admin"].post(f"/edge/v1/sessions/{session_id}/rights", headers=CSRF, json=rights).status_code == 201
    assert clients["assessor"].get("/edge/v1/audit").status_code == 403
    assert clients["admin"].get("/edge/v1/audit/verify").json()["ok"] is True


@pytest.mark.parametrize("path", ["/edge/v1/health", "/edge/v1/sources", "/edge/v1/segments",
                                  "/edge/v1/media/ground?start=2026-10-27T14:00:00Z&durationMs=1000",
                                  "/edge/v1/live/ground/index.m3u8", "/edge/v1/outbox"])
def test_an_organiser_sees_none_of_the_venue(clients, path):
    assert clients["organiser"].get(path).status_code == 403


def test_double_submission_makes_one_incident(clients, session_id):
    key = {"Idempotency-Key": uuid.uuid4().hex}
    first = flag(clients["operator"], session_id, headers=key)
    second = flag(clients["operator"], session_id, headers=key)
    assert first.status_code == second.status_code == 201
    assert second.json()["id"] == first.json()["id"] and second.headers["idempotent-replayed"] == "true"
    assert len(clients["operator"].get(f"/edge/v1/incidents?sessionId={session_id}").json()) == 1
    other = flag(clients["operator"], session_id, headers=key, note="a different body")
    assert other.status_code == 409


def test_clip_requests_collapse_to_one_job(clients, session_id):
    iid = flag(clients["operator"], session_id).json()["id"]
    path = f"/edge/v1/incidents/{iid}/clips"
    first = clients["operator"].post(path, headers=CSRF, json={"source": "ground"})
    second = clients["operator"].post(path, headers=CSRF, json={"source": "ground"})
    assert (first.status_code, second.status_code) == (202, 200) and first.json()["id"] == second.json()["id"]


def test_transition_collision_is_a_409(clients, session_id):
    iid = flag(clients["operator"], session_id).json()["id"]
    a = clients["assessor"].post(f"/edge/v1/incidents/{iid}/review/start", headers={**CSRF, "If-Match": "1"})
    b = clients["admin"].post(f"/edge/v1/incidents/{iid}/review/start", headers={**CSRF, "If-Match": "1"})
    assert a.status_code == 200 and b.status_code == 409 and "reload" in b.json()["remediation"]


def test_rights_gate_blocks_release_of_real_footage(clients, service, session_id):
    reviewed, ev = to_reviewed(clients, service, session_id, release_rights=False)
    approve = f"/edge/v1/evidence/{ev['id']}/approve"
    refused = clients["admin"].post(approve, headers=CSRF)
    assert refused.status_code == 409 and "rights" in refused.json()["message"]
    assert clients["assessor"].post(approve, headers=CSRF).status_code == 403  # not an exporter
    clients["admin"].post(f"/edge/v1/sessions/{session_id}/rights", headers=CSRF, json={
        "footageKind": "real", "status": "external_release_permitted", "minorsPresent": "yes",
        "basis": "UFC 2026 media terms"})
    assert "minors" in clients["admin"].post(approve, headers=CSRF).json()["message"]
    clients["admin"].post(f"/edge/v1/sessions/{session_id}/rights", headers=CSRF, json={
        "footageKind": "real", "status": "external_release_permitted", "minorsPresent": "yes",
        "basis": "UFC 2026 media terms", "consentReference": "CF-2026-118"})
    assert clients["admin"].post(approve, headers=CSRF).json()["state"] == "approved"


def test_an_unreleased_clip_takes_view_original_and_a_released_one_does_not(clients, service, session_id):
    _, ev = to_reviewed(clients, service, session_id)
    path = f"/edge/v1/evidence/{ev['id']}/file"
    assert clients["operator"].get(path).status_code == 200
    assert clients["assessor"].get(path).status_code == 403
    assert clients["admin"].post(f"/edge/v1/evidence/{ev['id']}/approve", headers=CSRF).status_code == 200
    assert clients["assessor"].get(path).status_code == 200


def test_nobody_approves_a_clip_they_could_not_watch(clients, service, session_id):
    _, ev = to_reviewed(clients, service, session_id)
    with_export_alone = clients["exporter"]
    assert with_export_alone.post(f"/edge/v1/evidence/{ev['id']}/approve", headers=CSRF).status_code == 403
    assert clients["admin"].post(f"/edge/v1/evidence/{ev['id']}/approve", headers=CSRF).status_code == 200
    assert with_export_alone.post(f"/edge/v1/evidence/{ev['id']}/export", headers=CSRF).status_code == 200


def test_organiser_sees_only_released_evidence(clients, service, session_id):
    reviewed, ev = to_reviewed(clients, service, session_id)
    org = clients["organiser"]
    assert org.get(f"/edge/v1/evidence/{ev['id']}/file").status_code == 404  # not yet approved: not even "exists"
    assert org.get(f"/edge/v1/report/sessions/{session_id}").json()["incidents"][0]["evidence"] == []
    assert clients["admin"].post(f"/edge/v1/evidence/{ev['id']}/approve", headers=CSRF).status_code == 200
    got = org.get(f"/edge/v1/evidence/{ev['id']}/file")
    assert got.status_code == 200 and got.headers["content-type"] == "video/mp4"
    assert org.get(f"/edge/v1/evidence/{ev['id']}/file", headers={"Range": "bytes=0-9"}).status_code == 206
    assert [s["id"] for s in org.get("/edge/v1/report/sessions").json()] == [session_id]
    report = org.get(f"/edge/v1/report/sessions/{session_id}").json()
    assert report["authorityMode"] == "shadow" and report["incidents"][0]["evidence"][0]["id"] == ev["id"]
    assert report["incidents"][0]["finding"]["result"] == "supports_original"
    # Reopened: the finding no longer stands, so its evidence is withheld again.
    clients["assessor"].post(f"/edge/v1/incidents/{reviewed['id']}/reopen", headers={**CSRF, "If-Match": "3"},
                             json={"reason": "new angle received"})
    assert org.get(f"/edge/v1/evidence/{ev['id']}/file").status_code == 404
    accessed = [e for e in clients["admin"].get("/edge/v1/audit").json() if e["action"] == "evidence.accessed"]
    assert [e["detail"]["as"] for e in accessed] == ["organiser"]


def test_export_is_audited_and_hashed(clients, service, session_id):
    reviewed, ev = to_reviewed(clients, service, session_id)
    path = f"/edge/v1/evidence/{ev['id']}/export"
    assert clients["admin"].post(path, headers=CSRF).status_code == 409  # approve first
    clients["admin"].post(f"/edge/v1/evidence/{ev['id']}/approve", headers=CSRF)
    first = clients["admin"].post(path, headers=CSRF)
    second = clients["admin"].post(path, headers=CSRF)
    assert first.status_code == 200 and first.headers["content-type"] == "application/zip"
    assert first.headers["x-package-sha256"] == second.headers["x-package-sha256"]  # same evidence, same package
    exports = [e for e in clients["admin"].get("/edge/v1/audit").json() if e["action"] == "evidence.exported"]
    assert len(exports) == 2 and exports[0]["detail"]["packageSha256"] == first.headers["x-package-sha256"]


def test_every_manifest_download_is_audited(clients, service, session_id):
    _, ev = to_reviewed(clients, service, session_id)
    clients["admin"].post(f"/edge/v1/evidence/{ev['id']}/approve", headers=CSRF)
    for _ in range(2):
        assert clients["organiser"].get(f"/edge/v1/evidence/{ev['id']}/manifest").status_code == 200
    seen = [e for e in clients["admin"].get("/edge/v1/audit").json() if e["action"] == "evidence.manifest_accessed"]
    assert len(seen) == 2 and seen[0]["actor_id"] == "u-organiser" and seen[0]["detail"]["as"] == "organiser"


def test_replay_access_is_audited_once_per_window(clients):
    async def fake_fetch(url, params, target):
        target.write_bytes(b"\x00" * 1000)
        return 200

    clients["operator"].app.state.fetch_window = fake_fetch
    path = "/edge/v1/media/ground?start=2026-10-27T14:00:00Z&durationMs=10000"
    for _ in range(3):
        assert clients["operator"].get(path).status_code == 200
    seen = [e for e in clients["admin"].get("/edge/v1/audit").json() if e["action"] == "media.accessed"]
    assert len(seen) == 1 and seen[0]["actor_id"] == "u-operator"


def test_health_reports_the_outbox_and_audit_head(clients, session_id):
    flag(clients["operator"], session_id)
    health = clients["admin"].get("/edge/v1/health").json()
    assert health["cloud"]["configured"] is False and health["cloud"]["pending"] > 0
    assert health["audit"]["seq"] >= 1


def test_no_footage_finding_through_the_api(clients, session_id):
    inc = clients["operator"].post("/edge/v1/incidents", headers=CSRF, json={
        "sessionId": session_id, "eventUtc": "2026-10-27T15:00:00.000Z", "basis": "manual"}).json()
    clients["assessor"].post(f"/edge/v1/incidents/{inc['id']}/review/start", headers={**CSRF, "If-Match": "1"})
    body = {"result": "supports_alternative", "factualNotes": "Seen from the stand."}
    refused = clients["assessor"].post(f"/edge/v1/incidents/{inc['id']}/review/complete",
                                       headers={**CSRF, "If-Match": "2"}, json=body)
    assert refused.status_code == 400 and "footage_unavailable" in refused.json()["message"]
    ok = clients["assessor"].post(f"/edge/v1/incidents/{inc['id']}/review/complete", headers={**CSRF, "If-Match": "2"},
                                  json={**body, "result": "footage_unavailable"})
    assert ok.status_code == 200


def test_only_an_admin_confirms_a_cameras_new_address_and_it_is_audited(clients, service):
    service.mediamtx.ready = {"ground": True}
    service.mediamtx.publisher["ground"] = ("s1", "10.0.0.21")
    service.run_once()
    service.mediamtx.publisher["ground"] = ("s2", "10.0.0.99")
    service.run_once()
    alert = next(a for a in clients["admin"].get("/edge/v1/alerts").json() if a["kind"] == "publisher_address_changed")
    path = f"/edge/v1/alerts/{alert['id']}/acknowledge"
    assert clients["operator"].post(path, headers=CSRF, json={"reason": "new encoder"}).status_code == 403
    r = clients["admin"].post(path, headers=CSRF, json={"reason": "swapped the ground encoder at half-time"})
    assert r.status_code == 200 and r.json()["resolved_utc"]
    entry = service.store.one("SELECT * FROM audit_log WHERE action = 'alert.acknowledged'")
    assert entry["actor_id"] == "u-admin" and "10.0.0.99" in entry["detail"]
    service.mediamtx.publisher["ground"] = ("s3", "10.0.0.99")
    service.run_once()
    assert not [a for a in clients["admin"].get("/edge/v1/alerts").json() if a["kind"] == "publisher_address_changed"]
    assert clients["admin"].post(path, headers=CSRF, json={"reason": "again"}).status_code == 404
    service.mediamtx.down = True
    service.run_once()
    down = next(a for a in clients["admin"].get("/edge/v1/alerts").json() if a["kind"] == "media_server_down")
    assert clients["admin"].post(f"/edge/v1/alerts/{down['id']}/acknowledge", headers=CSRF,
                                 json={"reason": "known"}).status_code == 409


# ── what an exported package says (FP-08, PID 5.3) ───────────────────────

def released_clip(clients, service, session_id):
    done, ev = to_reviewed(clients, service, session_id)
    assert clients["admin"].post(f"/edge/v1/evidence/{ev['id']}/approve", headers=CSRF).status_code == 200
    return done, ev


def exported(clients, ev):
    r = clients["admin"].post(f"/edge/v1/evidence/{ev['id']}/export", headers=CSRF)
    assert r.status_code == 200, r.text
    return r.content, zipfile.ZipFile(io.BytesIO(r.content))


def test_an_export_names_the_finding_the_reviewer_and_who_approved_it(clients, service, session_id):
    done, ev = released_clip(clients, service, session_id)
    _, package = exported(clients, ev)
    assert sorted(package.namelist()) == ["SHA256SUMS", "clip.mp4", "finding.json", "manifest.json"]
    finding = json.loads(package.read("finding.json"))
    assert finding["authorityMode"] == "shadow" and "Shadow review only" in finding["notice"]
    assert finding["evidenceId"] == ev["id"] and finding["clipSha256"] == ev["sha256"] and finding["manifestSha256"] == ev["manifest_sha256"]
    assert finding["incident"] == {"id": done["id"], "version": done["version"], "matchId": "m-1", "category": "foul",
                                   "period": None, "matchMinute": None, "matchSecond": None, "eventUtc": done["event_utc"]}
    current = finding["finding"]
    assert current["result"] == "supports_original" and current["factualNotes"] == "Clean tackle; ball first."
    assert current["onFieldDecision"] == "play on" and current["reviewer"] == {"id": "u-assessor", "name": "Assessor"}
    assert current["completedUtc"] and current["reliedOnThisClip"] is True
    assert finding["approval"]["by"] == {"id": "u-admin", "name": "Admin"} and finding["approval"]["approvedUtc"]
    assert finding["earlierFindings"] == []
    actions = [e["action"] for e in finding["custody"]]
    assert {"incident.created", "evidence.created", "review.completed", "evidence.approved"} <= set(actions)
    assert all(len(e["entryHash"]) == 64 and e["actorName"] for e in finding["custody"])


def test_the_finding_is_in_the_sums_and_its_schema(clients, service, session_id):
    _, ev = released_clip(clients, service, session_id)
    _, package = exported(clients, ev)
    lines = dict(reversed(line.split("  ")) for line in package.read("SHA256SUMS").decode().splitlines())
    for name in ("clip.mp4", "manifest.json", "finding.json"):
        assert lines[name] == hashlib.sha256(package.read(name)).hexdigest(), name
    schema = json.loads((evidence.SCHEMA_FILE.parent / "evidence-finding.v1.schema.json").read_text(encoding="utf-8"))
    assert errors(json.loads(package.read("finding.json")), schema) == []


def test_the_export_is_in_the_audit_chain_with_the_findings_hash(clients, service, session_id):
    _, ev = released_clip(clients, service, session_id)
    _, package = exported(clients, ev)
    entry = next(e for e in clients["admin"].get("/edge/v1/audit?limit=1000").json() if e["action"] == "evidence.exported")
    assert entry["detail"]["findingSha256"] == hashlib.sha256(package.read("finding.json")).hexdigest()


def test_exporting_the_same_finding_twice_gives_the_same_bytes(clients, service, session_id):
    _, ev = released_clip(clients, service, session_id)
    first, _ = exported(clients, ev)
    # Reading the clip adds to the audit chain, and is not part of how the finding came to be.
    assert clients["organiser"].get(f"/edge/v1/evidence/{ev['id']}/file").status_code == 200
    second, _ = exported(clients, ev)
    assert first == second


def test_another_clip_of_the_incident_does_not_change_this_ones_package(clients, service, session_id, monkeypatch):
    _, ev = released_clip(clients, service, session_id)
    first, package = exported(clients, ev)
    assert json.loads(package.read("finding.json"))["approval"]["afterCurrentFinding"] is True
    real = audit.for_incident
    sibling = [dict(real(service.store, service.store.one("SELECT incident_id FROM evidence WHERE id = ?", (ev["id"],))["incident_id"])[0], entity_type=kind, entity_id="another", action="evidence.approved", seq=10**6)
               for kind in ("evidence", "job")]
    monkeypatch.setattr(audit, "for_incident", lambda store, incident_id: real(store, incident_id) + sibling)
    second, _ = exported(clients, ev)
    assert first == second


def test_a_later_finding_replaces_the_earlier_and_says_there_was_one(clients, service, session_id):
    done, ev = released_clip(clients, service, session_id)
    assessor = clients["assessor"]
    r = assessor.post(f"/edge/v1/incidents/{done['id']}/reopen", headers={**CSRF, "If-Match": str(done["version"])},
                      json={"reason": "a second look at the angle"})
    assert r.status_code == 200, r.text
    r = assessor.post(f"/edge/v1/incidents/{done['id']}/review/complete", headers={**CSRF, "If-Match": str(r.json()["version"])},
                      json={"result": "inconclusive", "factualNotes": "The angle does not show the contact."})
    assert r.status_code == 200, r.text
    _, package = exported(clients, ev)
    finding = json.loads(package.read("finding.json"))
    assert finding["finding"]["result"] == "inconclusive" and finding["finding"]["reliedOnThisClip"] is False
    earlier = finding["earlierFindings"]
    assert len(earlier) == 1 and earlier[0]["result"] == "supports_original"
    assert earlier[0]["reviewer"]["name"] == "Assessor"
    # Why it was reopened, and what the earlier finding said, are free text and stay at the venue.
    assert "factualNotes" not in earlier[0] and "a second look" not in package.read("finding.json").decode()
    assert finding["approval"]["afterCurrentFinding"] is False
