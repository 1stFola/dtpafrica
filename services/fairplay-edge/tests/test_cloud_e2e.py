"""Phase 4 end to end: this Edge's code against the real cloud API and an S3 server. Skipped
unless services/api/scripts/fairplay-e2e-check.ts runs it, which starts the API on a scratch
database and the S3 server CI uses, provisions a device, a session and a member, then runs
this file in the Edge image and checks the cloud's side afterwards.

What is real: the API, Postgres, the S3 server (adobe/s3mock: it checks no signature, but
stores what is sent and reports its SHA-256), HTTP, the Edge's store, outbox, pairing,
bundle check, PIN check and uploader. What is not: the clip is made by the test cutter
from synthetic segment files. Nothing here is real footage.
"""

import json
import os
import subprocess
import sys
import time
from datetime import timedelta
from pathlib import Path

import httpx
import pytest

from fairplay_edge import cloud, evidence, incidents, outbox, timing
from fairplay_edge.audit import Actor
from fairplay_edge.auth import Sessions, load_trusted_keys, verify_bundle
from fairplay_edge.naming import utcnow

from .test_evidence import FakeCutter, finalise_all  # noqa: F401
from .conftest import at, fmp4, write_segment

E2E = os.environ.get("FAIRPLAY_E2E_TARGET")
pytestmark = pytest.mark.skipif(not E2E, reason="run by services/api/scripts/fairplay-e2e-check.ts")
API_PORT, S3_PORT = os.environ.get("FAIRPLAY_E2E_API_PORT", "3190"), os.environ.get("FAIRPLAY_E2E_S3_PORT", "9190")
OUT = Path(os.environ.get("FAIRPLAY_E2E_OUT", "/tmp"))


@pytest.fixture(scope="module")
def relays():
    """The API and the S3 server live on the host; reach them as loopback, as the Edge's URL rule wants."""
    procs = [subprocess.Popen([sys.executable, "-m", "fairplay_edge", "relay", "--listen", f"127.0.0.1:{p}", "--target", f"{E2E}:{p}"])
             for p in (API_PORT, S3_PORT)]
    time.sleep(1.0)
    yield
    for p in procs:
        p.terminate()


def test_the_edge_and_the_cloud_end_to_end(relays, tmp_path, settings, store, fake_probe):
    import dataclasses

    results: dict = {"checks": []}

    def check(label, ok, detail=None):
        results["checks"].append({"label": label, "ok": bool(ok), "detail": detail})
        print(("PASS  " if ok else "FAIL  ") + label + ("" if ok or detail is None else f"  {detail}"))

    base = f"http://127.0.0.1:{API_PORT}"
    keys, token_file, bundle_file = tmp_path / "trusted-keys.json", tmp_path / "device-token", tmp_path / "bundle.json"
    settings = dataclasses.replace(settings, trusted_keys_file=keys, bundle_file=bundle_file, cloud_sync_url=base)

    # ── pairing and the signed bundle ────────────────────────────────────
    paired = cloud.pair(cloud.CloudClient(base, None), store, os.environ["FAIRPLAY_E2E_BOOTSTRAP"], token_file, keys)
    token = token_file.read_text().strip()
    check("pairs with the one-time bootstrap token and trusts the cloud's key", paired["trustedKeyId"] in load_trusted_keys(keys))
    try:
        cloud.pair(cloud.CloudClient(base, None), store, os.environ["FAIRPLAY_E2E_BOOTSTRAP"], tmp_path / "again", keys)
        check("the bootstrap token works once", False)
    except cloud.CloudError as exc:
        check("the bootstrap token works once", exc.status == 401, str(exc))
    client = cloud.CloudClient(base, token)
    check("fetches and installs the cloud-signed bundle", cloud.refresh_bundle(settings, client).startswith("installed"))
    bundle = verify_bundle(json.loads(bundle_file.read_text()), load_trusted_keys(keys), allow_dev=False)
    check("the bundle is the provisioned session, issued by the cloud",
          bundle.issuer == "dtp-cloud" and bundle.session_id == os.environ["FAIRPLAY_E2E_SESSION"], bundle.session_id)
    check("an unchanged bundle is not fetched again", cloud.refresh_bundle(settings, client) == "unchanged")
    _, who = Sessions(store).login(bundle, os.environ["FAIRPLAY_E2E_EMAIL"], os.environ["FAIRPLAY_E2E_PIN"], "127.0.0.1")
    check("the member signs in at the venue with the PIN they set in the cloud", "fairplay.incident.review" in who.permissions)
    actor = Actor(who.user_id, who.name, "operator")

    # ── a match: session, rights, an incident, its finding, an approved clip ──
    session = timing.create_session(store, "Lions v Eagles", bundle.match_ref, "shadow", who.user_id, session_id=bundle.session_id)
    for t in range(0, 60, 10):
        write_segment(settings.recordings_dir, "ground", at(t), fmp4(3))
    finalise_all(settings, store)
    incidents.record_rights(store, session["id"], actor, footage_kind="synthetic", status="not_recorded", minors_present="no",
                            basis=None, consent_reference=None)

    def clip_for(seconds):
        inc = incidents.create(store, settings, session["id"], actor, event_utc=at(seconds), basis="manual", category="foul")
        job, _ = evidence.request_clip(store, settings, inc["id"], "ground", actor)
        ev_id = evidence.run_job(store, settings, FakeCutter(), job["id"])["evidence_id"]
        inc = incidents.start_review(store, inc["id"], 1, actor)
        incidents.complete_review(store, inc["id"], inc["version"], actor, result="supports_original", factual_notes="Fair challenge.",
                                  on_field_decision="play on", evidence_ids=[ev_id], footage_states={"ground": "ok"})
        evidence.approve(store, settings, ev_id, actor)
        return evidence.get(store, ev_id)

    first = clip_for(40)
    box = outbox.Outbox(store, outbox.HttpTransport(base, token))
    for _ in range(20):
        if not box.run_once().attempted:
            break
    counts = {r["state"]: r["n"] for r in store.query("SELECT state, COUNT(*) AS n FROM outbox GROUP BY state")}
    check("the whole match syncs: every item applied, none parked", counts.get("pending", 0) == 0 and counts.get("parked", 0) == 0, counts)
    check("over the real API, each answered applied", {r["result"] for r in store.query("SELECT result FROM outbox")} == {"applied"})

    # ── a 30-minute WAN outage, with work done during it, then restore ───
    dead = outbox.Outbox(store, outbox.HttpTransport("http://127.0.0.1:9", token))
    up_dead = cloud.Uploader(settings, store, cloud.CloudClient("http://127.0.0.1:9", token))
    start = utcnow()
    second = clip_for(50)  # flagged, reviewed and approved with no route out
    for minute in range(31):
        now = start + timedelta(minutes=minute)
        dead.run_once(now)
        up_dead.run_once(now)
    waiting = store.one("SELECT COUNT(*) AS n, MAX(attempts) AS a FROM outbox WHERE state = 'pending'")
    check("thirty minutes without a route: everything kept, retried with backoff", waiting["n"] > 0 and waiting["a"] >= 5, dict(waiting))
    restored = outbox.Outbox(store, outbox.HttpTransport(base, token))  # a new sender, as after an Edge restart
    for _ in range(40):
        if not restored.run_once(start + timedelta(hours=2)).attempted:
            break
    left = store.one("SELECT COUNT(*) AS n FROM outbox WHERE state != 'sent'")["n"]
    check("after the outage, a restarted sender catches up with nothing lost", left == 0, left)

    # ── uploads ──────────────────────────────────────────────────────────
    up = cloud.Uploader(settings, store, client)
    stored = up.run_once(start + timedelta(hours=2)) + up.run_once(start + timedelta(hours=2))
    check("both clips and manifests go to the bucket and are confirmed", stored == 4 and up.status()["stored"] == 4, up.status())
    with store.tx() as db:
        db.execute("UPDATE uploads SET state = 'pending', next_attempt_utc = '2000-01-01T00:00:00.000Z' WHERE evidence_id = ?", (first["id"],))
    again = up.run_once()
    check("asking to upload a stored clip again sends nothing", again == 2 and "PUT" not in json.dumps(up.last_error or ""))

    # An object that is not what the Edge declared: written straight to the S3 server.
    third = clip_for(30)
    for _ in range(20):  # the cloud must hold the evidence record before it signs a URL for it
        if not restored.run_once(start + timedelta(hours=3)).attempted:
            break
    sha = third["sha256"]
    answer = client.presign(third["id"], "clip", evidence.path_of(settings, third).stat().st_size, sha)
    s3 = httpx.put(f"http://127.0.0.1:{S3_PORT}/{os.environ['FAIRPLAY_E2E_BUCKET']}/{answer['key']}", content=b"not the clip")
    try:
        client.confirm(third["id"], "clip")
        check("a corrupted object is refused at confirm", False)
    except cloud.CloudError as exc:
        check("a corrupted object is refused at confirm", exc.code == "UploadCorrupt", f"{s3.status_code} {exc}")
    gone = httpx.head(f"http://127.0.0.1:{S3_PORT}/{os.environ['FAIRPLAY_E2E_BUCKET']}/{answer['key']}")
    check("and removed from the bucket", gone.status_code == 404, gone.status_code)
    up.run_once(start + timedelta(hours=3))
    up.run_once(start + timedelta(hours=3))
    row = store.one("SELECT state FROM uploads WHERE evidence_id = ? AND kind = 'clip'", (third["id"],))
    check("and the Edge's own upload of it then succeeds", row and row["state"] == "stored", dict(row) if row else None)

    # ── the wrong match ──────────────────────────────────────────────────
    other = os.environ["FAIRPLAY_E2E_OTHER_SESSION"]
    payload = {"id": other, "label": "x", "match_ref": None, "mode": "shadow", "created_utc": "2026-10-28T00:00:00.000Z",
               "created_by": "u", "ended_utc": None}
    item = {"idempotencyKey": f"session:{other}:1", "entityType": "session", "entityId": other, "version": 1,
            "payloadHash": outbox.payload_hash(payload), "payload": payload}
    res = outbox.HttpTransport(base, token).send(store.device_id, [item])[0]
    check("this device's token cannot send for another device's session", res["status"] == "rejected", res)
    r = httpx.post(f"{base}/api/v1/fairplay/sync/batch", json={"deviceId": store.device_id, "items": []},
                   headers={"x-fairplay-device-token": "f" * 64})
    check("an unknown device token is refused", r.status_code == 401, r.status_code)

    results["evidence"] = [{"id": e["id"], "sha256": e["sha256"]} for e in (first, second, third)]
    results["sessionId"] = session["id"]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "edge-results.json").write_text(json.dumps(results, indent=2))
    assert all(c["ok"] for c in results["checks"]), [c["label"] for c in results["checks"] if not c["ok"]]
