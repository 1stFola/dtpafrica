"""A stand-in for the cloud's `POST /api/v1/fairplay/sync/batch`. TEST DOUBLE ONLY: it holds
receipts in memory and is not, and must not become, the production receiver.

It implements the contract the real one must (docs/fairplay/integration-map.md §5), and is
strict about order: an item whose parent has not arrived is rejected, so a test fails if
the outbox ever sends a review before its incident.
"""

from __future__ import annotations

import hashlib
import json

PARENT = {"rights": ("session", "session_id"), "period": ("session", "session_id"),
          "calibration": ("session", "session_id"), "incident": ("session", "session_id"),
          "review": ("incident", "incident_id"), "job": ("incident", "incident_id"),
          "evidence": ("incident", "incident_id")}


def _hash(payload) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                                     default=str).encode()).hexdigest()


class SyncSink:
    def __init__(self):
        self.receipts: dict[str, tuple[str, str]] = {}
        self.versions: dict[tuple[str, str], int] = {}
        self.audit_heads: dict[str, str] = {}
        self.chain_breaks: list[str] = []
        self.applied: list[str] = []
        self.calls = 0

    def receive(self, device_id: str, items: list[dict]) -> list[dict]:
        self.calls += 1
        out = []
        for item in items:
            key, digest = item["idempotencyKey"], item["payloadHash"]
            if _hash(item["payload"]) != digest:
                out.append({"idempotencyKey": key, "status": "rejected", "message": "payload hash does not match"})
                continue
            if key in self.receipts:
                stored, _ = self.receipts[key]
                status = "replayed" if stored == digest else "conflict"
                out.append({"idempotencyKey": key, "status": status})
                continue
            kind, entity, version = item["entityType"], item["entityId"], item["version"]
            parent = PARENT.get(kind)
            if parent and (parent[0], item["payload"][parent[1]]) not in self.versions:
                out.append({"idempotencyKey": key, "status": "rejected", "message": f"{parent[0]} not received yet"})
                continue
            if kind == "audit":
                prev = self.audit_heads.get(device_id, "0" * 64)
                if item["payload"]["prev_hash"] != prev:
                    self.chain_breaks.append(key)  # accepted and flagged, as the contract says
                self.audit_heads[device_id] = item["payload"]["entry_hash"]
            if self.versions.get((kind, entity), 0) >= version:
                status = "stale"
            else:
                self.versions[(kind, entity)] = version
                status = "applied"
                self.applied.append(key)
            self.receipts[key] = (digest, status)
            out.append({"idempotencyKey": key, "status": status})
        return out


class SinkTransport:
    """The outbox's transport, delivering straight to a sink; `down` simulates the WAN cut."""

    def __init__(self, sink: SyncSink):
        self.sink = sink
        self.down = False
        self.batches: list[list[str]] = []

    def send(self, device_id: str, items: list[dict]) -> list[dict]:
        from fairplay_edge.outbox import OutboxError

        if self.down:
            raise OutboxError("network unreachable")
        self.batches.append([i["idempotencyKey"] for i in items])
        return self.sink.receive(device_id, items)
