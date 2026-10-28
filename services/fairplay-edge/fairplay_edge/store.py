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

SCHEMA_VERSION = 3

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

# Version 3 (Phase 3): reviews, evidence, clip jobs, the audit chain and the sync outbox.
# One script in one transaction, so a failure leaves version 2 exactly as it was. The only
# change to an existing table is `incidents`, rebuilt because SQLite cannot widen a CHECK:
# every row is copied, its state is unchanged ('flagged' is still valid), and the row count
# is compared before the old table goes.
_MIGRATE_V3 = """
BEGIN IMMEDIATE;

CREATE TABLE incidents_v3 (
    id                TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL REFERENCES match_sessions(id),
    match_id          TEXT,
    event_utc         TEXT NOT NULL,
    basis             TEXT NOT NULL CHECK (basis IN ('operator_now','period_mark','manual','sheet_event','match_clock')),
    pre_roll_ms       INTEGER NOT NULL,
    post_roll_ms      INTEGER NOT NULL,
    category          TEXT NOT NULL,
    note              TEXT,
    period            TEXT,
    match_minute      INTEGER,
    match_second      INTEGER,
    sheet_event_id    TEXT,
    player_ref        TEXT,
    observed_windows  TEXT,
    state             TEXT NOT NULL CHECK (state IN ('flagged','reviewing','reviewed','archived')),
    version           INTEGER NOT NULL,
    hold_id           TEXT,
    current_review_id TEXT,
    reopened_count    INTEGER NOT NULL DEFAULT 0,
    created_by        TEXT NOT NULL,
    created_utc       TEXT NOT NULL,
    updated_utc       TEXT NOT NULL
);
INSERT INTO incidents_v3 (id, session_id, match_id, event_utc, basis, pre_roll_ms, post_roll_ms, category, note,
                          period, match_minute, match_second, sheet_event_id, state, version, hold_id, created_by,
                          created_utc, updated_utc)
    SELECT i.id, i.session_id, s.match_ref, i.event_utc, i.basis, i.pre_roll_ms, i.post_roll_ms, i.category, i.note,
           i.period, i.match_minute, i.match_second, i.sheet_event_id, i.state, i.version, i.hold_id, i.created_by,
           i.created_utc, i.updated_utc
    FROM incidents i LEFT JOIN match_sessions s ON s.id = i.session_id;
-- RAISE() is for triggers only; a failing CHECK aborts the script just as well.
CREATE TEMP TABLE migration_check (copied_all INTEGER NOT NULL CHECK (copied_all = 1));
INSERT INTO migration_check SELECT (SELECT COUNT(*) FROM incidents) = (SELECT COUNT(*) FROM incidents_v3);
DROP TABLE migration_check;
DROP TABLE incidents;
ALTER TABLE incidents_v3 RENAME TO incidents;
CREATE INDEX incidents_session ON incidents (session_id, event_utc);

-- This Edge's identity: the audit chain and the outbox are per device.
CREATE TABLE edge_identity (
    device_id    TEXT PRIMARY KEY,
    created_utc  TEXT NOT NULL
);

-- A review is a finding by one assessor on one version of an incident. Completed reviews are
-- never edited: reopening supersedes one and starts the next.
CREATE TABLE reviews (
    id                TEXT PRIMARY KEY,
    incident_id       TEXT NOT NULL REFERENCES incidents(id),
    incident_version  INTEGER NOT NULL,
    reviewer_id       TEXT NOT NULL,
    reviewer_name     TEXT NOT NULL,
    state             TEXT NOT NULL CHECK (state IN ('open','completed','superseded')),
    -- V1 is shadow review only (ADR-0001): no other value can be stored.
    authority_mode    TEXT NOT NULL DEFAULT 'shadow' CHECK (authority_mode = 'shadow'),
    on_field_decision TEXT,
    result            TEXT CHECK (result IS NULL OR result IN
                          ('supports_original','supports_alternative','inconclusive','footage_unavailable')),
    factual_notes     TEXT,
    evidence_ids      TEXT,
    footage_states    TEXT,
    version           INTEGER NOT NULL,
    started_utc       TEXT NOT NULL,
    completed_at      TEXT,
    superseded_by     TEXT,
    superseded_reason TEXT
);
CREATE INDEX reviews_incident ON reviews (incident_id, started_utc);
CREATE UNIQUE INDEX reviews_one_open ON reviews (incident_id) WHERE state = 'open';

-- Clip jobs. One live job per incident, source and window; a second request for the same
-- thing gets the first job back.
CREATE TABLE jobs (
    id                 TEXT PRIMARY KEY,
    kind               TEXT NOT NULL CHECK (kind IN ('evidence_clip')),
    incident_id        TEXT NOT NULL REFERENCES incidents(id),
    incident_version   INTEGER NOT NULL,
    source             TEXT NOT NULL,
    window_start_utc   TEXT NOT NULL,
    window_duration_ms INTEGER NOT NULL,
    dedupe_key         TEXT NOT NULL,
    state              TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed')),
    attempts           INTEGER NOT NULL DEFAULT 0,
    max_attempts       INTEGER NOT NULL,
    next_attempt_utc   TEXT,
    error_code         TEXT,
    error              TEXT,
    evidence_id        TEXT,
    requested_by       TEXT NOT NULL,
    requested_name     TEXT NOT NULL,
    created_utc        TEXT NOT NULL,
    started_utc        TEXT,
    finished_utc       TEXT
);
CREATE UNIQUE INDEX jobs_one_live ON jobs (dedupe_key) WHERE state IN ('queued','running','succeeded');
CREATE INDEX jobs_due ON jobs (state, next_attempt_utc);

-- An evidence row exists only once its file does: a failed or empty cut leaves a failed job
-- and nothing here.
CREATE TABLE evidence (
    id                  TEXT PRIMARY KEY,
    incident_id         TEXT NOT NULL REFERENCES incidents(id),
    incident_version    INTEGER NOT NULL,
    session_id          TEXT NOT NULL REFERENCES match_sessions(id),
    source              TEXT NOT NULL,
    job_id              TEXT NOT NULL REFERENCES jobs(id),
    state               TEXT NOT NULL CHECK (state IN ('ready','approved')),
    derivation          TEXT NOT NULL CHECK (derivation IN ('copy')),
    footage_kind        TEXT NOT NULL CHECK (footage_kind IN ('synthetic','real')),
    window_start_utc    TEXT NOT NULL,
    window_duration_ms  INTEGER NOT NULL,
    coverage            TEXT NOT NULL CHECK (coverage IN ('full','partial')),
    covered_ms          INTEGER NOT NULL,
    duration_ms         INTEGER,
    rel_path            TEXT NOT NULL UNIQUE,
    bytes               INTEGER NOT NULL,
    sha256              TEXT NOT NULL,
    manifest_rel_path   TEXT NOT NULL UNIQUE,
    manifest_sha256     TEXT NOT NULL,
    source_segment_ids  TEXT NOT NULL,
    approved_by         TEXT,
    approved_name       TEXT,
    approved_utc        TEXT,
    created_by          TEXT NOT NULL,
    created_utc         TEXT NOT NULL
);
CREATE INDEX evidence_incident ON evidence (incident_id);

-- Footage rights per match session, appended and superseded, never edited. No row means
-- "real footage, rights not recorded": nothing leaves the Edge.
CREATE TABLE session_rights (
    id                TEXT PRIMARY KEY,
    session_id        TEXT NOT NULL REFERENCES match_sessions(id),
    footage_kind      TEXT NOT NULL CHECK (footage_kind IN ('synthetic','real')),
    status            TEXT NOT NULL CHECK (status IN ('not_recorded','internal_review_only','external_release_permitted')),
    minors_present    TEXT NOT NULL CHECK (minors_present IN ('yes','no','unknown')),
    basis             TEXT,
    consent_reference TEXT,
    recorded_by       TEXT NOT NULL,
    recorded_name     TEXT NOT NULL,
    created_utc       TEXT NOT NULL,
    supersedes        TEXT
);
CREATE INDEX session_rights_current ON session_rights (session_id, created_utc);

-- Append-only, hash-chained per device. The triggers refuse UPDATE and DELETE outright, so
-- no code path, this one included, can rewrite history without dropping the trigger first.
CREATE TABLE audit_log (
    seq             INTEGER PRIMARY KEY,
    at_utc          TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    actor_id        TEXT NOT NULL,
    actor_name      TEXT NOT NULL,
    actor_kind      TEXT NOT NULL,
    action          TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT,
    entity_version  INTEGER,
    detail          TEXT NOT NULL,
    prev_hash       TEXT NOT NULL,
    entry_hash      TEXT NOT NULL UNIQUE
);
CREATE INDEX audit_entity ON audit_log (entity_type, entity_id, seq);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- The transactional outbox: written in the same transaction as the change it describes.
CREATE TABLE outbox (
    seq               INTEGER PRIMARY KEY AUTOINCREMENT,
    idempotency_key   TEXT NOT NULL UNIQUE,
    entity_type       TEXT NOT NULL,
    entity_id         TEXT NOT NULL,
    entity_version    INTEGER NOT NULL,
    rank              INTEGER NOT NULL,
    payload           TEXT NOT NULL,
    payload_hash      TEXT NOT NULL,
    state             TEXT NOT NULL CHECK (state IN ('pending','sent','parked')),
    attempts          INTEGER NOT NULL DEFAULT 0,
    next_attempt_utc  TEXT NOT NULL,
    last_error        TEXT,
    result            TEXT,
    created_utc       TEXT NOT NULL,
    sent_utc          TEXT
);
CREATE INDEX outbox_due ON outbox (state, rank, seq);

-- Idempotency-Key on the console's create requests: a double click or a retried request
-- returns the first answer instead of making a second record.
CREATE TABLE request_keys (
    key          TEXT PRIMARY KEY,
    actor_id     TEXT NOT NULL,
    route        TEXT NOT NULL,
    body_hash    TEXT NOT NULL,
    status       INTEGER NOT NULL,
    response     TEXT NOT NULL,
    created_utc  TEXT NOT NULL
);

UPDATE schema_version SET version = 3;
COMMIT;
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
            # A new file has just been given the version 2 tables; it migrates like any other.
            start = row["version"] if row is not None else 2
            if row is None:
                db.execute("INSERT INTO schema_version (version) VALUES (2)")
            elif start < 2:
                db.execute("UPDATE schema_version SET version = 2")
        if start < 3:
            db = self._connect()
            try:
                db.executescript(_MIGRATE_V3)
            except sqlite3.Error:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise
            finally:
                db.close()
        if start < SCHEMA_VERSION:
            with self.tx() as db:
                self.log_event(db, _now(), "store.migrated", None, {"from": start, "to": SCHEMA_VERSION})
        with self.tx() as db:
            if db.execute("SELECT 1 FROM edge_identity").fetchone() is None:
                db.execute("INSERT INTO edge_identity (device_id, created_utc) VALUES (?, ?)", (new_id(), _now()))
            self.device_id = db.execute("SELECT device_id FROM edge_identity").fetchone()["device_id"]

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
