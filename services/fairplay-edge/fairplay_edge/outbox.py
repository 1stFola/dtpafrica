"""The sync outbox: every record the cloud should hold, queued in the same transaction that
made it, and sent when there is a WAN to send it over.

Contract (docs/fairplay/integration-map.md §5):
  - the idempotency key is `{entityType}:{entityId}:{version}` and never changes;
  - items go in dependency order, lowest rank first, then the order they were queued:
        session → rights → segment → period/calibration → incident → review → job/evidence → audit
    so a review never reaches the cloud before its incident;
  - the receiver answers each item `applied`, `replayed` (same key, same payload hash: the
    stored result), `stale` (an older version than it holds) or `conflict` (same key,
    different payload). A conflict is parked for a person and raises a critical alert; it
    is never resent or overwritten;
  - a failed send backs off exponentially, 2 s doubling to a 5-minute cap, with jitter, and
    never gives up. With no destination configured, nothing is sent and the queue grows.

The cloud receiver (`POST /api/v1/fairplay/sync/batch`) is not built yet. Until it is, the
only receiver is `fixtures/sync_sink.py`, which is a test double and says so.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

import httpx

from .naming import iso, parse_iso, utcnow
from .store import Store

log = logging.getLogger("fairplay.outbox")

RANKS = {"session": 0, "rights": 1, "segment": 2, "period": 3, "calibration": 3, "incident": 4, "review": 5,
         "job": 6, "evidence": 6, "audit": 7, "withdrawal": 7}
BATCH = 50
BASE_DELAY_S = 2.0
MAX_DELAY_S = 300.0
OUTCOMES = ("applied", "replayed", "stale", "conflict", "rejected")


class OutboxError(RuntimeError):
    pass


def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode()


def payload_hash(payload: dict) -> str:
    return hashlib.sha256(canonical(payload)).hexdigest()


def enqueue(db: sqlite3.Connection, entity_type: str, entity_id: str, version: int | None, payload: dict) -> str:
    """Queue inside the caller's transaction. `version` None = the next version of an entity
    that keeps none of its own (sessions, segments, rights)."""
    if entity_type not in RANKS:
        raise ValueError(f"unknown entity type {entity_type!r}")
    if version is None:
        row = db.execute("SELECT MAX(entity_version) AS v FROM outbox WHERE entity_type = ? AND entity_id = ?",
                         (entity_type, entity_id)).fetchone()
        version = (row["v"] or 0) + 1
    key = f"{entity_type}:{entity_id}:{version}"
    body = canonical(payload).decode()
    digest = hashlib.sha256(body.encode()).hexdigest()
    existing = db.execute("SELECT payload_hash FROM outbox WHERE idempotency_key = ?", (key,)).fetchone()
    if existing:
        if existing["payload_hash"] != digest:
            # The same version with different content is a bug here, not a sync problem.
            raise OutboxError(f"{key} was already queued with different content")
        return key
    now = iso(utcnow())
    db.execute(
        "INSERT INTO outbox (idempotency_key, entity_type, entity_id, entity_version, rank, payload, payload_hash,"
        " state, next_attempt_utc, created_utc) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
        (key, entity_type, entity_id, version, RANKS[entity_type], body, digest, now, now))
    return key


# ── transports ────────────────────────────────────────────────────────────

class Transport(Protocol):
    def send(self, device_id: str, items: list[dict]) -> list[dict]:
        """Deliver a batch; return one result per item. Raise on any transport failure."""


class NoDestination:
    """No cloud configured. Sending is not attempted, so nothing is ever marked sent."""

    def send(self, device_id: str, items: list[dict]) -> list[dict]:
        raise OutboxError("no sync destination is configured (FAIRPLAY_CLOUD_SYNC_URL)")


class HttpTransport:
    def __init__(self, base_url: str, device_token: str, client: httpx.Client | None = None, timeout: float = 15.0):
        self.url = base_url.rstrip("/") + "/api/v1/fairplay/sync/batch"
        self.token = device_token
        self.client = client or httpx.Client(timeout=timeout)

    def send(self, device_id: str, items: list[dict]) -> list[dict]:
        response = self.client.post(self.url, json={"deviceId": device_id, "items": items},
                                    headers={"x-fairplay-device-token": self.token})
        if response.status_code != 200:
            raise OutboxError(f"sync endpoint returned {response.status_code}")
        results = response.json().get("results")
        if not isinstance(results, list):
            raise OutboxError("sync endpoint returned no results list")
        return results


# ── the sender ────────────────────────────────────────────────────────────

def backoff(attempts: int, rng: random.Random | None = None) -> float:
    """Seconds to wait after `attempts` consecutive failures: 2, 4, 8 … capped at 300, ±20%."""
    delay = min(MAX_DELAY_S, BASE_DELAY_S * (2 ** max(0, attempts - 1)))
    return delay * (0.8 + 0.4 * (rng or random).random())


@dataclass
class SendReport:
    attempted: int = 0
    sent: int = 0
    parked: int = 0
    error: str | None = None


class Outbox:
    def __init__(self, store: Store, transport: Transport, rng: random.Random | None = None):
        self.store = store
        self.transport = transport
        self.rng = rng or random.Random()
        self.last_success_utc: str | None = None
        self.last_error: str | None = None

    def due(self, now: datetime, limit: int = BATCH) -> list[dict]:
        return self.store.query(
            "SELECT * FROM outbox WHERE state = 'pending' AND next_attempt_utc <= ? ORDER BY rank, seq LIMIT ?",
            (iso(now), limit))

    def run_once(self, now: datetime | None = None) -> SendReport:
        now = now or utcnow()
        rows = self.due(now)
        report = SendReport(attempted=len(rows))
        if not rows:
            return report
        # While anything is backing off, nothing of its rank or above goes ahead of it: a later
        # version must not overtake an earlier one, nor a review its incident.
        floor = self.store.one("SELECT MIN(rank) AS r FROM outbox WHERE state = 'pending' AND next_attempt_utc > ?",
                               (iso(now),))["r"]
        if floor is not None:
            rows = [r for r in rows if r["rank"] < floor]
            report.attempted = len(rows)
            if not rows:
                return report
        items = [{"idempotencyKey": r["idempotency_key"], "entityType": r["entity_type"], "entityId": r["entity_id"],
                  "version": r["entity_version"], "payloadHash": r["payload_hash"], "payload": json.loads(r["payload"])}
                 for r in rows]
        try:
            results = self.transport.send(self.store.device_id, items)
        except (OutboxError, httpx.HTTPError, ValueError) as exc:
            self._failed(rows, f"{exc.__class__.__name__}: {exc}", now)
            report.error = self.last_error
            return report
        by_key = {r.get("idempotencyKey"): r for r in results if isinstance(r, dict)}
        at = iso(utcnow())
        retry = []
        from . import audit

        with self.store.tx() as db:
            for row in rows:
                result = by_key.get(row["idempotency_key"])
                status = result.get("status") if result else None
                if status in ("applied", "replayed", "stale"):
                    db.execute("UPDATE outbox SET state = 'sent', sent_utc = ?, result = ?, last_error = NULL"
                               " WHERE seq = ?", (at, status, row["seq"]))
                    report.sent += 1
                elif status in ("conflict", "rejected"):
                    db.execute("UPDATE outbox SET state = 'parked', result = ?, last_error = ? WHERE seq = ?",
                               (status, (result.get("message") or status)[:500], row["seq"]))
                    report.parked += 1
                    if row["entity_type"] != "audit":
                        audit.append(db, audit.Actor.system(), "outbox.parked", row["entity_type"], row["entity_id"],
                                     row["entity_version"], {"key": row["idempotency_key"], "result": status,
                                                             "message": result.get("message")})
                else:
                    retry.append(row)
        if report.parked:
            self.store.open_alert("outbox_parked", None, "critical", at,
                                  {"parked": self.store.one("SELECT COUNT(*) AS n FROM outbox WHERE state = 'parked'")["n"]})
        if retry:
            self._failed(retry, "no result returned for the item", now)
        if report.sent:
            self.last_success_utc = at
            self.last_error = None if not retry else self.last_error
            self.store.resolve_alert("outbox_stalled", None, at)
        return report

    def _failed(self, rows: list[dict], error: str, now: datetime) -> None:
        self.last_error = error
        # One delay for the whole batch, so its items stay together and in order.
        wait = backoff(max(r["attempts"] for r in rows) + 1, self.rng)
        with self.store.tx() as db:
            for row in rows:
                attempts = row["attempts"] + 1
                db.execute("UPDATE outbox SET attempts = ?, next_attempt_utc = ?, last_error = ? WHERE seq = ?",
                           (attempts, iso(now + timedelta(seconds=wait)), error[:500], row["seq"]))
        oldest = self.store.one("SELECT MIN(created_utc) AS t FROM outbox WHERE state = 'pending'")["t"]
        if oldest and now - parse_iso(oldest) > timedelta(minutes=30):
            self.store.open_alert("outbox_stalled", None, "warning", iso(now), {"oldestPendingUtc": oldest,
                                                                                 "error": error[:200]})

    def status(self, configured: bool) -> dict:
        counts = {r["state"]: r["n"] for r in self.store.query("SELECT state, COUNT(*) AS n FROM outbox GROUP BY state")}
        oldest = self.store.one("SELECT MIN(created_utc) AS t, MAX(attempts) AS a FROM outbox WHERE state = 'pending'")
        return {
            "configured": configured,
            "pending": counts.get("pending", 0),
            "sent": counts.get("sent", 0),
            "parked": counts.get("parked", 0),
            "oldestPendingUtc": oldest["t"],
            "maxAttempts": oldest["a"],
            "lastSuccessUtc": self.last_success_utc,
            "lastError": self.last_error,
            "note": None if configured else "no cloud receiver configured: records are kept here and nothing leaves",
        }
