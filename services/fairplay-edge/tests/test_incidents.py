"""Phase 3: the incident and review lifecycle, the audit chain, rights, and the v2 → v3 migration."""

import sqlite3
from datetime import timedelta

import pytest

from fairplay_edge import audit, incidents, timing
from fairplay_edge.audit import Actor
from fairplay_edge.naming import iso, utcnow
from fairplay_edge.store import _SCHEMA, _SCHEMA_V2, Store

from .conftest import at

OP = Actor("u-op", "Operator", "operator")
ASSESSOR = Actor("u-as", "Assessor", "operator")
OTHER = Actor("u-as2", "Second assessor", "operator")
ADMIN = Actor("u-admin", "Admin", "operator")
SHOWN = {"ground": "ok", "drone": "uncalibrated"}


@pytest.fixture
def session(store):
    return timing.create_session(store, "Lions v Eagles", "match-123", "shadow", "u-op")


@pytest.fixture
def incident(store, settings, session):
    return incidents.create(store, settings, session["id"], OP, event_utc=at(600), basis="manual", category="foul")


def complete(store, inc, actor=ASSESSOR, result="supports_original", states=SHOWN):
    return incidents.complete_review(store, inc["id"], inc["version"], actor, result=result,
                                     factual_notes="Contact outside the area; ball already played.",
                                     on_field_decision="free kick", evidence_ids=[], footage_states=states)


# ── the state machine ─────────────────────────────────────────────────────

def test_full_lifecycle(store, incident):
    assert incident["state"] == "flagged" and incident["version"] == 1 and incident["match_id"] == "match-123"
    reviewing = incidents.start_review(store, incident["id"], 1, ASSESSOR)
    assert reviewing["state"] == "reviewing" and reviewing["version"] == 2
    reviewed = complete(store, reviewing)
    assert reviewed["state"] == "reviewed" and reviewed["version"] == 3
    [review] = incidents.reviews(store, incident["id"])
    assert review["state"] == "completed" and review["result"] == "supports_original"
    assert review["authority_mode"] == "shadow" and review["reviewer_id"] == "u-as" and review["completed_at"]
    archived = incidents.archive(store, incident["id"], 3, ASSESSOR)
    assert archived["state"] == "archived" and archived["version"] == 4


@pytest.mark.parametrize("step", ["complete", "archive", "reopen"])
def test_steps_out_of_order_are_refused(store, incident, step):
    calls = {
        "complete": lambda: complete(store, incident),
        "archive": lambda: incidents.archive(store, incident["id"], 1, ASSESSOR),
        "reopen": lambda: incidents.reopen(store, incident["id"], 1, ASSESSOR, "because I say so"),
    }
    with pytest.raises(timing.Conflict):
        calls[step]()


def test_reopen_supersedes_never_overwrites(store, incident):
    reviewed = complete(store, incidents.start_review(store, incident["id"], 1, ASSESSOR))
    first = reviewed["current_review_id"]
    with pytest.raises(timing.TimingError, match="reason"):
        incidents.reopen(store, incident["id"], reviewed["version"], OTHER, "")
    reopened = incidents.reopen(store, incident["id"], reviewed["version"], OTHER, "second angle shows contact")
    assert reopened["state"] == "reviewing" and reopened["reopened_count"] == 1
    assert reopened["current_review_id"] != first
    old, new = incidents.reviews(store, incident["id"])
    # The first finding is kept, word for word, and says what replaced it and why.
    assert old["state"] == "superseded" and old["result"] == "supports_original"
    assert old["superseded_by"] == new["id"] and old["superseded_reason"] == "second angle shows contact"
    assert new["state"] == "open" and new["result"] is None
    again = complete(store, reopened, OTHER, "supports_alternative")
    assert again["state"] == "reviewed"
    trail = [e["action"] for e in audit.for_incident(store, incident["id"])]
    assert trail == ["incident.created", "incident.review_started", "review.completed", "incident.reviewed",
                     "incident.reopened", "review.completed", "incident.reviewed"]


def test_reviewed_incident_is_not_edited_in_place(store, settings, incident):
    reviewed = complete(store, incidents.start_review(store, incident["id"], 1, ASSESSOR))
    with pytest.raises(timing.Conflict, match="reopen"):
        incidents.edit(store, settings, incident["id"], reviewed["version"], OP, {"note": "quietly changed"})


def test_edit_collision_loses_nothing(store, settings, incident):
    """Two people load version 1. The first save wins; the second is refused, not merged."""
    first = incidents.edit(store, settings, incident["id"], 1, OP, {"note": "keeper off his line"})
    with pytest.raises(timing.Conflict, match="version 2"):
        incidents.edit(store, settings, incident["id"], 1, ASSESSOR, {"note": "no, he was on it"})
    assert incidents.get(store, incident["id"])["note"] == "keeper off his line" == first["note"]
    with pytest.raises(timing.Conflict):
        incidents.start_review(store, incident["id"], 1, ASSESSOR)


def test_two_assessors_cannot_both_complete(store, incident):
    reviewing = incidents.start_review(store, incident["id"], 1, ASSESSOR)
    complete(store, reviewing, ASSESSOR)
    with pytest.raises(timing.Conflict):
        complete(store, reviewing, OTHER, "supports_alternative")
    assert [r["result"] for r in incidents.reviews(store, incident["id"])] == ["supports_original"]


def test_no_footage_allows_only_footage_unavailable(store, incident):
    reviewing = incidents.start_review(store, incident["id"], 1, ASSESSOR)
    nothing = {"ground": "no_footage", "drone": "no_footage"}
    with pytest.raises(timing.TimingError, match="footage_unavailable"):
        complete(store, reviewing, states=nothing)
    done = complete(store, reviewing, result="footage_unavailable", states=nothing)
    [review] = incidents.reviews(store, incident["id"])
    assert done["state"] == "reviewed" and review["footage_states"] == nothing


def test_a_finding_needs_factual_notes(store, incident):
    reviewing = incidents.start_review(store, incident["id"], 1, ASSESSOR)
    with pytest.raises(timing.TimingError, match="factual notes"):
        incidents.complete_review(store, incident["id"], 2, ASSESSOR, result="inconclusive", factual_notes=" ",
                                  on_field_decision=None, evidence_ids=[], footage_states=SHOWN)


def test_shadow_is_the_only_authority_mode(store, incident):
    incidents.start_review(store, incident["id"], 1, ASSESSOR)
    db = sqlite3.connect(store.path)
    with pytest.raises(sqlite3.IntegrityError):
        db.execute("UPDATE reviews SET authority_mode = 'official'")
    db.close()


# ── bookmarks ─────────────────────────────────────────────────────────────

def test_bookmark_from_the_match_clock(store, settings, session):
    kickoff = utcnow() - timedelta(minutes=70)
    timing.mark_period(store, session["id"], "1", "start", "u", at=kickoff)
    second_half = utcnow() - timedelta(minutes=10)
    timing.mark_period(store, session["id"], "2", "start", "u", at=second_half)
    early = incidents.create(store, settings, session["id"], OP, basis="match_clock", period="1", match_minute=23,
                             match_second=30, player_ref="player-9")
    assert early["event_utc"] == iso(kickoff + timedelta(minutes=23, seconds=30)) and early["player_ref"] == "player-9"
    late = incidents.create(store, settings, session["id"], OP, basis="sheet_event", period="2", match_minute=52,
                            match_second=0, sheet_event_id="sheet-ev-7")
    assert late["event_utc"] == iso(second_half + timedelta(minutes=7)) and late["sheet_event_id"] == "sheet-ev-7"
    with pytest.raises(timing.TimingError, match="before period 2"):
        incidents.create(store, settings, session["id"], OP, basis="match_clock", period="2", match_minute=40)
    with pytest.raises(timing.TimingError, match="not happened yet"):
        incidents.create(store, settings, session["id"], OP, basis="match_clock", period="2", match_minute=80)
    with pytest.raises(timing.TimingError, match="no start mark"):
        incidents.create(store, settings, session["id"], OP, basis="match_clock", period="3", match_minute=95)


def test_incident_records_each_cameras_window(store, settings, session):
    timing.calibrate(store, settings, session["id"], "drone", at(0), at(0.4), 80, "marker", "u")
    inc = incidents.create(store, settings, session["id"], OP, event_utc=at(600), basis="manual")
    by = {w["source"]: w for w in inc["observed_windows"]}
    assert by["ground"]["fromIngestUtc"] == iso(at(580)) and by["ground"]["calibrationId"] is None
    assert by["drone"]["fromIngestUtc"] == iso(at(580.4)) and by["drone"]["toIngestUtc"] == iso(at(610.4))


# ── the audit chain ───────────────────────────────────────────────────────

def test_chain_verifies_and_rows_cannot_be_changed(store, incident):
    incidents.start_review(store, incident["id"], 1, ASSESSOR)
    result = audit.verify(store)
    assert result["ok"] and result["entries"] == 3  # the incident's hold, the incident, the review start
    db = sqlite3.connect(store.path)
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        db.execute("UPDATE audit_log SET actor_name = 'someone else'")
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        db.execute("DELETE FROM audit_log")
    db.close()


def test_tampering_after_dropping_the_trigger_is_detected(store, incident):
    incidents.start_review(store, incident["id"], 1, ASSESSOR)
    db = sqlite3.connect(store.path, isolation_level=None)
    db.execute("DROP TRIGGER audit_log_no_update")
    db.execute("UPDATE audit_log SET actor_name = 'someone else' WHERE seq = 1")
    db.close()
    result = audit.verify(store)
    assert not result["ok"] and result["breakAt"] == 1 and result["reason"] == "entry altered"


def test_every_audit_entry_is_queued_for_the_cloud(store, incident):
    keys = [r["idempotency_key"] for r in store.query("SELECT idempotency_key FROM outbox WHERE entity_type = 'audit'")]
    # {type}:{device}:{seq}:{version}: the incident's retention hold, then the incident.
    assert keys == [f"audit:{store.device_id}:1:1", f"audit:{store.device_id}:2:1"]


# ── rights ────────────────────────────────────────────────────────────────

def test_rights_default_to_nothing_leaves(store, session):
    ok, why = incidents.release_check(incidents.current_rights(store, session["id"]))
    assert not ok and "not recorded" in why


def test_real_footage_with_minors_needs_a_consent_reference(store, session):
    with pytest.raises(timing.TimingError, match="basis"):
        incidents.record_rights(store, session["id"], ADMIN, footage_kind="real", status="external_release_permitted",
                                minors_present="unknown", basis=None, consent_reference=None)
    incidents.record_rights(store, session["id"], ADMIN, footage_kind="real", status="external_release_permitted",
                            minors_present="yes", basis="UFC 2026 media terms §4", consent_reference=None)
    ok, why = incidents.release_check(incidents.current_rights(store, session["id"]))
    assert not ok and "minors" in why
    later = incidents.record_rights(store, session["id"], ADMIN, footage_kind="real", status="external_release_permitted",
                                    minors_present="yes", basis="UFC 2026 media terms §4", consent_reference="CF-2026-118")
    assert incidents.release_check(incidents.current_rights(store, session["id"]))[0]
    assert later["supersedes"] is not None
    assert len(store.query("SELECT * FROM session_rights")) == 2  # history kept


def test_synthetic_footage_may_be_released(store, session):
    incidents.record_rights(store, session["id"], ADMIN, footage_kind="synthetic", status="not_recorded",
                            minors_present="no", basis=None, consent_reference=None)
    assert incidents.release_check(incidents.current_rights(store, session["id"]))[0]


# ── idempotent requests ───────────────────────────────────────────────────

def test_request_keys_replay_and_refuse_reuse(store):
    assert incidents.claim_request(store, "key-12345678", "u", "incidents.create", {"a": 1}) is None
    with pytest.raises(timing.Conflict, match="still being processed"):
        incidents.claim_request(store, "key-12345678", "u", "incidents.create", {"a": 1})
    incidents.finish_request(store, "key-12345678", 201, {"id": "x"})
    assert incidents.claim_request(store, "key-12345678", "u", "incidents.create", {"a": 1}) == {
        "status": 201, "body": {"id": "x"}}
    with pytest.raises(timing.Conflict, match="different request"):
        incidents.claim_request(store, "key-12345678", "u", "incidents.create", {"a": 2})


# ── migration ─────────────────────────────────────────────────────────────

def test_a_phase_2_database_upgrades_in_place(tmp_path):
    path = tmp_path / "v2.sqlite3"
    db = sqlite3.connect(path)
    db.executescript(_SCHEMA + _SCHEMA_V2)
    db.execute("INSERT INTO schema_version (version) VALUES (2)")
    db.execute("INSERT INTO match_sessions (id, label, match_ref, mode, created_utc, created_by)"
               " VALUES ('s1', 'Old match', 'm-9', 'shadow', 't', 'u')")
    db.execute("INSERT INTO incidents (id, session_id, event_utc, basis, pre_roll_ms, post_roll_ms, category, state,"
               " version, created_by, created_utc, updated_utc) VALUES ('i1', 's1', '2026-10-27T14:10:00.000Z',"
               " 'manual', 20000, 10000, 'foul', 'flagged', 3, 'u', 't', 't')")
    db.commit()
    db.close()
    store = Store(path)
    assert store.one("SELECT version FROM schema_version")["version"] == 5  # v3, v4 (uploads), v5 (pairing, access)
    assert store.one("SELECT name FROM sqlite_master WHERE name = 'uploads'")
    row = store.one("SELECT * FROM incidents WHERE id = 'i1'")
    assert (row["state"], row["version"], row["match_id"], row["reopened_count"]) == ("flagged", 3, "m-9", 0)
    assert store.one("SELECT detail FROM events WHERE kind = 'store.migrated'")["detail"] == '{"from": 2, "to": 5}'
    assert Store(path).device_id == store.device_id  # opening again changes nothing
