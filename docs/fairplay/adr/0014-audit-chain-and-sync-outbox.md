# ADR-0014 — An append-only, hash-chained audit log and a transactional outbox on the Edge

**Status**: proposed (Phase 3) · **Decides**: how actions are recorded, and how records reach the cloud

## Context

A finding may be questioned weeks later. The Edge must be able to say who flagged, edited,
reviewed, reopened, approved, exported or watched what, and when. It must also be able to
show the record has not been rewritten since. The venue often has no internet, so records
must wait on the Edge and reach the cloud later without being lost or applied twice.

## Decision

**Audit log** (`audit_log`, `fairplay_edge/audit.py`):
- Entries are appended in the same SQLite transaction as the change they describe, so
  neither can commit without the other. Reads are audited too: evidence views, once per
  person and clip per hour; replay windows, once per person, source and window per hour;
  and every export, each time.
- SQLite triggers refuse `UPDATE` and `DELETE` on the table, so no code path can rewrite
  history, not even a buggy one.
- Each entry carries `prev_hash` and `entry_hash = SHA-256(canonical JSON of the entry
  including prev_hash)`, per device, from a genesis of 64 zeros. `GET /edge/v1/audit/verify`
  walks the chain and reports the first break. It never repairs one.
- **What the chain does not do.** Anyone who can write the SQLite file can drop the
  triggers and rebuild a consistent chain. The chain makes tampering detectable once
  entries have left the device: every entry is synced, and the cloud checks each against
  the last it holds. An edit made inside the file without a rebuild is caught locally. It
  does not replace keeping the Edge machine under DTP's physical control.

**Outbox** (`outbox`, `fairplay_edge/outbox.py`):
- Each change queues its record in the same transaction, with the idempotency key
  `{entityType}:{entityId}:{version}`. Queuing the same key with different content is
  refused as a bug.
- Records go in dependency order: session → rights → segment → period/calibration →
  incident → review → job/evidence → audit. While a batch backs off, nothing of its rank or
  above goes ahead of it, so a later version never overtakes an earlier one, and a review
  never arrives before its incident.
- The receiver answers each item `applied`, `replayed` (same key, same payload hash),
  `stale` (older than what it holds) or `conflict` (same key, different payload). A
  conflict or a rejection is parked for a person, raises a critical alert and an audit
  entry, and is never resent.
- A failed send backs off 2 s, 4 s, 8 s … to a 5-minute cap, with ±20 % jitter, one delay
  per batch. It never gives up. The queue is in SQLite, so a restart loses nothing.
- **No destination is configured yet.** The cloud receiver (`POST
  /api/v1/fairplay/sync/batch`) is not built. With `FAIRPLAY_CLOUD_SYNC_URL` empty, nothing
  is sent and the console shows the queue as *local only*. The contract is tested against
  `tests/sync_sink.py`, a test double that rejects out-of-order items.

**Idempotent creates.** The console sends an `Idempotency-Key` with each incident it
creates. A repeated or retried request returns the first answer, `Idempotent-Replayed:
true`. The same key with a different body is a 409.

## Consequences

Every incident has a trail that can be printed and checked, and records survive any length
of WAN outage. Payloads are metadata only: video never goes through the outbox. The audit
log grows with every replay viewed, so the once-an-hour rule keeps it readable. The cloud
side (receipts, chain check, trigger on its own audit table) is still to be built.

## Alternatives considered

- **Reuse the operational `events` table.** It has no actor, no chain and no guarantee
  against edits. It stays as the operational log.
- **A message broker.** One writer on one machine; SQLite in WAL mode already gives
  durability and ordering (architecture.md, "not used").
- **Sign each audit entry with a device key.** That would make entries attributable to the
  device, not tamper-proof against someone holding that device. Revisit when devices are
  paired with the cloud (ADR-0005).
