"""RC1 (Fola, 6 November 2026; rights-checklist.md): an incident's hold ends 14 days after its
finding, unless a manual hold stands over the same footage, and the sources of its clips are
released at the same moment. The clips themselves stay (D10). An incident with no finding keeps
its hold, and a reopened incident holds its footage again. Closes R25."""

from dataclasses import replace
from datetime import timedelta

from fairplay_edge import audit, evidence, incidents, retention
from fairplay_edge.audit import Actor
from fairplay_edge.naming import iso, parse_iso, utcnow

from .test_phase3_api import CSRF, clients, flag, service, session_id, to_reviewed  # noqa: F401  (fixtures)

ADMIN = Actor("u-admin", "Admin", "operator")
FAR = timedelta(days=40)  # retention's "now": the fixture's recordings are from 27 October 2026


def _found_days_ago(service, inc, days):  # noqa: F811
    with service.store.tx() as db:
        db.execute("UPDATE reviews SET completed_at = ? WHERE id = ?",
                   (iso(utcnow() - timedelta(days=days)), inc["current_review_id"]))


def _hold(store, inc):
    return store.one("SELECT * FROM holds WHERE id = ?", (incidents.get(store, inc["id"])["hold_id"],))


def _refs(store, ev):
    return [r["synced"] for r in store.query("SELECT synced FROM evidence_refs WHERE evidence_id = ?", (ev["id"],))]


def _eligible(store):
    return {r["id"] for r in retention.plan(store, 30, utcnow() + FAR)}


def test_an_incident_hold_ends_14_days_after_its_finding_and_frees_its_clip_sources(clients, service, session_id):  # noqa: F811
    store = service.store
    a, ev_a = to_reviewed(clients, service, session_id)
    b, ev_b = to_reviewed(clients, service, session_id, release_rights=False)  # the same moment: its clip shares A's sources
    assert ev_a["source_segment_ids"] and set(ev_a["source_segment_ids"]) == set(ev_b["source_segment_ids"])
    _found_days_ago(service, a, 15)
    _found_days_ago(service, b, 13)
    now = utcnow()
    released = retention.release_finished_incident_holds(store, now)
    assert [r["incidentId"] for r in released] == [a["id"]]
    assert released[0]["rule"] == "RC1" and released[0]["refsReleased"] == len(ev_a["source_segment_ids"])
    assert _hold(store, a)["released_utc"] and _hold(store, b)["released_utc"] is None
    assert set(_refs(store, ev_a)) == {1} and set(_refs(store, ev_b)) == {0}
    # In the chain as the system, with the rule and the incident named, and no text (D13).
    entry = [e for e in audit.entries(store) if e["action"] == "hold.released"][-1]
    assert entry["actor_kind"] == "system" and entry["entity_id"] == _hold(store, a)["id"]
    assert entry["detail"]["rule"] == "RC1" and entry["detail"]["incidentId"] == a["id"] and entry["detail"]["days"] == 14
    assert "finding is 14 days old" not in str(entry) and audit.verify(store)["ok"]
    assert retention.release_finished_incident_holds(store, now) == []
    # B's hold still stands over the same footage, so retention leaves it...
    assert not (set(ev_a["source_segment_ids"]) & _eligible(store))
    _found_days_ago(service, b, 15)
    assert [r["incidentId"] for r in retention.release_finished_incident_holds(store, now)] == [b["id"]]
    assert set(ev_a["source_segment_ids"]) <= _eligible(store)
    # ...but an incident with no finding keeps its hold (a hold's margin is a minute, so it covers this footage)...
    c = flag(clients["operator"], session_id, eventUtc="2026-10-27T14:00:05.000Z").json()
    assert _hold(store, c)["released_utc"] is None and not (set(ev_a["source_segment_ids"]) & _eligible(store))
    assert retention.release_finished_incident_holds(store, now) == []
    retention.release_hold(store, _hold(store, c)["id"], "a false alarm", ADMIN)
    assert set(ev_a["source_segment_ids"]) <= _eligible(store)
    # ...and so does a manual hold over the same footage.
    a_hold = _hold(store, a)
    retention.create_hold(store, None, parse_iso(a_hold["from_utc"]), parse_iso(a_hold["to_utc"]), "manual", "the parent asked", ADMIN)
    assert not (set(ev_a["source_segment_ids"]) & _eligible(store))


def test_the_retention_pass_releases_the_hold_then_deletes_the_footage_and_keeps_the_clip(clients, service, session_id):  # noqa: F811
    store = service.store
    a, ev = to_reviewed(clients, service, session_id)
    _found_days_ago(service, a, 15)
    s = replace(service.settings, retention_days=30)
    assert retention.apply(s, store, service.scanner, now=utcnow(), clock_confirmed=True) == []  # the match is not 30 days old
    assert _hold(store, a)["released_utc"]  # but the finding is 14 days old
    deleted = retention.apply(s, store, service.scanner, now=utcnow() + FAR, clock_confirmed=True)
    assert set(ev["source_segment_ids"]) <= {d["id"] for d in deleted}
    assert evidence.path_of(service.settings, ev).exists()  # the clip stays (D10)
    evidence.verify_file(store, service.settings, evidence.get(store, ev["id"]))


def test_reopening_after_the_hold_ended_holds_the_footage_again(clients, service, session_id):  # noqa: F811
    store = service.store
    a, _ = to_reviewed(clients, service, session_id)
    b, _ = to_reviewed(clients, service, session_id, release_rights=False)
    _found_days_ago(service, a, 15)
    retention.release_finished_incident_holds(store)
    old, b_hold = _hold(store, a), _hold(store, b)
    assert old["released_utc"] and b_hold["released_utc"] is None
    for inc in (a, b):
        version = incidents.get(store, inc["id"])["version"]
        r = clients["assessor"].post(f"/edge/v1/incidents/{inc['id']}/reopen", headers={**CSRF, "If-Match": str(version)},
                                     json={"reason": "check a second angle"})
        assert r.status_code == 200, r.text
    renewed = _hold(store, a)
    assert renewed["id"] != old["id"] and renewed["released_utc"] is None and renewed["reason"] == "incident"
    assert (renewed["from_utc"], renewed["to_utc"]) == (old["from_utc"], old["to_utc"])
    assert _hold(store, b)["id"] == b_hold["id"]  # a hold that still stands is kept
    assert audit.verify(store)["ok"]


def test_a_reference_from_before_schema_10_is_released_by_segment_unless_another_held_incident_needs_it(clients, service, session_id):  # noqa: F811
    store = service.store
    a, ev_a = to_reviewed(clients, service, session_id)
    b, ev_b = to_reviewed(clients, service, session_id, release_rights=False)
    with store.tx() as db:  # as an Edge upgraded from before version 10 holds them
        db.execute("UPDATE evidence_refs SET evidence_id = NULL")
    total = len(store.query("SELECT 1 FROM evidence_refs"))
    _found_days_ago(service, a, 15)
    assert retention.release_finished_incident_holds(store)[0]["refsReleased"] == 0  # B, still held, has a clip from the same segments
    assert {r["synced"] for r in store.query("SELECT synced FROM evidence_refs")} == {0}
    _found_days_ago(service, b, 15)
    assert retention.release_finished_incident_holds(store)[0]["refsReleased"] == total
    assert {r["synced"] for r in store.query("SELECT synced FROM evidence_refs")} == {1}
    assert set(ev_a["source_segment_ids"]) | set(ev_b["source_segment_ids"]) <= _eligible(store)
