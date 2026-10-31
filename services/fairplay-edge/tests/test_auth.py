import json
import uuid
from datetime import timedelta

import pytest

from fairplay_edge.auth import (BUNDLE_SCHEMA, AuthError, Sessions, check_pin, generate_key, hash_pin, key_id,
                                sign_bundle, verify_bundle)
from fairplay_edge.audit import Actor
from fairplay_edge.naming import iso, utcnow


def make_bundle(private_pem, *, issuer="dev-local", hours=36, members=None, issued=None):
    now = issued or utcnow()
    bundle = {"schema": BUNDLE_SCHEMA, "bundleId": str(uuid.uuid4()), "issuer": issuer, "issuedAt": iso(now),
              "expiresAt": iso(now + timedelta(hours=hours)), "session": {"label": "Test", "matchId": None},
              "members": members if members is not None else [
                  {"userId": "u-op", "email": "op@dtp.test", "name": "Operator",
                   "permissions": ["fairplay.incident.operate"], "pinHash": hash_pin("12345678")},
                  {"userId": "u-view", "email": "view@dtp.test", "name": "Viewer", "permissions": [],
                   "pinHash": hash_pin("87654321")},
              ]}
    return sign_bundle(bundle, private_pem)


@pytest.fixture
def keys():
    private, public = generate_key()
    return private, {key_id(public): {"publicKey": public, "issuer": "dev-local"}}


def test_pin_hashing():
    stored = hash_pin("12345678")
    assert stored.startswith("scrypt$") and check_pin("12345678", stored) and not check_pin("12345679", stored)
    with pytest.raises(AuthError):
        hash_pin("1234567")
    with pytest.raises(AuthError):
        hash_pin("abcdefgh")


def test_valid_bundle(keys):
    private, trusted = keys
    b = verify_bundle(make_bundle(private), trusted, allow_dev=True)
    assert b.dev and b.member("OP@dtp.test").permissions == ("fairplay.incident.operate",)


def test_dev_bundle_refused_unless_allowed(keys):
    private, trusted = keys
    with pytest.raises(AuthError, match="FAIRPLAY_ALLOW_DEV_BUNDLES"):
        verify_bundle(make_bundle(private), trusted, allow_dev=False)


def test_tampered_bundle_refused(keys):
    private, trusted = keys
    signed = make_bundle(private)
    signed["bundle"]["members"][1]["permissions"] = ["fairplay.edge.admin"]  # self-promotion
    with pytest.raises(AuthError, match="signature"):
        verify_bundle(signed, trusted, allow_dev=True)


def test_untrusted_key_refused(keys):
    other_private, _ = generate_key()
    _, trusted = keys
    with pytest.raises(AuthError, match="untrusted"):
        verify_bundle(make_bundle(other_private), trusted, allow_dev=True)


def test_expired_and_future_bundles_refused(keys):
    private, trusted = keys
    with pytest.raises(AuthError, match="expired"):
        verify_bundle(make_bundle(private, issued=utcnow() - timedelta(hours=40)), trusted, allow_dev=True)
    with pytest.raises(AuthError, match="future"):
        verify_bundle(make_bundle(private, issued=utcnow() + timedelta(hours=1)), trusted, allow_dev=True)


def test_issuer_must_match_key(keys):
    private, trusted = keys
    with pytest.raises(AuthError, match="different issuer"):
        verify_bundle(make_bundle(private, issuer="dtp-cloud"), trusted, allow_dev=True)


def test_unknown_permissions_are_dropped(keys):
    private, trusted = keys
    members = [{"userId": "u", "email": "a@b.test", "name": "A", "permissions": ["root", "fairplay.incident.review"],
                "pinHash": hash_pin("12345678")}]
    b = verify_bundle(make_bundle(private, members=members), trusted, allow_dev=True)
    assert b.members[0].permissions == ("fairplay.incident.review",)


@pytest.fixture
def bundle(keys):
    private, trusted = keys
    return verify_bundle(make_bundle(private), trusted, allow_dev=True)


def test_login_and_resolve(store, bundle):
    sessions = Sessions(store)
    token, who = sessions.login(bundle, "op@dtp.test", "12345678", "10.0.0.5")
    assert who.can("fairplay.incident.operate") and not who.can("fairplay.edge.admin")
    again = sessions.resolve(token, bundle)
    assert again.user_id == "u-op"
    row = store.one("SELECT id FROM operator_sessions")
    assert row["id"] != token  # only the hash is stored


def test_wrong_pin_and_unknown_email_look_the_same(store, bundle):
    sessions = Sessions(store)
    with pytest.raises(AuthError) as a:
        sessions.login(bundle, "op@dtp.test", "00000000", "10.0.0.5")
    with pytest.raises(AuthError) as b:
        sessions.login(bundle, "nobody@dtp.test", "12345678", "10.0.0.5")
    assert str(a.value) == str(b.value)


def test_lockout_after_five_failures(store, bundle):
    sessions = Sessions(store)
    for _ in range(5):
        with pytest.raises(AuthError):
            sessions.login(bundle, "op@dtp.test", "00000000", "10.0.0.5")
    with pytest.raises(AuthError, match="too many"):
        sessions.login(bundle, "op@dtp.test", "12345678", "10.0.0.5")


def test_idle_session_ends(store, bundle):
    sessions = Sessions(store)
    token, _ = sessions.login(bundle, "op@dtp.test", "12345678", "ip")
    assert sessions.resolve(token, bundle, now=utcnow() + timedelta(minutes=31)) is None
    assert sessions.resolve(token, bundle) is None  # and it stays ended


def test_session_never_outlives_the_bundle(store, keys):
    private, trusted = keys
    short = verify_bundle(make_bundle(private, hours=1), trusted, allow_dev=True)
    sessions = Sessions(store)
    token, _ = sessions.login(short, "op@dtp.test", "12345678", "ip")
    expires = store.one("SELECT expires_utc FROM operator_sessions")["expires_utc"]
    assert expires == iso(short.expires_utc)


def test_local_disable_ends_sessions_and_refuses_sign_in(store, bundle):
    sessions = Sessions(store)
    token, _ = sessions.login(bundle, "op@dtp.test", "12345678", "ip")
    sessions.disable("u-op", Actor(id="u-admin", name="Admin", kind="operator"), "left the venue")
    assert sessions.resolve(token, bundle) is None
    with pytest.raises(AuthError):
        sessions.login(bundle, "op@dtp.test", "12345678", "ip")
    assert json.loads(store.one("SELECT detail FROM events WHERE kind = 'auth.member.disabled'")["detail"])["by"] == "u-admin"


def _ended_because(store):
    return json.loads(store.one("SELECT detail FROM events WHERE kind = 'auth.session.ended' ORDER BY rowid DESC")["detail"])["reason"]


def test_someone_dropped_from_the_new_bundle_is_signed_out(store, keys):
    private, trusted = keys
    first = verify_bundle(make_bundle(private), trusted, allow_dev=True)
    sessions = Sessions(store)
    token, _ = sessions.login(first, "op@dtp.test", "12345678", "ip")
    without = verify_bundle(make_bundle(private, members=[
        {"userId": "u-view", "email": "view@dtp.test", "name": "Viewer", "permissions": [], "pinHash": hash_pin("87654321")}]),
        trusted, allow_dev=True)
    assert sessions.resolve(token, without) is None
    assert _ended_because(store) == "not_in_current_bundle"
    assert sessions.resolve(token, first) is None  # ended for good, not just while that bundle is loaded


def test_a_permission_the_new_bundle_drops_is_gone_at_once_and_one_it_adds_waits(store, keys):
    private, trusted = keys
    member = {"userId": "u-op", "email": "op@dtp.test", "name": "Operator", "pinHash": hash_pin("12345678")}
    first = verify_bundle(make_bundle(private, members=[
        {**member, "permissions": ["fairplay.incident.operate", "fairplay.incident.review"]}]), trusted, allow_dev=True)
    sessions = Sessions(store)
    token, _ = sessions.login(first, "op@dtp.test", "12345678", "ip")
    narrower = verify_bundle(make_bundle(private, members=[
        {**member, "permissions": ["fairplay.incident.operate", "fairplay.edge.admin"]}]), trusted, allow_dev=True)
    who = sessions.resolve(token, narrower)
    assert who.can("fairplay.incident.operate") and not who.can("fairplay.incident.review")
    assert not who.can("fairplay.edge.admin")  # added in the cloud: takes a fresh sign-in
    assert not sessions.resolve(token, first).can("fairplay.incident.review")  # stays removed
    narrowed = json.loads(store.one("SELECT detail FROM events WHERE kind = 'auth.session.narrowed'")["detail"])
    assert narrowed["removed"] == ["fairplay.incident.review"] and narrowed["bundleId"] == narrower.bundle_id


def test_no_bundle_or_an_expired_one_signs_everyone_out(store, keys):
    private, trusted = keys
    bundle = verify_bundle(make_bundle(private), trusted, allow_dev=True)
    sessions = Sessions(store)
    token, _ = sessions.login(bundle, "op@dtp.test", "12345678", "ip")
    assert sessions.resolve(token, None) is None
    assert _ended_because(store) == "no_current_bundle"
    other, _ = sessions.login(bundle, "view@dtp.test", "87654321", "ip")
    stale = verify_bundle(make_bundle(private, hours=1, issued=utcnow() - timedelta(hours=2)), trusted,
                          allow_dev=True, now=utcnow() - timedelta(hours=2))
    assert sessions.resolve(other, stale) is None
