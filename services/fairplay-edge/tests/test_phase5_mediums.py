"""Phase 5.5, the medium findings of the 5.1 review (docs/fairplay/phase-5-threat-review.md):

  F5  a person signed in at the venue reads the session their bundle was signed for, and the
      footage around it; an Edge admin may read others, and that is audited;
  F6  the device token's expiry is kept at pairing and warned of 30 days ahead;
  F8  holds, local disables, repairs, retention deletions and manifest downloads are in the
      hash-chained audit, and the once-an-hour access record survives a restart.
"""

import json
import uuid
from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from fairplay_edge import audit, cloud, incidents, retention, timing
from fairplay_edge.api import create_app
from fairplay_edge.audit import Actor
from fairplay_edge.auth import BUNDLE_SCHEMA, Sessions, generate_key, hash_pin, key_id, sign_bundle
from fairplay_edge.config import load_settings
from fairplay_edge.manifest import Scanner
from fairplay_edge.naming import iso, parse_iso, utcnow
from fairplay_edge.repair import repair
from fairplay_edge.service import EdgeService
from fairplay_edge.store import Store

from .conftest import T0, at, fmp4, write_segment
from .fakes import FakeMediaMtx
from .test_cloud import paired  # noqa: F401  (fixture)
from .test_phase3_api import CSRF, PEOPLE
from .test_retention_and_repair import NOW, _partial, three_final  # noqa: F401  (fixture)

OWN, OTHER = "s-own", "s-other"
ADMIN = Actor("u-admin", "Admin", "operator")


# ── F5: one session per sign-in ──────────────────────────────────────────

@pytest.fixture
def service(env, tmp_path, fake_probe):
    private, public = generate_key()
    keys = tmp_path / "trusted-keys.json"
    keys.write_text(json.dumps({key_id(public): {"publicKey": public, "issuer": "dev-local"}}))
    now = utcnow()
    bundle = {"schema": BUNDLE_SCHEMA, "bundleId": str(uuid.uuid4()), "issuer": "dev-local", "issuedAt": iso(now),
              "expiresAt": iso(now + timedelta(hours=36)),
              "session": {"id": OWN, "label": "Lions v Eagles", "matchId": "m-own", "mode": "shadow"},
              "members": [{"userId": f"u-{name}", "email": f"{name}@dtp.test", "name": name.title(), "permissions": perms,
                           "pinHash": hash_pin("246810")} for name, perms in PEOPLE.items()]}
    (tmp_path / "bundle.json").write_text(json.dumps(sign_bundle(bundle, private)))
    env.update(FAIRPLAY_TRUSTED_KEYS_FILE=str(keys), FAIRPLAY_BUNDLE_FILE=str(tmp_path / "bundle.json"),
               FAIRPLAY_ALLOW_DEV_BUNDLES="1")
    svc = EdgeService(load_settings(env))
    svc.mediamtx = FakeMediaMtx()
    svc.watchdog.mediamtx = svc.mediamtx
    for t in range(0, 60, 10):
        write_segment(svc.settings.recordings_dir, "ground", at(t), fmp4(3))
    svc.run_once()
    svc.mediamtx.recorded["ground"] = [{"start": iso(T0), "duration": 60.0}]
    for sid, match in ((OWN, "m-own"), (OTHER, "m-other")):
        timing.create_session(svc.store, sid, match, "shadow", "u-admin", session_id=sid)
    return svc


@pytest.fixture
def clients(service):
    app = create_app(service, run_loop=False)
    out = {}
    for name in PEOPLE:
        c = TestClient(app)
        c.__enter__()
        assert c.post("/edge/v1/auth/login", json={"email": f"{name}@dtp.test", "pin": "246810"}).status_code == 200
        out[name] = c
    yield out
    for c in out.values():
        c.__exit__(None, None, None)


def _flag_other(service) -> dict:
    return incidents.create(service.store, service.settings, OTHER, ADMIN, event_utc=at(40), basis="manual",
                            category="foul")


def test_a_member_sees_only_the_session_their_bundle_is_for(clients, service):
    op = clients["operator"]
    assert [s["id"] for s in op.get("/edge/v1/sessions").json()] == [OWN]
    assert {s["id"] for s in clients["admin"].get("/edge/v1/sessions").json()} == {OWN, OTHER}
    other = _flag_other(service)
    # Another match on the same machine looks exactly like one that does not exist.
    for path in (f"/edge/v1/sessions/{OTHER}", f"/edge/v1/incidents?sessionId={OTHER}",
                 f"/edge/v1/incidents/{other['id']}", f"/edge/v1/incidents/{other['id']}/audit",
                 f"/edge/v1/sessions/{OTHER}/rights"):
        assert op.get(path).status_code == 404, path
    assert op.post("/edge/v1/incidents", headers=CSRF, json={"sessionId": OTHER, "basis": "manual",
                   "eventUtc": iso(at(40)), "category": "foul"}).status_code == 404
    assert op.get(f"/edge/v1/sessions/{OWN}").status_code == 200


def test_an_organiser_lists_and_reads_only_their_session(clients):
    org = clients["organiser"]
    assert [s["id"] for s in org.get("/edge/v1/report/sessions").json()] == [OWN]
    assert org.get(f"/edge/v1/report/sessions/{OTHER}").status_code == 404
    assert org.get(f"/edge/v1/report/sessions/{OWN}").status_code == 200


def test_an_admin_may_read_another_session_and_it_is_audited_once_an_hour(clients):
    admin = clients["admin"]
    for _ in range(2):
        assert admin.get(f"/edge/v1/sessions/{OTHER}").status_code == 200
    outside = [e for e in admin.get("/edge/v1/audit").json() if e["action"] == "session.accessed_outside_bundle"]
    assert len(outside) == 1 and outside[0]["entity_id"] == OTHER and outside[0]["actor_id"] == "u-admin"
    assert outside[0]["detail"] == {"bundleSession": OWN}


def test_replay_is_bounded_to_the_time_around_the_session(clients, service):
    op, window = clients["operator"], f"/edge/v1/sources/ground/window?start={iso(T0)}&durationMs=10000"
    # The session was opened now; the recording is from two days ago.
    refused = op.get(window)
    assert refused.status_code == 403 and refused.json()["error"] == "outside_session"
    assert op.get(f"/edge/v1/media/ground?start={iso(T0)}&durationMs=10000").status_code == 403
    assert op.get("/edge/v1/segments").json()["items"] == []
    assert op.get(f"/edge/v1/sources/ground/spans").json()["spans"] == []
    assert clients["admin"].get(window).status_code == 200
    # Opened at the time of the recording: it is the session's footage.
    with service.store.tx() as db:
        db.execute("UPDATE match_sessions SET created_utc = ? WHERE id = ?", (iso(at(30)), OWN))
    assert op.get(window).status_code == 200
    assert len(op.get("/edge/v1/segments").json()["items"]) == 6
    # Opened and ended six hours after the recording: not the session's footage.
    late = iso(at(30) + timedelta(hours=6))
    with service.store.tx() as db:
        db.execute("UPDATE match_sessions SET created_utc = ?, ended_utc = ? WHERE id = ?", (late, late, OWN))
    assert op.get(window).status_code == 403


def test_the_device_token_reads_every_session(service):
    app = create_app(service, run_loop=False)
    with TestClient(app) as c:
        rows = c.get("/edge/v1/sessions", headers={"Authorization": f"Bearer {service.settings.api_token}"}).json()
    assert {r["id"] for r in rows} == {OWN, OTHER}


# ── F8: the acts that matter are chained ─────────────────────────────────

def test_holds_disables_and_repairs_are_in_the_audit_chain(settings, store, fake_probe):
    hold = retention.create_hold(store, None, at(0), at(10), "manual", None, ADMIN)
    retention.release_hold(store, hold["id"], "the incident was withdrawn", ADMIN)
    Sessions(store).disable("u-op", ADMIN, "left the venue")
    _, scanner, row = _partial(settings, store)
    repair(settings, store, scanner, row["id"], ADMIN)
    chained = {e["action"]: e for e in audit.entries(store)}
    for action in ("hold.created", "hold.released", "member.disabled", "segment.repaired"):
        assert chained[action]["actor_id"] == "u-admin", action
    assert chained["hold.released"]["detail"] == {"reason": "the incident was withdrawn"}
    assert chained["member.disabled"]["entity_id"] == "u-op"
    assert audit.verify(store)["ok"]


def test_retention_deletion_is_in_the_audit_chain(settings, store, three_final):  # noqa: F811
    _, rows = three_final
    s = replace(settings, retention_days=30, retention_max_deletions=1)
    retention.apply(s, store, Scanner(s, store), now=NOW)
    deleted = [e for e in audit.entries(store) if e["action"] == "segment.deleted"]
    assert len(deleted) == 1 and deleted[0]["entity_id"] == rows[0]["id"] and deleted[0]["actor_kind"] == "system"
    sha = store.one("SELECT sha256 FROM segments WHERE id = ?", (rows[0]["id"],))["sha256"]
    assert sha and deleted[0]["detail"]["sha256"] == sha


def test_once_an_hour_access_survives_a_restart(settings):
    first = Store(settings.db_path)
    assert audit.record_once(first, "media|u-op|ground|x", ADMIN, "media.accessed", "source", "ground", {})
    assert not audit.record_once(first, "media|u-op|ground|x", ADMIN, "media.accessed", "source", "ground", {})
    restarted = Store(settings.db_path)
    assert not audit.record_once(restarted, "media|u-op|ground|x", ADMIN, "media.accessed", "source", "ground", {})
    with restarted.tx() as db:  # an hour on
        db.execute("UPDATE access_seen SET at_utc = ?", (iso(utcnow() - timedelta(hours=2)),))
    assert audit.record_once(restarted, "media|u-op|ground|x", ADMIN, "media.accessed", "source", "ground", {})
    assert len([e for e in audit.entries(restarted) if e["action"] == "media.accessed"]) == 2


# ── F6: the device token's expiry ────────────────────────────────────────

def test_pairing_keeps_the_token_expiry_and_the_edge_warns_before_it(paired, store):  # noqa: F811
    row = store.one("SELECT * FROM cloud_pairing")
    assert row["cloud_device_id"] == "d-1" and row["token_expires_utc"] == "2027-10-28T00:00:00Z"
    expires = parse_iso(row["token_expires_utc"])

    def open_kinds():
        return {(a["kind"], a["severity"]) for a in store.query("SELECT * FROM alerts WHERE resolved_utc IS NULL")}

    assert cloud.check_token_expiry(store, expires - timedelta(days=60)) is None and open_kinds() == set()
    assert cloud.check_token_expiry(store, expires - timedelta(days=29)) == "expiring"
    assert open_kinds() == {("device_token_expiring", "warning")}
    assert cloud.check_token_expiry(store, expires + timedelta(minutes=1)) == "expired"
    assert open_kinds() == {("device_token_expired", "critical")}
    # Re-paired: a new expiry a year on clears both.
    with store.tx() as db:
        db.execute("UPDATE cloud_pairing SET token_expires_utc = ?", (iso(expires + timedelta(days=365)),))
    assert cloud.check_token_expiry(store, expires + timedelta(minutes=2)) is None and open_kinds() == set()


def test_an_edge_paired_before_this_says_nothing(store):
    assert cloud.check_token_expiry(store) is None
