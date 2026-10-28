"""Phase 3: the sync outbox. Order, idempotency, conflicts, backoff, a WAN cut and a restart."""

import json
import random
from datetime import timedelta

import httpx
import pytest

from fairplay_edge import incidents, outbox, timing
from fairplay_edge.audit import Actor
from fairplay_edge.naming import utcnow
from fairplay_edge.outbox import HttpTransport, Outbox, backoff
from fairplay_edge.store import Store

from .conftest import at
from .sync_sink import SinkTransport, SyncSink

OP = Actor("u-op", "Operator", "operator")
LATER = timedelta(hours=1)


@pytest.fixture
def busy(store, settings):
    """A session with a calibration, an incident, its review, and their audit entries."""
    session = timing.create_session(store, "Lions v Eagles", None, "shadow", "u-op")
    timing.calibrate(store, settings, session["id"], "drone", at(0), at(0.4), 80, "marker", "u-op")
    inc = incidents.create(store, settings, session["id"], OP, event_utc=at(600), basis="manual")
    inc = incidents.start_review(store, inc["id"], 1, OP)
    return session, inc


def drain(box: Outbox, now=None, rounds: int = 20) -> None:
    for _ in range(rounds):
        if not box.run_once(now or utcnow()).attempted:
            return


def test_dependency_order_holds_even_when_queued_out_of_order(store, settings, busy):
    sink = SyncSink()
    transport = SinkTransport(sink)
    # A rights record for the session is queued after the incident, but is sent before it.
    incidents.record_rights(store, busy[0]["id"], OP, footage_kind="synthetic", status="not_recorded",
                            minors_present="no", basis=None, consent_reference=None)
    drain(Outbox(store, transport))
    order = [k.split(":")[0] for batch in transport.batches for k in batch]
    ranks = [outbox.RANKS[k] for k in order]
    assert ranks == sorted(ranks)
    assert all(r[1] in ("applied", "stale") for r in sink.receipts.values())  # nothing rejected as an orphan
    assert store.one("SELECT COUNT(*) AS n FROM outbox WHERE state != 'sent'")["n"] == 0


def test_duplicate_submission_is_applied_once(store, busy):
    """The same batch delivered ten times: one effect, nine replays, no conflicts."""
    sink = SyncSink()
    items = [{"idempotencyKey": r["idempotency_key"], "entityType": r["entity_type"], "entityId": r["entity_id"],
              "version": r["entity_version"], "payloadHash": r["payload_hash"], "payload": json.loads(r["payload"])}
             for r in store.query("SELECT * FROM outbox ORDER BY rank, seq")]
    results = [sink.receive(store.device_id, items) for _ in range(10)]
    assert {r["status"] for r in results[0]} == {"applied"}
    assert all({r["status"] for r in later} == {"replayed"} for later in results[1:])
    assert len(sink.applied) == len(items)


def test_resending_after_a_lost_reply_is_harmless(store, busy):
    """The cloud applied a batch but the reply was lost: the retry is answered `replayed`."""
    sink = SyncSink()

    class LostReply(SinkTransport):
        lost = True

        def send(self, device_id, items):
            results = super().send(device_id, items)
            if self.lost:
                self.lost = False
                raise outbox.OutboxError("connection reset after the request was sent")
            return results

    box = Outbox(store, LostReply(sink))
    box.run_once()
    assert store.one("SELECT COUNT(*) AS n FROM outbox WHERE state = 'sent'")["n"] == 0
    drain(box, utcnow() + LATER)
    assert store.one("SELECT COUNT(*) AS n FROM outbox WHERE state != 'sent'")["n"] == 0
    assert {r["result"] for r in store.query("SELECT result FROM outbox")} == {"replayed"}
    assert len(sink.applied) == store.one("SELECT COUNT(*) AS n FROM outbox")["n"]


def test_same_key_different_content_is_parked_not_overwritten(store, busy):
    sink = SyncSink()
    first = store.one("SELECT * FROM outbox WHERE entity_type = 'incident' ORDER BY seq LIMIT 1")
    sink.receipts[first["idempotency_key"]] = ("someone-else's-hash", "applied")
    sink.versions[("session", busy[0]["id"])] = 1
    drain(Outbox(store, SinkTransport(sink)))
    parked = store.one("SELECT * FROM outbox WHERE idempotency_key = ?", (first["idempotency_key"],))
    assert parked["state"] == "parked" and parked["result"] == "conflict"
    assert store.one("SELECT 1 FROM alerts WHERE kind = 'outbox_parked' AND resolved_utc IS NULL")
    assert store.one("SELECT 1 FROM audit_log WHERE action = 'outbox.parked'")


def test_enqueue_refuses_changed_content_for_the_same_version(store):
    with store.tx() as db:
        outbox.enqueue(db, "session", "s1", 1, {"label": "a"})
    with pytest.raises(outbox.OutboxError, match="different content"):
        with store.tx() as db:
            outbox.enqueue(db, "session", "s1", 1, {"label": "b"})


def test_backoff_doubles_to_a_cap():
    rng = random.Random(1)
    delays = [backoff(n, rng) for n in range(1, 12)]
    assert 1.6 <= delays[0] <= 2.4 and 3.2 <= delays[1] <= 4.8
    assert all(d <= 300 * 1.2 for d in delays) and delays[-1] >= 300 * 0.8


def test_wan_cut_keeps_everything_and_catches_up(tmp_path, store, settings, busy):
    sink = SyncSink()
    transport = SinkTransport(sink)
    transport.down = True
    box = Outbox(store, transport, random.Random(7))
    now = utcnow()
    for minute in range(30):  # half an hour with no route out, trying whenever due
        box.run_once(now + timedelta(minutes=minute))
    pending = store.one("SELECT COUNT(*) AS n, MAX(attempts) AS a FROM outbox WHERE state = 'pending'")
    total = store.one("SELECT COUNT(*) AS n FROM outbox")["n"]
    assert pending["n"] == total and pending["a"] >= 5  # nothing lost, nothing given up
    assert box.status(True)["lastError"].startswith("OutboxError: network unreachable")
    # The Edge restarts during the outage: the queue is in SQLite, not in memory.
    box = Outbox(Store(settings.db_path), transport, random.Random(7))
    transport.down = False
    drain(box, now + timedelta(hours=2))
    assert store.one("SELECT COUNT(*) AS n FROM outbox WHERE state = 'sent'")["n"] == total
    assert sink.chain_breaks == []


def test_a_backing_off_parent_holds_back_its_children(store, settings, busy):
    sink = SyncSink()
    transport = SinkTransport(sink)
    transport.down = True
    box = Outbox(store, transport)
    box.run_once()
    transport.down = False
    # New work arrives while the first batch waits out its backoff: it must not overtake it.
    incidents.edit(store, settings, busy[1]["id"], busy[1]["version"], OP, {"note": "added later"})
    assert box.run_once().attempted == 0
    drain(box, utcnow() + LATER)
    assert all(r[1] != "rejected" for r in sink.receipts.values())


def test_http_transport_contract(store, busy):
    sink = SyncSink()
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"], seen["token"] = str(request.url), request.headers["x-fairplay-device-token"]
        body = json.loads(request.content)
        return httpx.Response(200, json={"results": sink.receive(body["deviceId"], body["items"])})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    box = Outbox(store, HttpTransport("https://dtp.example/", "device-token-abc", client))
    drain(box)
    assert seen["url"] == "https://dtp.example/api/v1/fairplay/sync/batch" and seen["token"] == "device-token-abc"
    assert store.one("SELECT COUNT(*) AS n FROM outbox WHERE state != 'sent'")["n"] == 0

    def broken(request):
        return httpx.Response(503)

    with store.tx() as db:
        outbox.enqueue(db, "session", "s-late", 1, {"label": "late"})
    box = Outbox(store, HttpTransport("https://dtp.example", "t", httpx.Client(transport=httpx.MockTransport(broken))))
    report = box.run_once()
    assert report.error and "503" in report.error


def test_status_without_a_destination_says_nothing_leaves(store, busy):
    status = Outbox(store, outbox.NoDestination()).status(False)
    assert status["configured"] is False and status["pending"] > 0 and "nothing leaves" in status["note"]
