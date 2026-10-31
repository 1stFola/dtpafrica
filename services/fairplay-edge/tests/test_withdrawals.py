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
