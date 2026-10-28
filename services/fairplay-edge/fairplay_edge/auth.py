"""Operator sign-in at the venue, with no internet (ADR-0005).

Who may act comes from a **credential bundle**: a list of people, their FairPlay
permissions and a hash of the matchday PIN each set, with an expiry, signed with Ed25519.
The Edge holds only public keys (`FAIRPLAY_TRUSTED_KEYS_FILE`), so it can check a bundle
offline but cannot forge one. The cloud signs bundles (issuer `dtp-cloud`, Phase 4; the
Edge fetches its session's bundle while online, cloud.py). For development a bundle can be
signed with a **development key** (`fairplay-edge dev-keygen` / `dev-bundle`), which is
refused unless `FAIRPLAY_ALLOW_DEV_BUNDLES=1` and is labelled DEV everywhere it shows.

Sign-in is email + PIN against the bundle and yields a random session token in a
`HttpOnly; SameSite=Strict` cookie (and `Secure` under TLS). Only its SHA-256 is stored.
Sessions end at 8 hours, after 30 minutes idle, at sign-out, or when the bundle expires,
whichever is first. Five wrong PINs for an email in five minutes lock it for five minutes.

What this cannot do, and the runbook says so: a person removed in the cloud keeps venue
access until the bundle expires or a local admin disables them here.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat

from .naming import iso, parse_iso, utcnow
from .store import Store

BUNDLE_SCHEMA = "fairplay.credential-bundle/v1"
PERMISSIONS = (
    "fairplay.incident.operate",
    "fairplay.incident.review",
    "fairplay.session.manage",
    "fairplay.edge.admin",
    "fairplay.evidence.view_original",
    "fairplay.evidence.export",
    "fairplay.report.view",
)
# Venue staff see the venue: sources, recordings, incidents, draft evidence. Anyone else
# (an organiser holding only fairplay.report.view) sees released evidence and nothing more.
STAFF_PERMISSIONS = tuple(p for p in PERMISSIONS if p != "fairplay.report.view")
ISSUERS = ("dev-local", "dtp-cloud")
SESSION_HOURS = 8
IDLE_MINUTES = 30
LOCK_FAILURES = 5
LOCK_WINDOW = timedelta(minutes=5)
IP_FAILURES = 20
MIN_PIN = 6
COOKIE = "fp_session"
CSRF_HEADER = "x-fairplay-request"

# scrypt: N=2^15, r=8, p=1 is about 32 MiB and tens of milliseconds per check, which is
# what makes a six-digit PIN expensive to guess offline if a bundle file leaks.
_SCRYPT = {"n": 2**15, "r": 8, "p": 1}


class AuthError(ValueError):
    pass


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def unb64(text: str) -> bytes:
    return base64.b64decode(text.encode(), validate=True)


def canonical(obj: dict) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


# ── PINs ──────────────────────────────────────────────────────────────────

def hash_pin(pin: str, salt: bytes | None = None) -> str:
    if not (pin.isdigit() and len(pin) >= MIN_PIN):
        raise AuthError(f"a PIN is at least {MIN_PIN} digits")
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(pin.encode(), salt=salt, dklen=32, maxmem=64 * 1024 * 1024, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${b64(salt)}${b64(digest)}"


def check_pin(pin: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        actual = hashlib.scrypt(pin.encode(), salt=unb64(salt), n=int(n), r=int(r), p=int(p), dklen=32,
                                maxmem=64 * 1024 * 1024)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, unb64(digest))


# ── keys and bundles ──────────────────────────────────────────────────────

def generate_key() -> tuple[str, str]:
    """(private PEM, public raw base64)."""
    key = Ed25519PrivateKey.generate()
    private = key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()
    public = b64(key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))
    return private, public


def key_id(public_b64: str) -> str:
    return hashlib.sha256(unb64(public_b64)).hexdigest()[:16]


def sign_bundle(bundle: dict, private_pem: str) -> dict:
    from cryptography.hazmat.primitives.serialization import load_pem_private_key

    key = load_pem_private_key(private_pem.encode(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise AuthError("the signing key is not Ed25519")
    public = b64(key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))
    return {"bundle": bundle, "keyId": key_id(public), "signature": b64(key.sign(canonical(bundle)))}


@dataclass(frozen=True)
class Member:
    user_id: str
    email: str
    name: str
    permissions: tuple[str, ...]
    pin_hash: str


@dataclass(frozen=True)
class Bundle:
    bundle_id: str
    issuer: str
    issued_utc: datetime
    expires_utc: datetime
    session_label: str | None
    match_ref: str | None
    members: tuple[Member, ...] = field(default=())
    session_id: str | None = None
    session_mode: str | None = None

    @property
    def dev(self) -> bool:
        return self.issuer == "dev-local"

    def member(self, email: str) -> Member | None:
        email = email.strip().lower()
        return next((m for m in self.members if m.email == email), None)


def load_trusted_keys(path: Path | None) -> dict[str, dict]:
    if path is None or not path.exists():
        return {}
    keys = json.loads(path.read_text(encoding="utf-8"))
    for kid, entry in keys.items():
        if entry.get("issuer") not in ISSUERS or key_id(entry["publicKey"]) != kid:
            raise AuthError(f"trusted key {kid}: bad issuer or key id")
    return keys


def verify_bundle(signed: dict, trusted: dict[str, dict], *, allow_dev: bool, now: datetime | None = None) -> Bundle:
    """Check signature, issuer, schema and expiry. Raises AuthError naming the reason."""
    now = now or utcnow()
    try:
        bundle, kid, signature = signed["bundle"], signed["keyId"], unb64(signed["signature"])
    except (KeyError, TypeError, ValueError) as exc:
        raise AuthError("not a signed bundle") from exc
    entry = trusted.get(kid)
    if entry is None:
        raise AuthError(f"signed by an untrusted key ({kid})")
    try:
        Ed25519PublicKey.from_public_bytes(unb64(entry["publicKey"])).verify(signature, canonical(bundle))
    except (InvalidSignature, ValueError) as exc:
        raise AuthError("the signature does not match the bundle") from exc
    if bundle.get("schema") != BUNDLE_SCHEMA:
        raise AuthError(f"unknown bundle schema {bundle.get('schema')!r}")
    issuer = bundle.get("issuer")
    if issuer != entry["issuer"]:
        raise AuthError("the bundle claims a different issuer from its key")
    if issuer == "dev-local" and not allow_dev:
        raise AuthError("development bundles are refused unless FAIRPLAY_ALLOW_DEV_BUNDLES=1")
    issued, expires = parse_iso(bundle["issuedAt"]), parse_iso(bundle["expiresAt"])
    if expires <= now:
        raise AuthError(f"the bundle expired at {bundle['expiresAt']}")
    if issued > now + timedelta(minutes=5):
        raise AuthError("the bundle is dated in the future; check the Edge clock")
    members = []
    for m in bundle.get("members", []):
        perms = tuple(p for p in m.get("permissions", []) if p in PERMISSIONS)
        members.append(Member(user_id=m["userId"], email=m["email"].strip().lower(), name=m.get("name", m["email"]),
                              permissions=perms, pin_hash=m["pinHash"]))
    return Bundle(bundle_id=bundle["bundleId"], issuer=issuer, issued_utc=issued, expires_utc=expires,
                  session_label=(bundle.get("session") or {}).get("label"),
                  match_ref=(bundle.get("session") or {}).get("matchId"), members=tuple(members),
                  session_id=(bundle.get("session") or {}).get("id"), session_mode=(bundle.get("session") or {}).get("mode"))


# ── sessions ──────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Principal:
    kind: str  # "operator" or "device"
    user_id: str
    email: str | None
    name: str
    permissions: tuple[str, ...]
    session_id: str | None = None
    bundle_dev: bool = False

    def can(self, permission: str) -> bool:
        return self.kind == "device" or permission in self.permissions


DEVICE = Principal(kind="device", user_id="device", email=None, name="Edge device token", permissions=PERMISSIONS)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Sessions:
    def __init__(self, store: Store):
        self.store = store

    def locked(self, email: str, ip: str, now: datetime) -> bool:
        since = iso(now - LOCK_WINDOW)
        by_email = self.store.one("SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND ok = 0 AND at_utc > ?",
                                  (email, since))["n"]
        by_ip = self.store.one("SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ok = 0 AND at_utc > ?",
                               (ip, since))["n"]
        return by_email >= LOCK_FAILURES or by_ip >= IP_FAILURES

    def login(self, bundle: Bundle | None, email: str, pin: str, ip: str, now: datetime | None = None) -> tuple[str, Principal]:
        now = now or utcnow()
        email = email.strip().lower()
        if self.locked(email, ip, now):
            raise AuthError("too many wrong attempts; try again in five minutes")
        member = bundle.member(email) if bundle else None
        disabled = member and self.store.one("SELECT 1 FROM local_disabled WHERE user_id = ?", (member.user_id,))
        ok = bool(bundle and member and not disabled and bundle.expires_utc > now and check_pin(pin, member.pin_hash))
        with self.store.tx() as db:
            db.execute("INSERT INTO login_attempts (email, ip, at_utc, ok) VALUES (?, ?, ?, ?)", (email, ip, iso(now), int(ok)))
            if not ok:
                Store.log_event(db, iso(now), "auth.login.refused", None, {"email": email, "ip": ip})
        if not ok:
            # One message for every cause, so the endpoint does not reveal who is in the bundle.
            raise AuthError("email or PIN not accepted")
        token = secrets.token_urlsafe(32)
        expires = min(now + timedelta(hours=SESSION_HOURS), bundle.expires_utc)
        with self.store.tx() as db:
            db.execute(
                "INSERT INTO operator_sessions (id, user_id, email, name, permissions, bundle_id, bundle_dev, ip,"
                " created_utc, last_seen_utc, expires_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (_token_hash(token), member.user_id, member.email, member.name, json.dumps(list(member.permissions)),
                 bundle.bundle_id, int(bundle.dev), ip, iso(now), iso(now), iso(expires)),
            )
            Store.log_event(db, iso(now), "auth.login", None, {"userId": member.user_id, "email": member.email,
                                                               "bundleId": bundle.bundle_id, "ip": ip})
        return token, Principal(kind="operator", user_id=member.user_id, email=member.email, name=member.name,
                                permissions=member.permissions, session_id=_token_hash(token), bundle_dev=bundle.dev)

    def resolve(self, token: str, now: datetime | None = None) -> Principal | None:
        now = now or utcnow()
        row = self.store.one("SELECT * FROM operator_sessions WHERE id = ? AND revoked_utc IS NULL", (_token_hash(token),))
        if row is None or parse_iso(row["expires_utc"]) <= now:
            return None
        if now - parse_iso(row["last_seen_utc"]) > timedelta(minutes=IDLE_MINUTES):
            self.revoke(row["id"], "idle", now)
            return None
        if self.store.one("SELECT 1 FROM local_disabled WHERE user_id = ?", (row["user_id"],)):
            self.revoke(row["id"], "disabled", now)
            return None
        with self.store.tx() as db:
            db.execute("UPDATE operator_sessions SET last_seen_utc = ? WHERE id = ?", (iso(now), row["id"]))
        return Principal(kind="operator", user_id=row["user_id"], email=row["email"], name=row["name"],
                         permissions=tuple(json.loads(row["permissions"])), session_id=row["id"],
                         bundle_dev=bool(row["bundle_dev"]))

    def revoke(self, session_id: str, reason: str, now: datetime | None = None) -> None:
        at = iso(now or utcnow())
        with self.store.tx() as db:
            db.execute("UPDATE operator_sessions SET revoked_utc = ? WHERE id = ? AND revoked_utc IS NULL", (at, session_id))
            Store.log_event(db, at, "auth.session.ended", None, {"reason": reason})

    def disable(self, user_id: str, by: str, reason: str) -> None:
        at = iso(utcnow())
        with self.store.tx() as db:
            db.execute("INSERT OR REPLACE INTO local_disabled (user_id, at_utc, by_user, reason) VALUES (?, ?, ?, ?)",
                       (user_id, at, by, reason))
            db.execute("UPDATE operator_sessions SET revoked_utc = ? WHERE user_id = ? AND revoked_utc IS NULL", (at, user_id))
            Store.log_event(db, at, "auth.member.disabled", None, {"userId": user_id, "by": by, "reason": reason})
