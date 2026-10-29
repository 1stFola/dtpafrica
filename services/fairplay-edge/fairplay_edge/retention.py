"""Bounded retention that cannot delete what an incident or unsynced evidence still needs.

Off unless `FAIRPLAY_RETENTION_DAYS` is set: the retention period needs the organiser's
agreement first (docs/fairplay/blockers.md B7). With it off, `plan()` still answers "what
would go" for a given number of days, which is how the rule is checked before it is trusted.

A segment may be deleted only if ALL of these hold:
  - it is final (finalized, partial or corrupt), never `recording`;
  - it ended before the cut-off;
  - no unreleased hold overlaps it (a hold with no source covers every source);
  - no evidence row references it that has not been synced;
  - the run has not reached `FAIRPLAY_RETENTION_MAX_DELETIONS`.
Each rule is re-checked inside the delete's own transaction, so a hold added between
planning and deleting still wins. The manifest row and sidecar are kept and marked deleted:
the record that a segment existed outlives the segment.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from . import audit
from .audit import Actor
from .config import Settings
from .manifest import Scanner
from .naming import iso, utcnow
from .store import Store, new_id

log = logging.getLogger("fairplay.retention")

HOLD_REASONS = ("incident", "evidence", "manual")

_ELIGIBLE = """
SELECT s.* FROM segments s
WHERE s.state IN ('finalized', 'partial', 'corrupt')
  AND COALESCE(s.end_utc, s.start_utc) < :cutoff
  AND NOT EXISTS (
      SELECT 1 FROM holds h
      WHERE h.released_utc IS NULL
        AND (h.source IS NULL OR h.source = s.source)
        AND h.from_utc < COALESCE(s.end_utc, s.start_utc)
        AND h.to_utc > s.start_utc)
  AND NOT EXISTS (
      SELECT 1 FROM evidence_refs e WHERE e.segment_id = s.id AND e.synced = 0)
"""


def create_hold(store: Store, source: str | None, from_utc: datetime, to_utc: datetime, reason: str,
                ref: str | None, actor: Actor | None = None) -> dict:
    if reason not in HOLD_REASONS:
        raise ValueError(f"reason must be one of {', '.join(HOLD_REASONS)}")
    if to_utc <= from_utc:
        raise ValueError("a hold must end after it starts")
    hold = {"id": new_id(), "source": source, "from_utc": iso(from_utc), "to_utc": iso(to_utc),
            "reason": reason, "ref": ref, "created_utc": iso(utcnow())}
    with store.tx() as db:
        db.execute(
            "INSERT INTO holds (id, source, from_utc, to_utc, reason, ref, created_utc)"
            " VALUES (:id, :source, :from_utc, :to_utc, :reason, :ref, :created_utc)", hold,
        )
        Store.log_event(db, hold["created_utc"], "hold.created", None, hold)
        audit.append(db, actor or Actor.system(), "hold.created", "hold", hold["id"], None,
                     {k: hold[k] for k in ("source", "from_utc", "to_utc", "reason", "ref")})
    return hold


def release_hold(store: Store, hold_id: str, reason: str, actor: Actor | None = None) -> dict | None:
    """Release a hold, with a reason. Who released it is in the audit chain: a released hold
    lets retention delete the footage, so this act is never only in the mutable event log."""
    if not reason.strip():
        raise ValueError("releasing a hold needs a reason")
    now = iso(utcnow())
    with store.tx() as db:
        cur = db.execute(
            "UPDATE holds SET released_utc = ?, release_reason = ? WHERE id = ? AND released_utc IS NULL",
            (now, reason, hold_id),
        )
        if not cur.rowcount:
            return None
        Store.log_event(db, now, "hold.released", None, {"id": hold_id, "reason": reason})
        audit.append(db, actor or Actor.system(), "hold.released", "hold", hold_id, None, {"reason": reason})
    return store.one("SELECT * FROM holds WHERE id = ?", (hold_id,))


def plan(store: Store, days: int, now: datetime | None = None, limit: int | None = None) -> list[dict]:
    cutoff = iso((now or utcnow()) - timedelta(days=days))
    sql = _ELIGIBLE + " ORDER BY s.start_utc"
    rows = store.query(sql, {"cutoff": cutoff})
    return rows[:limit] if limit is not None else rows


def apply(settings: Settings, store: Store, scanner: Scanner, now: datetime | None = None) -> list[dict]:
    if settings.retention_days is None:
        return []
    now = now or utcnow()
    cutoff = iso(now - timedelta(days=settings.retention_days))
    deleted = []
    for row in plan(store, settings.retention_days, now, settings.retention_max_deletions):
        at = iso(utcnow())
        with store.tx() as db:
            # Re-check inside the transaction that deletes.
            still = db.execute(_ELIGIBLE + " AND s.id = :id", {"cutoff": cutoff, "id": row["id"]}).fetchone()
            if still is None:
                continue
            path = settings.recordings_dir / row["rel_path"]
            path.unlink(missing_ok=True)
            for derivative in db.execute("SELECT rel_path FROM derivatives WHERE segment_id = ?", (row["id"],)):
                (settings.repaired_dir / derivative["rel_path"]).unlink(missing_ok=True)
            db.execute("UPDATE segments SET state = 'deleted', deleted_utc = ? WHERE id = ?", (at, row["id"]))
            Store.log_event(db, at, "segment.deleted.retention", row["id"],
                            {"rel_path": row["rel_path"], "sha256": row["sha256"], "days": settings.retention_days})
            audit.append(db, Actor.system(), "segment.deleted", "segment", row["id"], None,
                         {"relPath": row["rel_path"], "sha256": row["sha256"], "rule": "retention",
                          "days": settings.retention_days})
        scanner.sync(row["id"], scanner.write_sidecar(row["id"]))
        log.info(json.dumps({"event": "segment.deleted.retention", "rel_path": row["rel_path"]}))
        deleted.append({"id": row["id"], "relPath": row["rel_path"], "endUtc": row["end_utc"]})
    return deleted
