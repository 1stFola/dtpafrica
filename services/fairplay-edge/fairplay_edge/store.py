"""The Edge's SQLite database: the segment manifest index, alerts, feed intervals, holds.

WAL mode with `synchronous=FULL`: a row the API reported as written survives a power cut.
Every write is a short transaction on its own connection, so the API's thread pool and the
background loops never share one. The manifest *sidecar* files (manifest.py) are the second
copy: if this file is lost, the manifests on disk still describe every segment.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

SCHEMA_VERSION = 1

SEGMENT_STATES = ("recording", "finalized", "partial", "corrupt", "missing", "deleted")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS segments (
    id               TEXT PRIMARY KEY,
    source           TEXT NOT NULL,
    rel_path         TEXT NOT NULL UNIQUE,
    start_utc        TEXT NOT NULL,
    end_utc          TEXT,
    duration_ms      INTEGER,
    bytes            INTEGER,
    complete_bytes   INTEGER,
    sha256           TEXT,
    state            TEXT NOT NULL CHECK (state IN ('recording','finalized','partial','corrupt','missing','deleted')),
    problems         TEXT,
    codec            TEXT,
    profile          TEXT,
    width            INTEGER,
    height           INTEGER,
    fps              TEXT,
    time_base        TEXT,
    start_pts        INTEGER,
    start_time_s     REAL,
    has_audio        INTEGER,
    probe_json       TEXT,
    discovered_utc   TEXT NOT NULL,
    last_size        INTEGER NOT NULL DEFAULT 0,
    last_growth_utc  TEXT,
    finalized_utc    TEXT,
    finalize_reason  TEXT,
    verified_utc     TEXT,
    deleted_utc      TEXT
);
CREATE INDEX IF NOT EXISTS segments_source_start ON segments (source, start_utc);
CREATE INDEX IF NOT EXISTS segments_state ON segments (state);

CREATE TABLE IF NOT EXISTS derivatives (
    id           TEXT PRIMARY KEY,
    segment_id   TEXT NOT NULL REFERENCES segments(id),
    kind         TEXT NOT NULL CHECK (kind IN ('repair')),
    rel_path     TEXT NOT NULL UNIQUE,
    bytes        INTEGER NOT NULL,
    sha256       TEXT NOT NULL,
    duration_ms  INTEGER,
    lost_bytes   INTEGER NOT NULL,
    created_utc  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    source        TEXT,
    severity      TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
    opened_utc    TEXT NOT NULL,
    resolved_utc  TEXT,
    detail        TEXT
);
CREATE INDEX IF NOT EXISTS alerts_open ON alerts (kind, source, resolved_utc);

CREATE TABLE IF NOT EXISTS feed_intervals (
    id             TEXT PRIMARY KEY,
    source         TEXT NOT NULL,
    down_from_utc  TEXT NOT NULL,
    down_to_utc    TEXT
);

CREATE TABLE IF NOT EXISTS source_state (
    source                    TEXT PRIMARY KEY,
    publishing                INTEGER NOT NULL,
    since_utc                 TEXT NOT NULL,
    last_seen_publishing_utc  TEXT,
    detail                    TEXT
);

CREATE TABLE IF NOT EXISTS holds (
    id              TEXT PRIMARY KEY,
    source          TEXT,
    from_utc        TEXT NOT NULL,
    to_utc          TEXT NOT NULL,
    reason          TEXT NOT NULL,
    ref             TEXT,
    created_utc     TEXT NOT NULL,
    released_utc    TEXT,
    release_reason  TEXT
);

-- Filled by Phase 3 (evidence); retention already refuses to touch anything referenced here
-- and not yet synced.
CREATE TABLE IF NOT EXISTS evidence_refs (
    id           TEXT PRIMARY KEY,
    segment_id   TEXT NOT NULL REFERENCES segments(id),
    synced       INTEGER NOT NULL DEFAULT 0,
    created_utc  TEXT NOT NULL
);

-- Append-only by code: verification, repair, retention, alerts.
CREATE TABLE IF NOT EXISTS events (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    at_utc      TEXT NOT NULL,
    kind        TEXT NOT NULL,
    segment_id  TEXT,
    detail      TEXT
);
"""


def new_id() -> str:
    return str(uuid.uuid4())


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        # executescript commits whatever is open first, so it runs outside tx().
        db = self._connect()
        try:
            db.executescript(_SCHEMA)
        finally:
            db.close()
        with self.tx() as db:
            row = db.execute("SELECT version FROM schema_version").fetchone()
            if row is None:
                db.execute("INSERT INTO schema_version (version) VALUES (?)", (SCHEMA_VERSION,))
            elif row["version"] != SCHEMA_VERSION:
                raise RuntimeError(f"database schema {row['version']} is not {SCHEMA_VERSION}; refusing to guess")

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        db.execute("PRAGMA foreign_keys=ON")
        return db

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        db = self._connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.execute("COMMIT")
        except BaseException:
            db.execute("ROLLBACK")
            raise
        finally:
            db.close()

    def query(self, sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
        db = self._connect()
        try:
            return [dict(r) for r in db.execute(sql, params).fetchall()]
        finally:
            db.close()

    def one(self, sql: str, params: tuple | dict = ()) -> dict[str, Any] | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    # ── events ────────────────────────────────────────────────────────────
    @staticmethod
    def log_event(db: sqlite3.Connection, at_utc: str, kind: str, segment_id: str | None, detail: dict) -> None:
        db.execute(
            "INSERT INTO events (at_utc, kind, segment_id, detail) VALUES (?, ?, ?, ?)",
            (at_utc, kind, segment_id, json.dumps(detail, sort_keys=True)),
        )

    # ── alerts ────────────────────────────────────────────────────────────
    def open_alert(self, kind: str, source: str | None, severity: str, at_utc: str, detail: dict) -> bool:
        """Open an alert unless the same kind is already open for this source. True if opened."""
        with self.tx() as db:
            existing = db.execute(
                "SELECT id FROM alerts WHERE kind = ? AND source IS ? AND resolved_utc IS NULL", (kind, source)
            ).fetchone()
            if existing:
                return False
            db.execute(
                "INSERT INTO alerts (id, kind, source, severity, opened_utc, detail) VALUES (?, ?, ?, ?, ?, ?)",
                (new_id(), kind, source, severity, at_utc, json.dumps(detail, sort_keys=True)),
            )
            self.log_event(db, at_utc, f"alert.opened.{kind}", None, {"source": source, **detail})
            return True

    def resolve_alert(self, kind: str, source: str | None, at_utc: str) -> bool:
        with self.tx() as db:
            cur = db.execute(
                "UPDATE alerts SET resolved_utc = ? WHERE kind = ? AND source IS ? AND resolved_utc IS NULL",
                (at_utc, kind, source),
            )
            if cur.rowcount:
                self.log_event(db, at_utc, f"alert.resolved.{kind}", None, {"source": source})
            return bool(cur.rowcount)
