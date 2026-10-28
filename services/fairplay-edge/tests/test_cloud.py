"""Phase 4: the Edge's side of the cloud. Pairing, the cloud-signed bundle, sessions taken from
it, and evidence uploads by presigned PUT with the cloud's confirmation.

`FakeCloud` stands in for the API and the bucket. TEST DOUBLE ONLY. Like R2 with a signed
length and SHA-256, its bucket refuses a body that is not what the URL was signed for, and
its confirm checks the bytes it holds. scripts/fairplay-e2e-check.py in services/api runs
this code against the real API and an S3 server.
"""

import base64
import dataclasses
import hashlib
import json
import os
import stat
import uuid
from datetime import timedelta

import httpx
import pytest

from fairplay_edge import audit, cloud, evidence, incidents, timing
from fairplay_edge.audit import Actor
from fairplay_edge.auth import generate_key, key_id, sign_bundle, verify_bundle, load_trusted_keys
from fairplay_edge.cloud import CloudClient, CloudError, Uploader
from fairplay_edge.naming import iso, utcnow

from .test_evidence import FakeCutter, flag, session, ten_second_segments  # noqa: F401  (fixtures)

OP = Actor("u-op", "Operator", "operator")


class FakeCloud:
    def __init__(self, private_pem: str | None = None):
        self.private_pem = private_pem
        self.bucket: dict[str, bytes] = {}
        self.signed: dict[str, tuple[int, str]] = {}
        self.calls: list[str] = []
        self.bundle: dict | None = None
        self.refuse: dict[str, tuple[int, str]] = {}
        self.tamper_next_put = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append(f"{request.method} {path}")
        for prefix, (status, code) in self.refuse.items():
            if path.endswith(prefix):
                return httpx.Response(status, json={"error": code, "message": code})
        if path == "/api/v1/fairplay/device/register":
            return httpx.Response(200, json={"deviceId": "d-1", "label": "Edge 1", "deviceToken": "t" * 64,
                                             "deviceTokenExpiresAt": "2027-10-28T00:00:00Z", "trustedKey": self.trusted()})
        if path == "/api/v1/fairplay/device/bundle":
            have = request.url.params.get("have")
            if self.bundle and have == cloud.content_hash(self.bundle["bundle"]):
                return httpx.Response(200, json={"unchanged": True})
            return httpx.Response(200, json={"bundle": self.bundle} if self.bundle else {"bundle": None, "reason": "none"})
        if path.endswith("/uploads"):
            body = json.loads(request.content)
            key = f"{path.split('/')[-2]}/{body['kind']}"
            if key in self.bucket:
                return httpx.Response(200, json={"stored": True, "key": key})
            self.signed[key] = (body["bytes"], body["sha256"])
            b64 = base64.b64encode(bytes.fromhex(body["sha256"])).decode()
            return httpx.Response(200, json={"stored": False, "key": key, "upload": {
                "method": "PUT", "url": f"https://bucket.example/{key}",
                "headers": {"content-length": str(body["bytes"]), "x-amz-checksum-sha256": b64}}})
        if request.url.host == "bucket.example":
            key = path.lstrip("/")
            data = request.read()
            size, sha = self.signed[key]
            if len(data) != size or hashlib.sha256(data).hexdigest() != sha:
                return httpx.Response(400, text="BadDigest")
            self.bucket[key] = data + (b"!" if self.tamper_next_put else b"")
            self.tamper_next_put = False
            return httpx.Response(200)
        if path.endswith("/confirm"):
            parts = path.split("/")
            key = f"{parts[-4]}/{parts[-2]}"
            data = self.bucket.get(key)
            if data is None:
                return httpx.Response(409, json={"error": "NotUploaded"})
            if hashlib.sha256(data).hexdigest() != self.signed[key][1]:
                del self.bucket[key]
                return httpx.Response(409, json={"error": "UploadCorrupt", "message": "not intact"})
            return httpx.Response(200, json={"stored": True, "key": key})
        return httpx.Response(404)

    def trusted(self):
        if not self.private_pem:
            return None
        from cryptography.hazmat.primitives.serialization import load_pem_private_key, Encoding, PublicFormat
        public = base64.b64encode(load_pem_private_key(self.private_pem.encode(), None).public_key()
                                  .public_bytes(Encoding.Raw, PublicFormat.Raw)).decode()
        return {"keyId": key_id(public), "issuer": "dtp-cloud", "publicKey": public}

    def client(self, token="t" * 64) -> CloudClient:
        return CloudClient("https://dtp.example", token, httpx.Client(transport=httpx.MockTransport(self.handler)))


def cloud_bundle(private_pem: str, session_id: str, match_id: str | None, hours: float = 36) -> dict:
    now = utcnow()
    bundle = {"schema": "fairplay.credential-bundle/v1", "issuer": "dtp-cloud", "bundleId": str(uuid.uuid4()),
              "issuedAt": iso(now), "expiresAt": iso(now + timedelta(hours=hours)),
              "session": {"id": session_id, "label": "Lions v Eagles", "matchId": match_id, "mode": "shadow"},
              "members": [{"userId": "u-1", "email": "ade@example.org", "name": "Adé", "pinHash": "scrypt$1$1$1$AA==$AA==",
                           "permissions": ["fairplay.incident.operate"]}]}
    return sign_bundle(bundle, private_pem)


@pytest.fixture
def paired(tmp_path, settings, store):
    private, _ = generate_key()
    fake = FakeCloud(private)
    keys = tmp_path / "trusted-keys.json"
    result = cloud.pair(fake.client(None), store, "b" * 64, tmp_path / "device-token", keys)
    return fake, private, keys, result


def test_pairing_writes_an_owner_only_token_and_trusts_the_cloud_key(tmp_path, paired, store):
    fake, private, keys, result = paired
    token = tmp_path / "device-token"
    assert token.read_text().strip() == "t" * 64 and result["deviceId"] == "d-1"
    if os.name == "posix":
        assert stat.S_IMODE(token.stat().st_mode) == 0o600
    trusted = load_trusted_keys(keys)
    assert [e["issuer"] for e in trusted.values()] == ["dtp-cloud"]
    assert fake.calls == ["POST /api/v1/fairplay/device/register"]


def test_a_verified_cloud_bundle_is_installed_and_not_refetched(tmp_path, paired, settings):
    fake, private, keys, _ = paired
    settings = dataclasses.replace(settings, trusted_keys_file=keys, bundle_file=tmp_path / "bundle.json")
    fake.bundle = cloud_bundle(private, "s-cloud", "m-1")
    assert cloud.refresh_bundle(settings, fake.client()).startswith("installed")
    installed = verify_bundle(json.loads(settings.bundle_file.read_text()), load_trusted_keys(keys), allow_dev=False)
    assert (installed.session_id, installed.match_ref, installed.issuer) == ("s-cloud", "m-1", "dtp-cloud")
    assert cloud.refresh_bundle(settings, fake.client()) == "unchanged"


def test_a_bundle_that_does_not_verify_is_never_installed(tmp_path, paired, settings):
    fake, private, keys, _ = paired
    settings = dataclasses.replace(settings, trusted_keys_file=keys, bundle_file=tmp_path / "bundle.json")
    fake.bundle = cloud_bundle(private, "s-cloud", "m-1")
    cloud.refresh_bundle(settings, fake.client())
    before = settings.bundle_file.read_bytes()
    other, _ = generate_key()
    fake.bundle = cloud_bundle(other, "s-evil", None)
    with pytest.raises(CloudError, match="does not verify"):
        cloud.refresh_bundle(settings, fake.client())
    assert settings.bundle_file.read_bytes() == before  # the working bundle stays


def test_a_session_takes_the_cloud_id_once(store):
    row = timing.create_session(store, "Lions v Eagles", "m-1", "shadow", "u-op", session_id="s-cloud")
    assert row["id"] == "s-cloud"
    with pytest.raises(timing.TimingError, match="already been started"):
        timing.create_session(store, "Lions v Eagles", "m-1", "shadow", "u-op", session_id="s-cloud")


def test_audit_entries_carry_the_text_they_were_hashed_over(store):
    audit.record(store, OP, "incident.created", "incident", "i-1", 1, {"coverage": 1.0})
    payload = json.loads(store.one("SELECT payload FROM outbox WHERE entity_type = 'audit'")["payload"])
    assert payload["detail_text"] == '{"coverage":1.0}' and payload["detail"] == {"coverage": 1.0}


def test_the_cloud_url_must_be_https_except_to_this_machine():
    with pytest.raises(CloudError):
        CloudClient("http://dtp.example", "t")
    CloudClient("http://127.0.0.1:3101", "t")


# ── uploads ──────────────────────────────────────────────────────────────

def approved_clip(store, settings, session):  # noqa: F811
    inc = flag(store, settings, session)
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    ev_id = evidence.run_job(store, settings, FakeCutter(), job["id"])["evidence_id"]
    inc = incidents.start_review(store, inc["id"], 1, OP)
    incidents.complete_review(store, inc["id"], inc["version"], OP, result="inconclusive", factual_notes="Blocked view.",
                              on_field_decision=None, evidence_ids=[ev_id], footage_states={"ground": "ok"})
    incidents.record_rights(store, session["id"], OP, footage_kind="synthetic", status="not_recorded", minors_present="no",
                            basis=None, consent_reference=None)
    evidence.approve(store, settings, ev_id, OP)
    return incidents.get(store, inc["id"]), evidence.get(store, ev_id)


def test_released_evidence_goes_up_once_and_is_confirmed(store, settings, session, ten_second_segments):  # noqa: F811
    _, ev = approved_clip(store, settings, session)
    fake = FakeCloud()
    up = Uploader(settings, store, fake.client())
    assert up.run_once() == 2
    assert fake.bucket[f"{ev['id']}/clip"] == evidence.path_of(settings, ev).read_bytes()
    assert fake.bucket[f"{ev['id']}/manifest"] == evidence.path_of(settings, ev, "manifest_rel_path").read_bytes()
    assert up.run_once() == 0 and up.status()["stored"] == 2
    uploaded = [e for e in audit.entries(store) if e["action"] == "evidence.uploaded"]
    assert sorted(e["detail"]["kind"] for e in uploaded) == ["clip", "manifest"]
    assert sum(c.startswith("PUT") for c in fake.calls) == 2


def test_nothing_withheld_is_uploaded(store, settings, session, ten_second_segments):  # noqa: F811
    inc, ev = approved_clip(store, settings, session)
    incidents.reopen(store, inc["id"], inc["version"], OP, "new angle")
    fake = FakeCloud()
    assert Uploader(settings, store, fake.client()).run_once() == 0
    assert fake.calls == [] and store.one("SELECT COUNT(*) AS n FROM uploads")["n"] == 0


def test_a_changed_local_file_is_never_uploaded(store, settings, session, ten_second_segments):  # noqa: F811
    _, ev = approved_clip(store, settings, session)
    path = evidence.path_of(settings, ev)
    os.chmod(path, 0o644)
    path.write_bytes(path.read_bytes() + b"x")
    fake = FakeCloud()
    up = Uploader(settings, store, fake.client())
    assert up.run_once() == 0 and fake.calls == []
    assert store.one("SELECT 1 FROM alerts WHERE kind = 'evidence_mismatch' AND resolved_utc IS NULL")


def test_a_corrupted_upload_is_sent_again(store, settings, session, ten_second_segments):  # noqa: F811
    _, ev = approved_clip(store, settings, session)
    fake = FakeCloud()
    fake.tamper_next_put = True
    up = Uploader(settings, store, fake.client())
    assert up.run_once() == 1  # the clip is refused at confirm; the manifest is stored
    row = store.one("SELECT * FROM uploads WHERE evidence_id = ? AND kind = 'clip'", (ev["id"],))
    assert row["state"] == "pending" and "not intact" in row["last_error"]
    assert up.run_once(utcnow() + timedelta(minutes=10)) == 1
    assert fake.bucket[f"{ev['id']}/clip"] == evidence.path_of(settings, ev).read_bytes()


def test_a_cloud_that_will_not_take_it_yet_is_asked_again_later(store, settings, session, ten_second_segments):  # noqa: F811
    approved_clip(store, settings, session)
    fake = FakeCloud()
    fake.refuse["/uploads"] = (409, "NotReleasable")
    up = Uploader(settings, store, fake.client())
    now = utcnow()
    assert up.run_once(now) == 0
    assert up.run_once(now + timedelta(minutes=5)) == 0 and len(fake.calls) == 2  # waiting, not hammering
    fake.refuse.clear()
    assert up.run_once(now + timedelta(minutes=16)) == 2


def test_an_outage_keeps_every_upload_and_they_go_when_it_ends(store, settings, session, ten_second_segments):  # noqa: F811
    approved_clip(store, settings, session)

    def down(request):
        raise httpx.ConnectError("network unreachable")

    up = Uploader(settings, store, CloudClient("https://dtp.example", "t", httpx.Client(transport=httpx.MockTransport(down))))
    now = utcnow()
    for minute in range(30):
        up.run_once(now + timedelta(minutes=minute))
    assert store.one("SELECT COUNT(*) AS n, MIN(attempts) AS a FROM uploads WHERE state = 'pending'")["n"] == 2
    fake = FakeCloud()
    up = Uploader(settings, store, fake.client())
    assert up.run_once(now + timedelta(hours=1)) == 2


def test_a_bundle_that_cannot_be_written_is_a_refresh_failure_not_a_crash(tmp_path, paired, settings):
    fake, private, keys, _ = paired
    blocked = tmp_path / "read-only"
    blocked.write_text("a file, so nothing can be created under it")
    settings = dataclasses.replace(settings, trusted_keys_file=keys, bundle_file=blocked / "bundle.json")
    fake.bundle = cloud_bundle(private, "s-cloud", "m-1")
    with pytest.raises(CloudError, match="cannot write the bundle"):
        cloud.refresh_bundle(settings, fake.client())
