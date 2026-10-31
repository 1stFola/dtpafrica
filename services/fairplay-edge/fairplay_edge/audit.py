"""The audit log: who did what to which incident, review or piece of evidence, and who saw it.

Append-only twice over. No code here updates or deletes, and SQLite triggers refuse UPDATE
and DELETE on `audit_log`, so a bug elsewhere cannot rewrite history either. Each entry is
hash-chained to the one before it on this device:

    entry_hash = SHA-256( canonical JSON of {seq, at, device, actor, action, entity, detail, prev} )

What the chain proves, and what it does not: anyone with write access to the SQLite file can
drop the triggers and rebuild a consistent chain. The chain makes tampering detectable once
entries have left the device (the outbox syncs every entry, and the cloud checks each one
against the last it holds), and makes any edit *inside* the file without a rebuild fail
`verify()`. It is not a substitute for keeping the Edge machine physically controlled.

Entries are written in the same transaction as the change they describe, so a change can
never commit without its entry, or the entry without the change.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import timedelta

from .naming import iso, utcnow
from .store import Store

GENESIS = "0" * 64

ACTIONS = (
    "incident.created", "incident.edited", "incident.review_started", "incident.reviewed", "incident.archived",
    "incident.reopened",
    "review.completed",
    "evidence.requested", "evidence.created", "evidence.failed", "evidence.approved", "evidence.accessed",
    "evidence.exported",
    "media.accessed",
    "rights.recorded",
    "outbox.parked",
    "evidence.uploaded",
    "session.opened_from_bundle",
    "alert.acknowledged",
    # Phase 5.5 (F8): what protects or removes footage, and who may act, is chained too.
    "hold.created", "hold.released",
    "segment.repaired", "segment.deleted",
    "member.disabled",
    "evidence.manifest_accessed",
    # Phase 5.5 (F5): an Edge admin reading a session other than the bundle's.
    "session.accessed_outside_bundle",
    # Phase 5.6 (F11): a calibration offset beyond the bound, kept on the operator's word.
    "calibration.large_offset_confirmed",
    # Phase 5.7 (D11): a clip withdrawn on request. The requester is on the withdrawal row.
    "evidence.withdrawn",
)


@dataclass(frozen=True)
class Actor:
    id: str
    name: str
    kind: str  # operator, device or system

    @classmethod
    def system(cls) -> "Actor":
        return cls(id="system", name="FairPlay Edge", kind="system")


def canonical(obj: dict) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _hash(entry: dict) -> str:
    body = {k: entry[k] for k in ("seq", "at_utc", "device_id", "actor_id", "actor_name", "actor_kind", "action",
                                  "entity_type", "entity_id", "entity_version", "detail", "prev_hash")}
    return hashlib.sha256(canonical(body)).hexdigest()


def append(db: sqlite3.Connection, actor: Actor, action: str, entity_type: str, entity_id: str | None,
           entity_version: int | None, detail: dict, at_utc: str | None = None) -> dict:
    """Add one entry inside the caller's transaction (which must be BEGIN IMMEDIATE, as
    `Store.tx` is, so two writers cannot both read the same chain head)."""
    if action not in ACTIONS:
        raise ValueError(f"unknown audit action {action!r}")
    device_id = db.execute("SELECT device_id FROM edge_identity").fetchone()["device_id"]
    head = db.execute("SELECT seq, entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1").fetchone()
    entry = {
        "seq": (head["seq"] + 1) if head else 1,
        "at_utc": at_utc or iso(utcnow()),
        "device_id": device_id,
        "actor_id": actor.id,
        "actor_name": actor.name,
        "actor_kind": actor.kind,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_version": entity_version,
        # Stored as the canonical text that was hashed, so verification never depends on
        # how a JSON library orders keys on the day.
        "detail": canonical(detail).decode(),
        "prev_hash": head["entry_hash"] if head else GENESIS,
    }
    entry["entry_hash"] = _hash(entry)
    db.execute(
        "INSERT INTO audit_log (seq, at_utc, device_id, actor_id, actor_name, actor_kind, action, entity_type,"
        " entity_id, entity_version, detail, prev_hash, entry_hash) VALUES (:seq, :at_utc, :device_id, :actor_id,"
        " :actor_name, :actor_kind, :action, :entity_type, :entity_id, :entity_version, :detail, :prev_hash,"
        " :entry_hash)", entry)
    from . import outbox  # outbox imports Actor from here

    # The hashed text goes too: re-encoding the parsed detail in another language need not
    # give the same bytes (a float such as 1.0), and the cloud recomputes the hash from it.
    outbox.enqueue(db, "audit", f"{device_id}:{entry['seq']}", 1, {**view(entry), "detail_text": entry["detail"]})
    return entry


def record(store: Store, actor: Actor, action: str, entity_type: str, entity_id: str | None,
           entity_version: int | None, detail: dict) -> dict:
    """An entry on its own, for reads (access) that change nothing else."""
    with store.tx() as db:
        return append(db, actor, action, entity_type, entity_id, entity_version, detail)


SEEN_FOR = timedelta(hours=1)


def record_once(store: Store, key: str, actor: Actor, action: str, entity_type: str, entity_id: str | None,
                detail: dict) -> bool:
    """An access entry at most once per `key` an hour. A browser fetches one video in many
    range requests; one entry per person and item an hour says who looked without burying
    the log. What was seen is kept in the database, in the same transaction as the entry,
    so a restart neither forgets it nor writes an entry it did not."""
    now = utcnow()
    with store.tx() as db:
        db.execute("DELETE FROM access_seen WHERE at_utc < ?", (iso(now - SEEN_FOR),))
        if db.execute("SELECT 1 FROM access_seen WHERE key = ?", (key,)).fetchone():
            return False
        db.execute("INSERT INTO access_seen (key, at_utc) VALUES (?, ?)", (key, iso(now)))
        append(db, actor, action, entity_type, entity_id, None, detail)
        return True


def view(row: dict) -> dict:
    out = dict(row)
    out["detail"] = json.loads(row["detail"])
    return out


def entries(store: Store, entity_type: str | None = None, entity_id: str | None = None,
            after: int = 0, limit: int = 500) -> list[dict]:
    sql, params = "SELECT * FROM audit_log WHERE seq > ?", [after]
    if entity_type:
        sql += " AND entity_type = ?"
        params.append(entity_type)
    if entity_id:
        sql += " AND entity_id = ?"
        params.append(entity_id)
    return [view(r) for r in store.query(sql + " ORDER BY seq LIMIT ?", (*params, limit))]


def for_incident(store: Store, incident_id: str) -> list[dict]:
    """Everything about one incident: itself, its reviews, its evidence and their jobs."""
    rows = store.query(
        "SELECT * FROM audit_log WHERE (entity_type = 'incident' AND entity_id = :id)"
        " OR (entity_type = 'review' AND entity_id IN (SELECT id FROM reviews WHERE incident_id = :id))"
        " OR (entity_type = 'evidence' AND entity_id IN (SELECT id FROM evidence WHERE incident_id = :id))"
        " OR (entity_type = 'job' AND entity_id IN (SELECT id FROM jobs WHERE incident_id = :id))"
        " ORDER BY seq", {"id": incident_id})
    return [view(r) for r in rows]


def head(store: Store) -> dict | None:
    return store.one("SELECT seq, entry_hash, at_utc FROM audit_log ORDER BY seq DESC LIMIT 1")


def verify(store: Store) -> dict:
    """Walk the whole chain. Reports the first break; never repairs one."""
    prev, count = GENESIS, 0
    db = store._connect()
    try:
        for row in db.execute("SELECT * FROM audit_log ORDER BY seq"):
            entry = dict(row)
            count += 1
            if entry["seq"] != count:
                return {"ok": False, "entries": count - 1, "breakAt": entry["seq"], "reason": "sequence gap"}
            if entry["prev_hash"] != prev:
                return {"ok": False, "entries": count - 1, "breakAt": entry["seq"], "reason": "prev_hash mismatch"}
            if _hash(entry) != entry["entry_hash"]:
                return {"ok": False, "entries": count - 1, "breakAt": entry["seq"], "reason": "entry altered"}
            prev = entry["entry_hash"]
    finally:
        db.close()
    return {"ok": True, "entries": count, "headHash": prev}
