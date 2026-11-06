"""Phase 5.7, a clip withdrawn at a player's or a parent's request (decisions.md D11):
the file and any export package go, the hash, the reason and the requester stay, and the
clip is never released, exported or cut again. Withdrawals made in the cloud are applied
here under the cloud's id; withdrawals made here sync to the cloud."""

import json
import sqlite3

import pytest

from fairplay_edge import audit, cloud, evidence, outbox
from fairplay_edge.audit import Actor

from .test_phase3_api import CSRF, clients, service, session_id, to_reviewed  # noqa: F401  (fixtures)

ADMIN = Actor("u-admin", "Admin", "operator")


@pytest.fixture
def released(clients, service, session_id):  # noqa: F811
    """A clip approved for release and exported once: the package is on disk too."""
    _, ev = to_reviewed(clients, service, session_id)
    assert clients["admin"].post(f"/edge/v1/evidence/{ev['id']}/approve", headers=CSRF).status_code == 200
    assert clients["admin"].post(f"/edge/v1/evidence/{ev['id']}/export", headers=CSRF).status_code == 200
    return evidence.get(service.store, ev["id"])


def withdraw(c, evidence_id, **body):
    return c.post(f"/edge/v1/evidence/{evidence_id}/withdraw", headers=CSRF,
                  json={"reason": "parent's request, by email", "requester": "J. Doe (parent or guardian)", **body})


def test_a_withdrawn_clip_is_removed_and_its_record_kept(clients, service, released):
    s, settings = service.store, service.settings
    clip = evidence.path_of(settings, released)
    package = settings.data_dir / "exports" / f"fairplay-evidence-{released['id']}.zip"
    assert clip.exists() and package.exists()
    with s.tx() as db:  # an upload under way
        db.execute("INSERT INTO uploads (evidence_id, kind, state, next_attempt_utc, created_utc) VALUES (?, 'clip', 'pending', 't', 't')",
                   (released["id"],))
    r = withdraw(clients["admin"], released["id"], requestRef="req-42")
    assert r.status_code == 200, r.text
    w = r.json()
    assert not clip.exists() and not package.exists()
    assert evidence.path_of(settings, released, "manifest_rel_path").exists()  # the manifest is the record
    assert (w["clip_sha256"], w["clip_bytes"], w["origin"], w["request_ref"]) == (released["sha256"], released["bytes"], "edge", "req-42")
    assert w["requester"] == "J. Doe (parent or guardian)" and w["actor_id"] == "u-admin"
    assert sorted(json.loads(w["removed_files"])) == sorted([f"evidence/{released['rel_path']}", f"exports/{package.name}"])
    assert s.query("SELECT * FROM uploads WHERE evidence_id = ?", (released["id"],)) == []
    # The chain names ids and hashes, never the requester or the reason (D13).
    entry = [e for e in clients["admin"].get("/edge/v1/audit").json() if e["action"] == "evidence.withdrawn"][0]
    assert entry["detail"] == {"withdrawalId": w["id"], "origin": "edge", "sha256": released["sha256"], "removedFiles": 2}
    assert "Doe" not in json.dumps(entry) and "parent's request" not in json.dumps(entry)
    assert audit.verify(s)["ok"] is True
    sent = s.one("SELECT * FROM outbox WHERE entity_type = 'withdrawal'")
    assert sent["entity_id"] == w["id"] and json.loads(sent["payload"])["requester"] == "J. Doe (parent or guardian)"
    assert sent["rank"] > outbox.RANKS["evidence"]  # after the evidence it withdraws
    # Asking again changes nothing.
    assert withdraw(clients["admin"], released["id"]).json()["id"] == w["id"]
    assert len(s.query("SELECT * FROM withdrawals")) == 1


def test_a_withdrawn_clip_is_never_released_exported_or_cut_again(clients, service, released):
    admin, eid = clients["admin"], released["id"]
    assert withdraw(admin, eid).status_code == 200
    assert evidence.released(service.store, released) == (False, "withdrawn on request")
    r = admin.post(f"/edge/v1/evidence/{eid}/export", headers=CSRF)
    assert r.status_code == 409 and "withdrawn" in r.json()["message"]
    r = admin.get(f"/edge/v1/evidence/{eid}/file")
    assert r.status_code == 410 and r.json()["error"] == "withdrawn"
    assert admin.get(f"/edge/v1/evidence/{eid}/manifest").status_code == 200
    assert admin.get(f"/edge/v1/evidence/{eid}").json()["withdrawal"]["reason"] == "parent's request, by email"
    listed = admin.get(f"/edge/v1/evidence?incidentId={released['incident_id']}").json()[0]
    assert listed["release"]["allowed"] is False and listed["withdrawal"]["id"]
    # The organiser is told nothing: withdrawn looks like never released.
    assert clients["organiser"].get(f"/edge/v1/evidence/{eid}").status_code == 404
    with pytest.raises(Exception, match="withdrawn on request"):
        evidence.approve(service.store, service.settings, eid, ADMIN)
    # Not cut again from the recordings, though they are still there.
    r = clients["assessor"].post(f"/edge/v1/incidents/{released['incident_id']}/reopen", headers={**CSRF, "If-Match": "3"},
                                 json={"reason": "check a second angle"})
    assert r.status_code == 200, r.text
    r = clients["operator"].post(f"/edge/v1/incidents/{released['incident_id']}/clips", headers=CSRF, json={"source": "ground"})
    assert r.status_code == 409 and "withdrawn on request" in r.json()["message"]


def test_a_withdrawal_is_kept_as_written(service, released):
    evidence.withdraw(service.store, service.settings, released["id"], "player's own request", "A. Player (player)", ADMIN)
    db = sqlite3.connect(service.settings.db_path)
    for sql in ("UPDATE withdrawals SET reason = 'x'", "DELETE FROM withdrawals"):
        with pytest.raises(sqlite3.IntegrityError, match="kept"):
            db.execute(sql)
    db.close()


def test_only_an_edge_admin_withdraws_and_a_withdrawal_needs_its_reason(clients, service, released):
    for name in ("operator", "assessor", "organiser"):
        assert withdraw(clients[name], released["id"]).status_code == 403
    r = clients["admin"].post(f"/edge/v1/evidence/{released['id']}/withdraw", headers=CSRF, json={"reason": "no", "requester": "x"})
    assert r.status_code == 422
    assert evidence.path_of(service.settings, released).exists() and evidence.withdrawal_of(service.store, released["id"]) is None


class FakeCloud:
    def __init__(self, items):
        self.items = items

    def withdrawals(self):
        return self.items


def test_a_cloud_withdrawal_is_applied_under_the_clouds_id(service, released):
    s, settings = service.store, service.settings
    item = {"id": "8c0b2b7e-2f0e-4d5e-9d8b-7b1d1f2c3a4b", "evidenceId": released["id"], "reason": "parent's request (ticket 17)",
            "requester": "J. Doe (parent_or_guardian)", "requestId": "r-1", "clipSha256": released["sha256"]}
    unknown = {**item, "id": "x-1", "evidenceId": "no-such-evidence"}
    changed = {**item, "id": "x-2", "clipSha256": "0" * 64}
    done = cloud.apply_withdrawals(settings, s, FakeCloud([unknown, changed, item]))
    assert done == [item["id"]]
    w = evidence.withdrawal_of(s, released["id"])
    assert (w["id"], w["origin"], w["request_ref"], w["actor_id"]) == (item["id"], "cloud", "r-1", "cloud")
    assert not evidence.path_of(settings, released).exists()
    # Asked again (the cloud has not yet seen the confirmation): nothing more happens.
    assert cloud.apply_withdrawals(settings, s, FakeCloud([item])) == [item["id"]]
    assert len(s.query("SELECT * FROM withdrawals")) == 1
    assert len(s.query("SELECT * FROM outbox WHERE entity_type = 'withdrawal'")) == 1


def test_withdrawn_footage_is_not_cut_again_through_a_new_incident(clients, service, released):  # noqa: F811
    assert withdraw(clients["admin"], released["id"]).status_code == 200
    incident = service.store.one("SELECT session_id, event_utc FROM incidents WHERE id = ?", (released["incident_id"],))
    made = clients["operator"].post("/edge/v1/incidents", headers=CSRF, json={
        "sessionId": incident["session_id"], "basis": "manual", "eventUtc": incident["event_utc"], "category": "other"})
    assert made.status_code == 201, made.text
    r = clients["operator"].post(f"/edge/v1/incidents/{made.json()['id']}/clips", headers=CSRF, json={"source": "ground"})
    assert r.status_code == 409 and "withdrawn on request" in r.json()["message"]


def test_a_clip_queued_before_a_withdrawal_is_not_cut_after_it(clients, service, session_id, released):  # noqa: F811
    incident = service.store.one("SELECT event_utc FROM incidents WHERE id = ?", (released["incident_id"],))
    made = clients["operator"].post("/edge/v1/incidents", headers=CSRF, json={
        "sessionId": session_id, "basis": "manual", "eventUtc": incident["event_utc"], "category": "other"})
    assert made.status_code == 201, made.text
    job = clients["operator"].post(f"/edge/v1/incidents/{made.json()['id']}/clips", headers=CSRF, json={"source": "ground"}).json()
    assert withdraw(clients["admin"], released["id"]).status_code == 200
    done = evidence.run_job(service.store, service.settings, service.cutter, job["id"])
    assert done["state"] == "failed" and done["error_code"] == "source_withdrawn"


def test_a_withdrawal_empties_the_replay_cache(clients, service, released):  # noqa: F811
    cache = service.settings.data_dir / "replay-cache"
    cache.mkdir(parents=True, exist_ok=True)
    (cache / "window.mp4").write_bytes(b"a copy of a recording")
    assert withdraw(clients["admin"], released["id"]).status_code == 200
    assert not list(cache.iterdir())


# ── the same pictures under another incident go with the withdrawn clip ──

def _another_clip(clients, service, released, event_utc=None, **roll):
    """A clip of the same camera cut now for a new incident: at the withdrawn clip's moment
    unless another is given."""
    incident = service.store.one("SELECT session_id, event_utc FROM incidents WHERE id = ?", (released["incident_id"],))
    made = clients["operator"].post("/edge/v1/incidents", headers=CSRF, json={
        "sessionId": incident["session_id"], "basis": "manual", "eventUtc": event_utc or incident["event_utc"],
        "category": "other", **roll})
    assert made.status_code == 201, made.text
    r = clients["operator"].post(f"/edge/v1/incidents/{made.json()['id']}/clips", headers=CSRF, json={"source": "ground"})
    assert r.status_code == 202, r.text
    assert service.run_jobs_once()
    return clients["assessor"].get(f"/edge/v1/evidence?incidentId={made.json()['id']}").json()[0]


def test_withdrawing_a_clip_takes_every_overlapping_clip_of_that_camera_with_it(clients, service, released):  # noqa: F811
    s, settings = service.store, service.settings
    twin = _another_clip(clients, service, released)
    apart = _another_clip(clients, service, released, event_utc="2026-10-27T14:00:08.000Z", preRollMs=5000, postRollMs=5000)
    assert [t["id"] for t in evidence.twins_of(s, released)] == [twin["id"]]
    r = withdraw(clients["admin"], released["id"], requestRef="req-7")
    assert r.status_code == 200, r.text
    assert r.json()["twins_withdrawn"] == [twin["id"]]
    for row in (released, twin):
        assert not evidence.path_of(settings, row).exists()
        assert evidence.path_of(settings, row, "manifest_rel_path").exists()
        assert evidence.released(s, row) == (False, "withdrawn on request")
        assert clients["admin"].get(f"/edge/v1/evidence/{row['id']}/file").status_code == 410
    w, t = evidence.withdrawal_of(s, released["id"]), evidence.withdrawal_of(s, twin["id"])
    assert t["id"] != w["id"]
    assert (t["origin"], t["reason"], t["requester"], t["request_ref"], t["actor_id"], t["clip_sha256"]) == (
        "edge", w["reason"], w["requester"], "req-7", "u-admin", twin["sha256"])
    # The clip of another moment stays.
    assert evidence.path_of(settings, apart).exists() and evidence.withdrawal_of(s, apart["id"]) is None
    # Linked in the chain, by id only, and each synced on its own.
    entries = {e["entity_id"]: e for e in audit.entries(s) if e["action"] == "evidence.withdrawn"}
    assert set(entries) == {released["id"], twin["id"]}
    assert entries[released["id"]]["detail"]["twinsWithdrawn"] == [twin["id"]]
    assert entries[twin["id"]]["detail"]["twinOf"] == released["id"]
    assert "Doe" not in json.dumps(entries[twin["id"]]) and audit.verify(s)["ok"]
    sent = {x["entity_id"] for x in s.query("SELECT entity_id FROM outbox WHERE entity_type = 'withdrawal'")}
    assert sent == {w["id"], t["id"]}
    # Neither incident is cut a new clip from that camera.
    r = clients["operator"].post(f"/edge/v1/incidents/{twin['incident_id']}/clips", headers=CSRF, json={"source": "ground"})
    assert r.status_code == 409 and "withdrawn on request" in r.json()["message"]
    # Asking again changes nothing and names no twins: they are on their own rows.
    again = withdraw(clients["admin"], released["id"]).json()
    assert again["id"] == w["id"] and "twins_withdrawn" not in again
    assert len(s.query("SELECT * FROM withdrawals")) == 2


def test_a_cloud_withdrawal_takes_the_twins_with_it_under_the_edges_own_ids(clients, service, released):  # noqa: F811
    s, settings = service.store, service.settings
    twin = _another_clip(clients, service, released)
    item = {"id": "8c0b2b7e-2f0e-4d5e-9d8b-7b1d1f2c3a4b", "evidenceId": released["id"], "reason": "parent's request (ticket 17)",
            "requester": "J. Doe (parent_or_guardian)", "requestId": "r-1", "clipSha256": released["sha256"]}
    assert cloud.apply_withdrawals(settings, s, FakeCloud([item])) == [item["id"]]
    t = evidence.withdrawal_of(s, twin["id"])
    assert t is not None and t["id"] != item["id"]
    assert (t["origin"], t["actor_id"], t["request_ref"], t["reason"]) == ("edge", "cloud", "r-1", item["reason"])
    assert not evidence.path_of(settings, twin).exists()
    sent = {x["entity_id"] for x in s.query("SELECT entity_id FROM outbox WHERE entity_type = 'withdrawal'")}
    assert sent == {item["id"], t["id"]}
    # The cloud later withdraws the twin itself: done already, nothing more is written.
    own = {**item, "id": "x-3", "evidenceId": twin["id"], "clipSha256": twin["sha256"]}
    assert cloud.apply_withdrawals(settings, s, FakeCloud([own])) == ["x-3"]
    assert len(s.query("SELECT * FROM withdrawals")) == 2
