"""The Edge's side of the DTP cloud, beyond the sync outbox (Phase 4, docs/fairplay/phase-4-cloud.md):

  pair            exchange the one-time bootstrap token an admin was shown for a device
                  token, and learn the public key the cloud signs bundles with. Re-pairing
                  (a new bootstrap token for the same device, from the FairPlay page) is the
                  same command; the Edge warns 30 days before its device token expires;
  refresh_bundle  while online, fetch the signed credential bundle for the session the
                  cloud assigned to this device, verify it, and install it. A bundle that
                  does not verify is never written, so a bad answer cannot lock anyone out;
  Uploader        send released evidence clips and their manifests to the evidence bucket
                  by presigned PUT, then ask the cloud to confirm what arrived;
  apply_withdrawals  clips withdrawn on request in the cloud (decisions.md D11): each is
                  removed here under the cloud's id, and the withdrawal syncs back as the
                  confirmation.

The Edge holds no storage credentials. Each upload URL is good for one object of exactly
the size and SHA-256 the Edge declared, for a few minutes. What may go up is what may be
released (`evidence.released`): approved, the finding standing, the rights permitting.
Whole-match upload does not exist. Video bytes go from here to R2, never through the API.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path

import httpx

from . import audit, evidence
from .auth import AuthError, canonical, load_trusted_keys, verify_bundle
from .config import Settings, url_allowed
from .naming import iso, parse_iso, utcnow
from .outbox import backoff
from .store import Store

log = logging.getLogger("fairplay.cloud")

BUNDLE_EVERY_S = 300
TOKEN_WARN_DAYS = 30
UPLOADS_PER_PASS = 4
CHUNK = 1024 * 1024
# Waits for answers that will not change soon: not releasable yet, storage not set up.
LONG_WAIT = {"NotReleasable": timedelta(minutes=15), "EvidenceStorageOff": timedelta(hours=1),
             "Deleted": timedelta(days=1), "HashMismatch": timedelta(hours=1), "Withdrawn": timedelta(days=1)}
# Who removes a clip the cloud withdrew: the person who did is in the cloud's audit log.
CLOUD_ACTOR = audit.Actor(id="cloud", name="DTP cloud, on request", kind="system")


class CloudError(RuntimeError):
    def __init__(self, message: str, status: int | None = None, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


class CloudClient:
    def __init__(self, base_url: str, device_token: str | None, client: httpx.Client | None = None, timeout: float = 30.0):
        if not url_allowed(base_url):
            raise CloudError("the cloud URL must be https:// (plain http only to this machine, for tests)")
        self.base = base_url.rstrip("/") + "/api/v1/fairplay"
        self.token = device_token
        self.client = client or httpx.Client(timeout=timeout)

    def _call(self, method: str, path: str, *, json_body: dict | None = None, params: dict | None = None,
              headers: dict | None = None) -> dict:
        h = dict(headers or {})
        if self.token:
            h["x-fairplay-device-token"] = self.token
        try:
            response = self.client.request(method, self.base + path, json=json_body, params=params, headers=h)
        except httpx.HTTPError as exc:
            raise CloudError(f"{exc.__class__.__name__}: {exc}") from exc
        body = {}
        try:
            body = response.json()
        except ValueError:
            pass
        if response.status_code >= 400:
            raise CloudError(f"{method} {path}: {response.status_code} {body.get('message') or ''}".strip(),
                             response.status_code, body.get("error"))
        return body

    def register(self, bootstrap_token: str, edge_device_id: str) -> dict:
        return self._call("POST", "/device/register", json_body={"edgeDeviceId": edge_device_id},
                          headers={"x-fairplay-bootstrap-token": bootstrap_token})

    def bundle(self, have: str | None, expires: str | None) -> dict:
        params = {k: v for k, v in (("have", have), ("expires", expires)) if v}
        return self._call("GET", "/device/bundle", params=params)

    def presign(self, evidence_id: str, kind: str, size: int, sha256: str) -> dict:
        return self._call("POST", f"/device/evidence/{evidence_id}/uploads",
                          json_body={"kind": kind, "bytes": size, "sha256": sha256})

    def confirm(self, evidence_id: str, kind: str) -> dict:
        return self._call("POST", f"/device/evidence/{evidence_id}/uploads/{kind}/confirm")

    def withdrawals(self) -> list[dict]:
        return self._call("GET", "/device/withdrawals")  # type: ignore[return-value]  (a JSON list)

    def put(self, upload: dict, path: Path) -> None:
        if upload.get("method") != "PUT" or not url_allowed(upload.get("url", "")):
            raise CloudError("the upload URL is not an https PUT")

        def chunks():
            with path.open("rb") as fh:
                while block := fh.read(CHUNK):
                    yield block

        try:
            response = self.client.put(upload["url"], content=chunks(), headers=upload.get("headers") or {})
        except httpx.HTTPError as exc:
            raise CloudError(f"upload: {exc.__class__.__name__}: {exc}") from exc
        if response.status_code >= 300:
            raise CloudError(f"upload: the bucket answered {response.status_code}", response.status_code, "UploadRefused")


# ── pairing ──────────────────────────────────────────────────────────────

def pair(client: CloudClient, store: Store, bootstrap_token: str, token_file: Path, trusted_keys_file: Path) -> dict:
    """Register this Edge, write its device token (owner-only) and trust the cloud's key."""
    answer = client.register(bootstrap_token.strip(), store.device_id)
    token_file.parent.mkdir(parents=True, exist_ok=True)
    tmp = token_file.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    # Owner-only from the moment it exists: never written first and narrowed after.
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(answer["deviceToken"] + "\n")
    tmp.replace(token_file)
    now = iso(utcnow())
    with store.tx() as db:
        db.execute("INSERT OR REPLACE INTO cloud_pairing (id, cloud_device_id, label, token_expires_utc, paired_utc)"
                   " VALUES (1, ?, ?, ?, ?)", (answer["deviceId"], answer["label"], answer["deviceTokenExpiresAt"], now))
        Store.log_event(db, now, "cloud.paired", None, {"deviceId": answer["deviceId"], "tokenExpires": answer["deviceTokenExpiresAt"]})
    key = answer.get("trustedKey")
    if key:
        keys = json.loads(trusted_keys_file.read_text(encoding="utf-8")) if trusted_keys_file.exists() else {}
        keys[key["keyId"]] = {"issuer": key["issuer"], "publicKey": key["publicKey"]}
        tmp = trusted_keys_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(keys, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        tmp.replace(trusted_keys_file)
        load_trusted_keys(trusted_keys_file)  # refuses a key whose id does not match it
    return {"deviceId": answer["deviceId"], "label": answer["label"], "tokenExpires": answer["deviceTokenExpiresAt"],
            "trustedKeyId": key["keyId"] if key else None}


def apply_withdrawals(settings: Settings, store: Store, client: CloudClient) -> list[str]:
    """Remove here what the cloud withdrew. A clip this Edge does not hold, or holds with
    another hash, is left for a person: the cloud keeps the withdrawal unconfirmed."""
    done = []
    for item in client.withdrawals():
        row = store.one("SELECT id, sha256 FROM evidence WHERE id = ?", (item.get("evidenceId"),))
        if row is None or row["sha256"] != item.get("clipSha256"):
            log.warning(json.dumps({"event": "withdrawal.not_applied", "id": item.get("id"), "evidenceId": item.get("evidenceId"),
                                    "why": "unknown evidence" if row is None else "hash differs"}))
            continue
        if evidence.withdrawal_of(store, row["id"]) is None:
            evidence.withdraw(store, settings, row["id"], str(item.get("reason", "")), str(item.get("requester", "")),
                              CLOUD_ACTOR, origin="cloud", withdrawal_id=item["id"], request_ref=item.get("requestId"))
        # Withdrawn here as well, first: that withdrawal's sync is what confirms it to the cloud.
        done.append(item["id"])
    return done


def check_token_expiry(store: Store, now: datetime | None = None) -> str | None:
    """Warn 30 days before the device token expires, and loudly once it has: an expired token
    syncs nothing. Re-pairing clears both. An Edge paired before this was recorded says nothing."""
    row = store.one("SELECT * FROM cloud_pairing WHERE id = 1")
    if row is None:
        return None
    now = now or utcnow()
    at, expires = iso(now), parse_iso(row["token_expires_utc"])
    detail = {"expiresUtc": row["token_expires_utc"], "device": row["label"],
              "remedy": "an Edge admin re-pairs this device on the FairPlay page, then runs fairplay-edge pair"}
    if expires <= now:
        store.resolve_alert("device_token_expiring", None, at)
        store.open_alert("device_token_expired", None, "critical", at, detail)
        return "expired"
    store.resolve_alert("device_token_expired", None, at)
    if expires - now <= timedelta(days=TOKEN_WARN_DAYS):
        store.open_alert("device_token_expiring", None, "warning", at, detail)
        return "expiring"
    store.resolve_alert("device_token_expiring", None, at)
    return None


# ── the operator bundle ──────────────────────────────────────────────────

def content_hash(bundle: dict) -> str:
    """The cloud's hash of who may act: the session and its members, as signed."""
    return hashlib.sha256(canonical({"session": bundle["session"], "members": bundle["members"]})).hexdigest()


def refresh_bundle(settings: Settings, client: CloudClient) -> str:
    """Fetch and install this device's bundle. Returns what happened, for the log."""
    path = settings.bundle_file
    if path is None:
        return "no FAIRPLAY_BUNDLE_FILE configured"
    have = expires = None
    if path.exists():
        try:
            held = json.loads(path.read_text(encoding="utf-8"))["bundle"]
            if held.get("issuer") == "dtp-cloud":
                have, expires = content_hash(held), held["expiresAt"]
        except (OSError, ValueError, KeyError, TypeError):
            pass
    answer = client.bundle(have, expires)
    if answer.get("unchanged"):
        return "unchanged"
    signed = answer.get("bundle")
    if not signed:
        return f"none: {answer.get('reason')}"
    try:
        verify_bundle(signed, load_trusted_keys(settings.trusted_keys_file), allow_dev=False)
    except AuthError as exc:
        # Never install what this Edge cannot check; the bundle it has keeps working.
        raise CloudError(f"the cloud's bundle does not verify here: {exc}") from exc
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(signed, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        tmp.replace(path)
    except OSError as exc:
        # A read-only ./auth, say: point FAIRPLAY_BUNDLE_PATH at the data volume.
        raise CloudError(f"cannot write the bundle to {path}: {exc}") from exc
    return f"installed {signed['bundle']['bundleId']} for session {signed['bundle']['session']['id']}"


# ── evidence uploads ─────────────────────────────────────────────────────

class Uploader:
    def __init__(self, settings: Settings, store: Store, client: CloudClient):
        self.settings = settings
        self.store = store
        self.client = client
        self.last_error: str | None = None

    def queue_released(self, now: datetime) -> int:
        """Make sure every released clip has its two upload rows. Withheld clips get none."""
        added = 0
        for row in self.store.query("SELECT * FROM evidence WHERE state = 'approved'"):
            ok, _ = evidence.released(self.store, row)
            if not ok:
                continue
            with self.store.tx() as db:
                for kind in ("clip", "manifest"):
                    added += db.execute(
                        "INSERT OR IGNORE INTO uploads (evidence_id, kind, state, next_attempt_utc, created_utc)"
                        " VALUES (?, ?, 'pending', ?, ?)", (row["id"], kind, iso(now), iso(now))).rowcount
        return added

    def run_once(self, now: datetime | None = None) -> int:
        now = now or utcnow()
        self.queue_released(now)
        due = self.store.query("SELECT * FROM uploads WHERE state = 'pending' AND next_attempt_utc <= ?"
                               " ORDER BY created_utc, kind LIMIT ?", (iso(now), UPLOADS_PER_PASS))
        stored = 0
        for job in due:
            try:
                stored += self._one(job)
            except (CloudError, evidence.ClipFailed, OSError) as exc:
                self._failed(job, exc, now)
        return stored

    def _one(self, job: dict) -> int:
        row = evidence.get(self.store, job["evidence_id"])
        ok, why = evidence.released(self.store, row)
        if not ok:
            # Reopened, or the rights changed, since it was queued: it waits, and is not sent.
            raise CloudError(f"withheld here: {why}", 409, "NotReleasable")
        # Both files are re-hashed first; a mismatch raises the critical alert and sends nothing.
        evidence.verify_file(self.store, self.settings, row)
        if job["kind"] == "clip":
            path, sha = evidence.path_of(self.settings, row), row["sha256"]
        else:
            path, sha = evidence.path_of(self.settings, row, "manifest_rel_path"), row["manifest_sha256"]
        answer = self.client.presign(row["id"], job["kind"], path.stat().st_size, sha)
        if not answer.get("stored"):
            self.client.put(answer["upload"], path)
            answer = self.client.confirm(row["id"], job["kind"])
        at = iso(utcnow())
        with self.store.tx() as db:
            db.execute("UPDATE uploads SET state = 'stored', remote_key = ?, stored_utc = ?, last_error = NULL,"
                       " attempts = attempts + 1 WHERE evidence_id = ? AND kind = ?",
                       (answer["key"], at, row["id"], job["kind"]))
            audit.append(db, audit.Actor.system(), "evidence.uploaded", "evidence", row["id"], None,
                         {"kind": job["kind"], "key": answer["key"], "sha256": sha})
        self.last_error = None
        return 1

    def _failed(self, job: dict, exc: Exception, now: datetime) -> None:
        code = getattr(exc, "code", None)
        attempts = job["attempts"] + 1
        wait = LONG_WAIT.get(code) or timedelta(seconds=backoff(attempts))
        self.last_error = f"{job['kind']} of {job['evidence_id']}: {exc}"
        log.warning(json.dumps({"event": "upload.failed", "evidence": job["evidence_id"], "kind": job["kind"],
                                "code": code, "error": str(exc)[:300]}))
        with self.store.tx() as db:
            db.execute("UPDATE uploads SET attempts = ?, next_attempt_utc = ?, last_error = ? WHERE evidence_id = ? AND kind = ?",
                       (attempts, iso(now + wait), str(exc)[:500], job["evidence_id"], job["kind"]))

    def status(self) -> dict:
        counts = {r["state"]: r["n"] for r in self.store.query("SELECT state, COUNT(*) AS n FROM uploads GROUP BY state")}
        oldest = self.store.one("SELECT MIN(created_utc) AS t FROM uploads WHERE state = 'pending'")["t"]
        return {"pending": counts.get("pending", 0), "stored": counts.get("stored", 0), "oldestPendingUtc": oldest,
                "lastError": self.last_error}
