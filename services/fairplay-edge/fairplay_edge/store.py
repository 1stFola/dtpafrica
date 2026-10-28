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

SCHEMA_VERSION = 2

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

# Version 2 (Phase 2): operators, match sessions and the time model. Additive only, so a
# version 1 database (Phase 1 recordings and manifests) upgrades in place.
_SCHEMA_V2 = """
CREATE TABLE IF NOT EXISTS operator_sessions (
    id             TEXT PRIMARY KEY,           -- SHA-256 of the cookie token, never the token
    user_id        TEXT NOT NULL,
    email          TEXT NOT NULL,
    name           TEXT NOT NULL,
    permissions    TEXT NOT NULL,
    bundle_id      TEXT NOT NULL,
    bundle_dev     INTEGER NOT NULL,
    ip             TEXT,
    created_utc    TEXT NOT NULL,
    last_seen_utc  TEXT NOT NULL,
    expires_utc    TEXT NOT NULL,
    revoked_utc    TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
    email   TEXT NOT NULL,
    ip      TEXT,
    at_utc  TEXT NOT NULL,
    ok      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_email ON login_attempts (email, at_utc);

CREATE TABLE IF NOT EXISTS local_disabled (
    user_id  TEXT PRIMARY KEY,
    at_utc   TEXT NOT NULL,
    by_user  TEXT NOT NULL,
    reason   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_sessions (
    id           TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    match_ref    TEXT,
    mode         TEXT NOT NULL CHECK (mode IN ('shadow','post_match')),
    created_utc  TEXT NOT NULL,
    created_by   TEXT NOT NULL,
    ended_utc    TEXT
);

CREATE TABLE IF NOT EXISTS period_marks (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL REFERENCES match_sessions(id),
    period              TEXT NOT NULL CHECK (period IN ('1','2','3','4','penalties')),
    edge                TEXT NOT NULL CHECK (edge IN ('start','end')),
    edge_utc            TEXT NOT NULL,
    edge_mono_ns        INTEGER NOT NULL,
    console_anchor_utc  TEXT,
    console_delta_ms    INTEGER,
    actor_id            TEXT NOT NULL,
    supersedes          TEXT,
    created_utc         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calibrations (
    id                   TEXT PRIMARY KEY,
    session_id           TEXT NOT NULL REFERENCES match_sessions(id),
    source               TEXT NOT NULL,
    period               TEXT,
    reference_utc        TEXT NOT NULL,
    observed_ingest_utc  TEXT NOT NULL,
    offset_ms            INTEGER NOT NULL,
    uncertainty_ms       INTEGER NOT NULL CHECK (uncertainty_ms >= 0),
    method               TEXT NOT NULL CHECK (method IN ('whistle','ball_strike','clapper','marker','manual')),
    reference_source     TEXT,
    evidence_segment_id  TEXT,
    note                 TEXT,
    actor_id             TEXT NOT NULL,
    supersedes           TEXT,
    created_utc          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS calibrations_current ON calibrations (session_id, source, created_utc);

CREATE TABLE IF NOT EXISTS incidents (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES match_sessions(id),
    event_utc       TEXT NOT NULL,
    basis           TEXT NOT NULL CHECK (basis IN ('operator_now','period_mark','manual','sheet_event')),
    pre_roll_ms     INTEGER NOT NULL,
    post_roll_ms    INTEGER NOT NULL,
    category        TEXT NOT NULL,
    note            TEXT,
    period          TEXT,
    match_minute    INTEGER,
    match_second    INTEGER,
    sheet_event_id  TEXT,
    state           TEXT NOT NULL CHECK (state IN ('flagged')),
    version         INTEGER NOT NULL,
    hold_id         TEXT,
    created_by      TEXT NOT NULL,
    created_utc     TEXT NOT NULL,
    updated_utc     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clock_samples (
    seq              INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_utc         TEXT NOT NULL,
    edge_mono_ns     INTEGER NOT NULL,
    ntp_state        TEXT NOT NULL,
    cloud_offset_ms  INTEGER,
    cloud_rtt_ms     INTEGER,
    step_ms          INTEGER
);

-- Measured in the operator's browser: request sent to video playable.
CREATE TABLE IF NOT EXISTS replay_metrics (
    seq                  INTEGER PRIMARY KEY AUTOINCREMENT,
    at_utc               TEXT NOT NULL,
    user_id              TEXT,
    source               TEXT NOT NULL,
    window_start_utc     TEXT NOT NULL,
    duration_ms          INTEGER NOT NULL,
    to_first_frame_ms    INTEGER,
    to_playable_ms       INTEGER,
    bytes                INTEGER,
    outcome              TEXT NOT NULL,
    note                 TEXT
);
"""


def new_id() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        # executescript commits whatever is open first, so it runs outside tx().
        db = self._connect()
        try:
            row = None
            if db.execute("SELECT name FROM sqlite_master WHERE name = 'schema_version'").fetchone():
                row = db.execute("SELECT version FROM schema_version").fetchone()
            if row is not None and row["version"] > SCHEMA_VERSION:
                raise RuntimeError(f"database schema {row['version']} is newer than {SCHEMA_VERSION}; refusing to guess")
            db.executescript(_SCHEMA + _SCHEMA_V2)
        finally:
            db.close()
        with self.tx() as db:
            row = db.execute("SELECT version FROM schema_version").fetchone()
            if row is None:
                db.execute("INSERT INTO schema_version (version) VALUES (?)", (SCHEMA_VERSION,))
            elif row["version"] < SCHEMA_VERSION:
                db.execute("UPDATE schema_version SET version = ?", (SCHEMA_VERSION,))
                self.log_event(db, _now(), "store.migrated", None, {"from": row["version"], "to": SCHEMA_VERSION})

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
