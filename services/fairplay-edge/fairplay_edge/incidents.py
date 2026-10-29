"""Incidents, their reviews, and the rights that decide whether any of it may leave the Edge.

    FLAGGED ──start review──► REVIEWING ──complete──► REVIEWED ──archive──► ARCHIVED
                                  ▲                        │                     │
                                  └────────── reopen (reason, audited) ──────────┘

V1 is shadow review and post-match evidence only (ADR-0001). A finding is a record of what
the footage shows, for the organiser afterwards. Nothing here talks to a referee, changes a
result, or has a mode in which it could.

Every change bumps the incident's `version` and needs the version the caller last saw
(`If-Match`), so two people working on one incident cannot overwrite each other: the second
gets a conflict and reloads. A completed review is never edited. Reopening supersedes it,
keeps it, and starts a new one; the audit log says who, when and why.

Each change, its audit entry and its outbox item commit in one transaction.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta

from . import audit, outbox, retention, timing
from .audit import Actor
from .config import Settings
from .naming import iso, parse_iso, utcnow
from .store import Store, new_id
from .timing import CATEGORIES, Conflict, TimingError

STATES = ("flagged", "reviewing", "reviewed", "archived")
EDITABLE = ("flagged", "reviewing")
RESULTS = ("supports_original", "supports_alternative", "inconclusive", "footage_unavailable")
BASES = ("operator_now", "period_mark", "manual", "sheet_event", "match_clock")
FOOTAGE_KINDS = ("synthetic", "real")
RIGHTS_STATUSES = ("not_recorded", "internal_review_only", "external_release_permitted")
MINORS = ("yes", "no", "unknown")


class NotFound(KeyError):
    pass


def get(store: Store, incident_id: str) -> dict:
    row = store.one("SELECT * FROM incidents WHERE id = ?", (incident_id,))
    if row is None:
        raise NotFound(incident_id)
    return view(row)


def view(row: dict) -> dict:
    out = dict(row)
    out["observed_windows"] = json.loads(row["observed_windows"]) if row.get("observed_windows") else None
    return out


def _check_version(row: dict, version: int) -> None:
    if row["version"] != version:
        raise Conflict(f"the incident is at version {row['version']}, not {version}; reload before changing it")


def _save(db, incident_id: str, version: int, fields: dict) -> None:
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    cur = db.execute(f"UPDATE incidents SET {sets}, version = version + 1 WHERE id = :_id AND version = :_v",
                     {**fields, "_id": incident_id, "_v": version})
    if cur.rowcount != 1:
        raise Conflict("the incident changed while this change was being saved; reload")


def _sync_incident(db, incident_id: str) -> dict:
    row = dict(db.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone())
    outbox.enqueue(db, "incident", incident_id, row["version"], view(row))
    return row


# ── bookmarks ─────────────────────────────────────────────────────────────

def period_base_minutes(settings: Settings, period: str) -> int | None:
    half, extra = settings.period_minutes, settings.extra_period_minutes
    return {"1": 0, "2": half, "3": 2 * half, "4": 2 * half + extra}.get(period)


def from_match_clock(store: Store, settings: Settings, session_id: str, period: str, minute: int,
                     second: int) -> datetime:
    """The Edge-clock instant a match-clock reading names, from the period's start mark.

    Approximate by nature: it is as good as the period mark and as the referee's watch, and
    stoppage time is just more minutes (45+2 is 47:00 in the first period)."""
    base = period_base_minutes(settings, period)
    if base is None:
        raise TimingError("a match-clock bookmark needs period 1-4; mark penalties from the replay instead")
    start = next((p for p in timing.current_periods(store, session_id) if p["period"] == period and p["edge"] == "start"),
                 None)
    if start is None:
        raise TimingError(f"period {period} has no start mark, so the match clock cannot be placed on the Edge clock")
    elapsed = (minute * 60 + second) - base * 60
    if elapsed < 0:
        raise TimingError(f"{minute}:{second:02d} is before period {period} begins ({base}:00)")
    event = parse_iso(start["edge_utc"]) + timedelta(seconds=elapsed)
    if event > utcnow() + timedelta(seconds=5):
        raise TimingError(f"{minute}:{second:02d} in period {period} has not happened yet on the Edge clock")
    return event


def window_definitions(store: Store, settings: Settings, session_id: str, event: datetime, pre_ms: int,
                       post_ms: int) -> list[dict]:
    """Where each camera's footage of this moment is expected, from its current calibration.
    Recorded on the incident when it is flagged, so the evidence can show what was asked."""
    out = []
    for source in settings.sources:
        cal = timing.current_calibration(store, session_id, source.name)
        offset = cal["offset_ms"] if cal else 0
        out.append({
            "source": source.name,
            "fromIngestUtc": iso(event - timedelta(milliseconds=pre_ms - offset)),
            "toIngestUtc": iso(event + timedelta(milliseconds=post_ms + offset)),
            "offsetMs": offset,
            "uncertaintyMs": cal["uncertainty_ms"] if cal else timing.UNCALIBRATED_UNCERTAINTY_MS,
            "calibrationId": cal["id"] if cal else None,
        })
    return out


# ── incidents ─────────────────────────────────────────────────────────────

def create(store: Store, settings: Settings, session_id: str, actor: Actor, *, event_utc: datetime | None = None,
           basis: str = "operator_now", category: str = "other", note: str | None = None,
           pre_roll_ms: int = 20_000, post_roll_ms: int = 10_000, period: str | None = None,
           match_minute: int | None = None, match_second: int | None = None, sheet_event_id: str | None = None,
           player_ref: str | None = None) -> dict:
    session = timing._open(store, session_id)
    if category not in CATEGORIES:
        raise TimingError(f"category must be one of {', '.join(CATEGORIES)}")
    if basis not in BASES:
        raise TimingError("unknown basis")
    if basis == "sheet_event" and not sheet_event_id:
        raise TimingError("an event-linked incident needs the ScoreBoard event id")
    timing._validate_rolls(pre_roll_ms, post_roll_ms)
    if event_utc is None and basis in ("match_clock", "sheet_event") and match_minute is not None:
        if period is None:
            raise TimingError("a match-clock bookmark needs its period")
        event_utc = from_match_clock(store, settings, session_id, period, match_minute, match_second or 0)
    elif event_utc is None and basis not in ("operator_now",):
        raise TimingError(f"basis {basis} needs eventUtc or a match minute")
    event = event_utc or utcnow()
    now = iso(utcnow())
    incident_id = new_id()
    lo, hi = timing._hold_window(event, pre_roll_ms, post_roll_ms)
    # The footage around an incident is protected from retention from the moment it is flagged.
    hold = retention.create_hold(store, None, lo, hi, "incident", incident_id, actor)
    row = {"id": incident_id, "session_id": session_id, "match_id": session["match_ref"], "event_utc": iso(event),
           "basis": basis, "pre_roll_ms": pre_roll_ms, "post_roll_ms": post_roll_ms, "category": category,
           "note": note, "period": period, "match_minute": match_minute, "match_second": match_second,
           "sheet_event_id": sheet_event_id, "player_ref": player_ref,
           "observed_windows": json.dumps(window_definitions(store, settings, session_id, event, pre_roll_ms,
                                                             post_roll_ms)),
           "state": "flagged", "version": 1, "hold_id": hold["id"], "created_by": actor.id, "created_utc": now,
           "updated_utc": now}
    with store.tx() as db:
        db.execute("INSERT INTO incidents (id, session_id, match_id, event_utc, basis, pre_roll_ms, post_roll_ms,"
                   " category, note, period, match_minute, match_second, sheet_event_id, player_ref, observed_windows,"
                   " state, version, hold_id, created_by, created_utc, updated_utc) VALUES (:id, :session_id,"
                   " :match_id, :event_utc, :basis, :pre_roll_ms, :post_roll_ms, :category, :note, :period,"
                   " :match_minute, :match_second, :sheet_event_id, :player_ref, :observed_windows, :state, :version,"
                   " :hold_id, :created_by, :created_utc, :updated_utc)", row)
        Store.log_event(db, now, "incident.flagged", None, {"id": incident_id, "by": actor.id})
        audit.append(db, actor, "incident.created", "incident", incident_id, 1,
                     {k: row[k] for k in ("session_id", "match_id", "event_utc", "basis", "category", "period",
                                          "match_minute", "match_second", "sheet_event_id", "player_ref",
                                          "pre_roll_ms", "post_roll_ms")})
        _sync_incident(db, incident_id)
    return get(store, incident_id)


EDIT_FIELDS = {"pre_roll_ms", "post_roll_ms", "category", "note", "match_minute", "match_second", "period",
               "player_ref"}


def edit(store: Store, settings: Settings, incident_id: str, version: int, actor: Actor, changes: dict) -> dict:
    row = get(store, incident_id)
    _check_version(row, version)
    if row["state"] not in EDITABLE:
        raise Conflict(f"a {row['state']} incident is not edited; reopen it (with a reason) first")
    changes = {k: v for k, v in changes.items() if k in EDIT_FIELDS and v != row[k]}
    merged = {**row, **changes}
    if merged["category"] not in CATEGORIES:
        raise TimingError(f"category must be one of {', '.join(CATEGORIES)}")
    timing._validate_rolls(merged["pre_roll_ms"], merged["post_roll_ms"])
    now = iso(utcnow())
    fields = {k: merged[k] for k in changes}
    if {"pre_roll_ms", "post_roll_ms"} & changes.keys():
        event = parse_iso(row["event_utc"])
        lo, hi = timing._hold_window(event, merged["pre_roll_ms"], merged["post_roll_ms"])
        new_hold = retention.create_hold(store, None, lo, hi, "incident", incident_id, actor)
        if row["hold_id"]:
            retention.release_hold(store, row["hold_id"], "incident window changed; replaced by a new hold", actor)
        fields["hold_id"] = new_hold["id"]
        fields["observed_windows"] = json.dumps(window_definitions(store, settings, row["session_id"], event,
                                                                   merged["pre_roll_ms"], merged["post_roll_ms"]))
    with store.tx() as db:
        _save(db, incident_id, version, {**fields, "updated_utc": now})
        Store.log_event(db, now, "incident.updated", None, {"id": incident_id, "by": actor.id, "from": version,
                                                            "changes": changes})
        audit.append(db, actor, "incident.edited", "incident", incident_id, version + 1,
                     {"from": version, "changes": {k: {"was": row[k], "now": v} for k, v in changes.items()}})
        _sync_incident(db, incident_id)
    return get(store, incident_id)


# ── reviews ───────────────────────────────────────────────────────────────

def reviews(store: Store, incident_id: str) -> list[dict]:
    return [review_view(r) for r in store.query("SELECT * FROM reviews WHERE incident_id = ? ORDER BY started_utc",
                                                (incident_id,))]


def review_view(row: dict) -> dict:
    out = dict(row)
    for key in ("evidence_ids", "footage_states"):
        out[key] = json.loads(row[key]) if row.get(key) else None
    return out


def _sync_review(db, review_id: str) -> None:
    row = dict(db.execute("SELECT * FROM reviews WHERE id = ?", (review_id,)).fetchone())
    outbox.enqueue(db, "review", review_id, row["version"], review_view(row))


def _open_review(db, incident: dict, actor: Actor, now: str) -> str:
    review_id = new_id()
    db.execute("INSERT INTO reviews (id, incident_id, incident_version, reviewer_id, reviewer_name, state, version,"
               " started_utc) VALUES (?, ?, ?, ?, ?, 'open', 1, ?)",
               (review_id, incident["id"], incident["version"] + 1, actor.id, actor.name, now))
    _sync_review(db, review_id)
    return review_id


def start_review(store: Store, incident_id: str, version: int, actor: Actor) -> dict:
    row = get(store, incident_id)
    _check_version(row, version)
    if row["state"] != "flagged":
        raise Conflict(f"only a flagged incident can start review; this one is {row['state']}")
    now = iso(utcnow())
    with store.tx() as db:
        review_id = _open_review(db, row, actor, now)
        _save(db, incident_id, version, {"state": "reviewing", "current_review_id": review_id, "updated_utc": now})
        audit.append(db, actor, "incident.review_started", "incident", incident_id, version + 1,
                     {"reviewId": review_id})
        _sync_incident(db, incident_id)
    return get(store, incident_id)


def complete_review(store: Store, incident_id: str, version: int, actor: Actor, *, result: str,
                    factual_notes: str, on_field_decision: str | None, evidence_ids: list[str],
                    footage_states: dict[str, str]) -> dict:
    """`footage_states` is what each source's window showed when the finding was made
    (timing.incident_windows), stored with the finding so it can be read back later."""
    row = get(store, incident_id)
    _check_version(row, version)
    if row["state"] != "reviewing":
        raise Conflict(f"only an incident under review can be completed; this one is {row['state']}")
    if result not in RESULTS:
        raise TimingError(f"result must be one of {', '.join(RESULTS)}")
    notes = (factual_notes or "").strip()
    if len(notes) < 3:
        raise TimingError("a finding needs factual notes: what the footage shows, not an opinion of the referee")
    if result != "footage_unavailable" and footage_states and all(s == "no_footage" for s in footage_states.values()):
        raise TimingError("no source recorded this moment; the only honest finding is footage_unavailable")
    known = {e["id"] for e in store.query("SELECT id FROM evidence WHERE incident_id = ?", (incident_id,))}
    if set(evidence_ids) - known:
        raise TimingError("evidence ids must belong to this incident")
    review_id = row["current_review_id"]
    now = iso(utcnow())
    with store.tx() as db:
        cur = db.execute(
            "UPDATE reviews SET state = 'completed', result = ?, factual_notes = ?, on_field_decision = ?,"
            " evidence_ids = ?, footage_states = ?, reviewer_id = ?, reviewer_name = ?, completed_at = ?,"
            " incident_version = ?, version = version + 1 WHERE id = ? AND state = 'open'",
            (result, notes, on_field_decision, json.dumps(sorted(evidence_ids)), json.dumps(footage_states, sort_keys=True),
             actor.id, actor.name, now, version + 1, review_id))
        if cur.rowcount != 1:
            raise Conflict("the review is no longer open; reload")
        _save(db, incident_id, version, {"state": "reviewed", "updated_utc": now})
        audit.append(db, actor, "review.completed", "review", review_id, 2,
                     {"incidentId": incident_id, "result": result, "evidenceIds": sorted(evidence_ids),
                      "footageStates": footage_states, "notesSha256": hashlib.sha256(notes.encode()).hexdigest()})
        audit.append(db, actor, "incident.reviewed", "incident", incident_id, version + 1,
                     {"reviewId": review_id, "result": result})
        _sync_review(db, review_id)
        _sync_incident(db, incident_id)
    return get(store, incident_id)


def archive(store: Store, incident_id: str, version: int, actor: Actor) -> dict:
    row = get(store, incident_id)
    _check_version(row, version)
    if row["state"] != "reviewed":
        raise Conflict(f"only a reviewed incident can be archived; this one is {row['state']}")
    now = iso(utcnow())
    with store.tx() as db:
        _save(db, incident_id, version, {"state": "archived", "updated_utc": now})
        audit.append(db, actor, "incident.archived", "incident", incident_id, version + 1, {})
        _sync_incident(db, incident_id)
    return get(store, incident_id)


def reopen(store: Store, incident_id: str, version: int, actor: Actor, reason: str) -> dict:
    row = get(store, incident_id)
    _check_version(row, version)
    if row["state"] not in ("reviewed", "archived"):
        raise Conflict(f"only a reviewed or archived incident can be reopened; this one is {row['state']}")
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise TimingError("reopening needs a reason")
    now = iso(utcnow())
    with store.tx() as db:
        old = row["current_review_id"]
        new_review = _open_review(db, row, actor, now)
        if old:
            db.execute("UPDATE reviews SET state = 'superseded', superseded_by = ?, superseded_reason = ?,"
                       " version = version + 1 WHERE id = ? AND state = 'completed'", (new_review, reason, old))
            _sync_review(db, old)
        _save(db, incident_id, version, {"state": "reviewing", "current_review_id": new_review,
                                         "reopened_count": row["reopened_count"] + 1, "updated_utc": now})
        audit.append(db, actor, "incident.reopened", "incident", incident_id, version + 1,
                     {"from": row["state"], "reason": reason, "supersededReview": old, "newReview": new_review})
        _sync_incident(db, incident_id)
    return get(store, incident_id)


# ── rights ────────────────────────────────────────────────────────────────

def current_rights(store: Store, session_id: str) -> dict:
    row = store.one("SELECT * FROM session_rights r WHERE session_id = ? AND NOT EXISTS"
                    " (SELECT 1 FROM session_rights s WHERE s.supersedes = r.id) ORDER BY created_utc DESC LIMIT 1",
                    (session_id,))
    if row is None:
        # The default is the safe one: treat footage as real and rights as unknown.
        return {"id": None, "session_id": session_id, "footage_kind": "real", "status": "not_recorded",
                "minors_present": "unknown", "basis": None, "consent_reference": None, "recorded_by": None,
                "recorded_name": None, "created_utc": None, "supersedes": None}
    return row


def release_check(rights: dict) -> tuple[bool, str]:
    """May footage of this session be made available outside the Edge's own staff?"""
    if rights["footage_kind"] == "synthetic":
        return True, "synthetic test footage: no player is shown"
    if rights["status"] != "external_release_permitted":
        return False, ("rights and consent for this match are not recorded as permitting release; an admin must"
                       " record them first (Rights panel)")
    if rights["minors_present"] != "no" and not rights["consent_reference"]:
        return False, "players may be minors and no consent reference is recorded"
    return True, "release permitted by the recorded rights"


def record_rights(store: Store, session_id: str, actor: Actor, *, footage_kind: str, status: str,
                  minors_present: str, basis: str | None, consent_reference: str | None) -> dict:
    timing.get_session(store, session_id)
    if footage_kind not in FOOTAGE_KINDS or status not in RIGHTS_STATUSES or minors_present not in MINORS:
        raise TimingError("footage kind, status or minors value not recognised")
    basis = (basis or "").strip() or None
    consent_reference = (consent_reference or "").strip() or None
    if status == "external_release_permitted" and footage_kind == "real" and not basis:
        raise TimingError("permitting release of real footage needs its basis (the agreement or licence)")
    previous = current_rights(store, session_id)
    row = {"id": new_id(), "session_id": session_id, "footage_kind": footage_kind, "status": status,
           "minors_present": minors_present, "basis": basis, "consent_reference": consent_reference,
           "recorded_by": actor.id, "recorded_name": actor.name, "created_utc": iso(utcnow()),
           "supersedes": previous["id"]}
    with store.tx() as db:
        db.execute("INSERT INTO session_rights (id, session_id, footage_kind, status, minors_present, basis,"
                   " consent_reference, recorded_by, recorded_name, created_utc, supersedes) VALUES (:id, :session_id,"
                   " :footage_kind, :status, :minors_present, :basis, :consent_reference, :recorded_by,"
                   " :recorded_name, :created_utc, :supersedes)", row)
        audit.append(db, actor, "rights.recorded", "rights", row["id"], 1,
                     {k: row[k] for k in ("session_id", "footage_kind", "status", "minors_present", "basis",
                                          "consent_reference", "supersedes")})
        outbox.enqueue(db, "rights", row["id"], 1, row)
    return row


# ── idempotent requests ───────────────────────────────────────────────────

IN_PROGRESS = 0


def body_hash(body: dict) -> str:
    return hashlib.sha256(outbox.canonical(body)).hexdigest()


def claim_request(store: Store, key: str, actor_id: str, route: str, body: dict) -> dict | None:
    """Reserve an Idempotency-Key. Returns the stored answer if the same request was already
    made; raises Conflict if the key was used for something else or is still in flight."""
    digest = body_hash(body)
    with store.tx() as db:
        row = db.execute("SELECT * FROM request_keys WHERE key = ?", (key,)).fetchone()
        if row is None:
            db.execute("INSERT INTO request_keys (key, actor_id, route, body_hash, status, response, created_utc)"
                       " VALUES (?, ?, ?, ?, ?, '', ?)", (key, actor_id, route, digest, IN_PROGRESS, iso(utcnow())))
            return None
    if row["actor_id"] != actor_id or row["route"] != route or row["body_hash"] != digest:
        raise Conflict("this Idempotency-Key was already used for a different request")
    if row["status"] == IN_PROGRESS:
        raise Conflict("the same request is still being processed; wait and reload")
    return {"status": row["status"], "body": json.loads(row["response"])}


def finish_request(store: Store, key: str, status: int, response: dict | None) -> None:
    with store.tx() as db:
        if response is None:
            # The request failed: free the key, so the same request can be tried again.
            db.execute("DELETE FROM request_keys WHERE key = ? AND status = ?", (key, IN_PROGRESS))
        else:
            db.execute("UPDATE request_keys SET status = ?, response = ? WHERE key = ?",
                       (status, outbox.canonical(response).decode(), key))
