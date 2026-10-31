"""Phase 5.4, the Edge's security tests (docs/fairplay/phase-5-threat-review.md, "5.4").

Each walk reads the routes from the app itself, so a route added later is held to the same
rules without anyone remembering to add it here:

  - every route's guard, against the table below: a new route without one fails;
  - nothing but liveness and sign-in answers without a sign-in, a forged cookie or a
    guessed token;
  - each person is refused exactly what their permissions do not allow, and a permission
    or a person dropped from a new bundle is gone at the next request;
  - every state-changing request needs the CSRF header and this origin;
  - a guessed id is a 404, never a server error, and another session's records look the
    same as records that do not exist;
  - the console's file server never serves anything outside the console;
  - no secret in a response, the logs, the database's readable tables or the outbox;
  - every route that hands out footage or evidence writes an audit entry.
"""

import base64
import inspect
import json
import logging
import os
import re
import secrets
import time
import uuid
from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from fairplay_edge import incidents, timing
from fairplay_edge.api import create_app
from fairplay_edge.audit import Actor
from fairplay_edge.auth import BUNDLE_SCHEMA, PERMISSIONS, STAFF_PERMISSIONS, generate_key, hash_pin, key_id, sign_bundle
from fairplay_edge.config import load_settings
from fairplay_edge.naming import iso, utcnow
from fairplay_edge.service import EdgeService

from .conftest import SECRET, T0, at, fmp4, write_segment
from .fakes import FakeMediaMtx
from .test_evidence import FakeCutter
from .test_phase3_api import ALL, CSRF

OWN, OTHER = "s-own", "s-other"
PIN = f"{secrets.randbelow(900_000) + 100_000}"
OPERATE, REVIEW, MANAGE, ADMIN, EXPORT = (f"fairplay.{p}" for p in (
    "incident.operate", "incident.review", "session.manage", "edge.admin", "evidence.export"))
PEOPLE = {
    "operator": [OPERATE],
    "assessor": [OPERATE, REVIEW],
    "lead": [p for p in ALL if p != ADMIN],  # everything but the Edge's own administration
    "admin": ALL,
    "organiser": ["fairplay.report.view"],
    "nobody": [],
}

# Who may call each route. None: anyone (liveness and sign-in). "signed_in": any person
# signed in. "staff": any venue permission. "organiser": any FairPlay permission. A
# permission's name: that permission.
PUBLIC, SIGNED_IN, STAFF, ORGANISER = None, "signed_in", "staff", "organiser"
GUARDS = {
    "GET /edge/v1/healthz": PUBLIC,
    "GET /edge/v1/auth/status": PUBLIC,
    "POST /edge/v1/auth/login": PUBLIC,
    "GET /edge/v1/auth/me": SIGNED_IN,
    "POST /edge/v1/auth/logout": SIGNED_IN,
    "POST /edge/v1/auth/disable": ADMIN,
    "GET /edge/v1/openapi.json": STAFF,
    "GET /edge/v1/health": STAFF,
    "GET /edge/v1/disk": STAFF,
    "GET /edge/v1/clock": STAFF,
    "GET /edge/v1/sources": STAFF,
    "GET /edge/v1/sources/{name}": STAFF,
    "GET /edge/v1/sources/{name}/spans": STAFF,
    "GET /edge/v1/sources/{name}/gaps": STAFF,
    "GET /edge/v1/sources/{name}/window": STAFF,
    "GET /edge/v1/media/{name}": STAFF,
    "GET /edge/v1/live/{name}/{file}": STAFF,
    "GET /edge/v1/segments": STAFF,
    "GET /edge/v1/segments/{segment_id}": STAFF,
    "POST /edge/v1/segments/{segment_id}/verify": STAFF,
    "POST /edge/v1/segments/{segment_id}/repair": ADMIN,
    "GET /edge/v1/alerts": STAFF,
    "GET /edge/v1/events": STAFF,
    "GET /edge/v1/holds": STAFF,
    "POST /edge/v1/holds": OPERATE,
    "POST /edge/v1/alerts/{alert_id}/acknowledge": ADMIN,
    "POST /edge/v1/holds/{hold_id}/release": ADMIN,
    "GET /edge/v1/retention/plan": STAFF,
    "GET /edge/v1/sessions": STAFF,
    "POST /edge/v1/sessions": MANAGE,
    "GET /edge/v1/sessions/{session_id}": STAFF,
    "POST /edge/v1/sessions/{session_id}/end": MANAGE,
    "POST /edge/v1/sessions/{session_id}/periods": OPERATE,
    "GET /edge/v1/sessions/{session_id}/calibrations": STAFF,
    "POST /edge/v1/sessions/{session_id}/calibrations": OPERATE,
    "GET /edge/v1/sessions/{session_id}/sync-test": STAFF,
    "GET /edge/v1/incidents": STAFF,
    "POST /edge/v1/incidents": OPERATE,
    "GET /edge/v1/incidents/{incident_id}": STAFF,
    "PATCH /edge/v1/incidents/{incident_id}": OPERATE,
    "GET /edge/v1/incidents/{incident_id}/windows": STAFF,
    "POST /edge/v1/incidents/{incident_id}/review/start": REVIEW,
    "POST /edge/v1/incidents/{incident_id}/review/complete": REVIEW,
    "POST /edge/v1/incidents/{incident_id}/archive": REVIEW,
    "POST /edge/v1/incidents/{incident_id}/reopen": REVIEW,
    "GET /edge/v1/incidents/{incident_id}/audit": STAFF,
    "POST /edge/v1/incidents/{incident_id}/clips": OPERATE,
    "GET /edge/v1/jobs/{job_id}": STAFF,
    "GET /edge/v1/evidence": STAFF,
    "GET /edge/v1/evidence/{evidence_id}": ORGANISER,
    "GET /edge/v1/evidence/{evidence_id}/manifest": ORGANISER,
    "GET /edge/v1/evidence/{evidence_id}/file": ORGANISER,
    "POST /edge/v1/evidence/{evidence_id}/approve": EXPORT,
    "POST /edge/v1/evidence/{evidence_id}/withdraw": ADMIN,
    "POST /edge/v1/evidence/{evidence_id}/export": EXPORT,
    "GET /edge/v1/sessions/{session_id}/rights": STAFF,
    "POST /edge/v1/sessions/{session_id}/rights": ADMIN,
    "GET /edge/v1/report/sessions": ORGANISER,
    "GET /edge/v1/report/sessions/{session_id}": ORGANISER,
    "GET /edge/v1/audit": ADMIN,
    "GET /edge/v1/audit/verify": ADMIN,
    "GET /edge/v1/outbox": STAFF,
    "POST /edge/v1/metrics/replay": STAFF,
    "GET /edge/v1/metrics/replay": STAFF,
}
# The routes that hand out footage, evidence or a package of it, and the audit action each writes.
EXPORTS = {
    "GET /edge/v1/media/{name}": "media.accessed",
    "GET /edge/v1/evidence/{evidence_id}/file": "evidence.accessed",
    "GET /edge/v1/evidence/{evidence_id}/manifest": "evidence.manifest_accessed",
    "POST /edge/v1/evidence/{evidence_id}/export": "evidence.exported",
}
SAFE = ("GET", "HEAD", "OPTIONS")


def guard_of(route: APIRoute):
    """The guard a route's dependencies carry, read from the closures in api.py."""
    for dep in route.dependant.dependencies:
        if dep.call.__name__ == "principal":
            return SIGNED_IN
        if dep.call.__name__ == "check":
            for cell in dep.call.__closure__ or ():
                value = cell.cell_contents
                if isinstance(value, str):
                    return value
                if isinstance(value, tuple):
                    return STAFF if value == STAFF_PERMISSIONS else ORGANISER if set(value) == set(PERMISSIONS) else value
    return PUBLIC


def routes(app):
    for route in app.routes:
        if isinstance(route, APIRoute):
            for method in sorted(route.methods):
                yield f"{method} {route.path}", method, route


def may(guard, permissions) -> bool:
    if guard in (PUBLIC, SIGNED_IN):
        return True
    if guard == STAFF:
        return any(p in STAFF_PERMISSIONS for p in permissions)
    if guard == ORGANISER:
        return bool(permissions)
    return guard in permissions


def fill(path: str, **ids) -> str:
    """A concrete URL: the camera's name, an HLS file, and a guessed (or given) id for the rest."""
    path = path.replace("{name}", "ground").replace("{file}", "index.m3u8")
    return re.sub(r"\{(\w+)\}", lambda m: ids.get(m.group(1), str(uuid.uuid4())), path)


def send(client, method, url, **kw):
    return client.request(method, url, **kw)


@pytest.fixture
def keys(tmp_path):
    private, public = generate_key()
    path = tmp_path / "trusted-keys.json"
    path.write_text(json.dumps({key_id(public): {"publicKey": public, "issuer": "dev-local"}}))
    return private, path


def install_bundle(path, private, people):
    now = utcnow()
    bundle = {"schema": BUNDLE_SCHEMA, "bundleId": str(uuid.uuid4()), "issuer": "dev-local", "issuedAt": iso(now),
              "expiresAt": iso(now + timedelta(hours=36)),
              "session": {"id": OWN, "label": "Lions v Eagles", "matchId": "m-own", "mode": "shadow"},
              "members": [{"userId": f"u-{name}", "email": f"{name}@dtp.test", "name": name.title(),
                           "permissions": perms, "pinHash": hash_pin(PIN)} for name, perms in people.items()]}
    previous = path.stat().st_mtime if path.exists() else None
    path.write_text(json.dumps(sign_bundle(bundle, private)))
    if previous is not None:  # the Edge reloads a bundle when its mtime changes
        os.utime(path, (time.time(), max(time.time(), previous + 1)))


@pytest.fixture
def service(env, tmp_path, keys, fake_probe):
    private, trusted = keys
    install_bundle(tmp_path / "bundle.json", private, PEOPLE)
    env.update(FAIRPLAY_TRUSTED_KEYS_FILE=str(trusted), FAIRPLAY_BUNDLE_FILE=str(tmp_path / "bundle.json"),
               FAIRPLAY_ALLOW_DEV_BUNDLES="1", FAIRPLAY_CLOUD_SYNC_URL="https://127.0.0.1:9",
               FAIRPLAY_CLOUD_DEVICE_TOKEN=SECRET + "-cloud")
    svc = EdgeService(load_settings(env))
    svc.mediamtx = FakeMediaMtx()
    svc.watchdog.mediamtx = svc.mediamtx
    svc.cutter = FakeCutter()
    for t in range(0, 60, 10):
        write_segment(svc.settings.recordings_dir, "ground", at(t), fmp4(3))
    svc.run_once()
    svc.mediamtx.recorded["ground"] = [{"start": iso(T0), "duration": 60.0}]
    for sid, match in ((OWN, "m-own"), (OTHER, "m-other")):
        timing.create_session(svc.store, sid, match, "shadow", "u-admin", session_id=sid)
    with svc.store.tx() as db:  # both sessions were open while the footage was recorded
        db.execute("UPDATE match_sessions SET created_utc = ?", (iso(at(-60)),))
    return svc


def sign_in(app, name):
    c = TestClient(app)
    c.__enter__()
    r = c.post("/edge/v1/auth/login", json={"email": f"{name}@dtp.test", "pin": PIN})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture
def app(service):
    return create_app(service, run_loop=False)


@pytest.fixture
def clients(app):
    out = {name: sign_in(app, name) for name in PEOPLE}
    yield out
    for c in out.values():
        c.__exit__(None, None, None)


@pytest.fixture
def anon(app):
    with TestClient(app) as c:
        yield c


def other_records(service, session_id=OTHER):
    """An incident, a clip job and its evidence in the other session (or the one given), made as the Edge admin."""
    admin = Actor("u-admin", "Admin", "operator")
    inc = incidents.create(service.store, service.settings, session_id, admin, event_utc=at(40), basis="manual",
                           category="foul")
    app = create_app(service, run_loop=False)
    with TestClient(app) as c:
        assert c.post("/edge/v1/auth/login", json={"email": "admin@dtp.test", "pin": PIN}).status_code == 200
        job = c.post(f"/edge/v1/incidents/{inc['id']}/clips", headers=CSRF, json={"source": "ground"})
        assert job.status_code == 202, job.text
        assert service.run_jobs_once()
        ev = c.get(f"/edge/v1/evidence?incidentId={inc['id']}").json()[0]
    return {"session_id": session_id, "incident_id": inc["id"], "evidence_id": ev["id"], "job_id": job.json()["id"]}


# ── the matrix ───────────────────────────────────────────────────────────

def test_every_route_carries_the_guard_this_table_names(app):
    assert {key: guard_of(route) for key, _, route in routes(app)} == GUARDS


def test_only_liveness_and_sign_in_answer_without_a_sign_in(app, anon):
    forged = {"Cookie": f"fp_session={secrets.token_urlsafe(32)}"}
    guessed = {"Authorization": f"Bearer {secrets.token_hex(32)}"}
    # Made up each run, so no credential-shaped literal sits in the repository.
    basic = {"Authorization": "Basic " + base64.b64encode(f"admin:{secrets.token_hex(8)}".encode()).decode()}
    for key, method, route in routes(app):
        if GUARDS[key] is PUBLIC:
            continue
        url = fill(route.path)
        for headers in ({}, forged, guessed, basic):
            r = send(anon, method, url, headers={**CSRF, **headers})
            assert r.status_code == 401, (key, headers, r.status_code)
            assert r.json()["error"] == "unauthorised"


def test_each_person_is_refused_exactly_what_their_permissions_do_not_allow(app, clients):
    for name, perms in PEOPLE.items():
        for key, method, route in routes(app):
            if key in ("POST /edge/v1/auth/logout", "GET /edge/v1/live/{name}/{file}"):
                continue  # one signs the walker out; the other proxies to MediaMTX (refusals are checked below)
            r = send(clients[name], method, fill(route.path), headers=CSRF)
            assert r.status_code < 500, (name, key, r.status_code, r.text)
            refused = r.status_code == 403 and r.json().get("error") == "forbidden"
            assert refused != may(GUARDS[key], perms), (name, key, r.status_code, r.text)
    # The live preview, which never reaches MediaMTX for a person refused.
    assert send(clients["organiser"], "GET", "/edge/v1/live/ground/index.m3u8").status_code == 403
    assert send(clients["nobody"], "GET", "/edge/v1/live/ground/index.m3u8").status_code == 403


def test_a_permission_or_a_person_dropped_from_a_new_bundle_is_gone_at_the_next_request(service, app, clients, keys,
                                                                                        tmp_path):
    op, assessor = clients["operator"], clients["assessor"]
    flag = {"sessionId": OWN, "eventUtc": iso(at(40)), "basis": "manual", "category": "foul"}
    assert assessor.post("/edge/v1/incidents", headers=CSRF, json=flag).status_code == 201
    people = {**PEOPLE, "assessor": [REVIEW]}
    del people["operator"]
    install_bundle(tmp_path / "bundle.json", keys[0], people)
    service.reload_bundle()
    r = assessor.post("/edge/v1/incidents", headers=CSRF, json=flag)
    assert r.status_code == 403 and r.json()["error"] == "forbidden"
    assert assessor.get(f"/edge/v1/sessions/{OWN}").status_code == 200  # review is still theirs
    assert op.get("/edge/v1/auth/me").status_code == 401
    r = op.post("/edge/v1/auth/login", json={"email": "operator@dtp.test", "pin": PIN})
    assert r.status_code == 401


def test_a_disabled_person_is_signed_out_at_once(clients):
    r = clients["admin"].post("/edge/v1/auth/disable", headers=CSRF, json={"userId": "u-lead", "reason": "left the club"})
    assert r.status_code == 200
    assert clients["lead"].get("/edge/v1/health").status_code == 401


# ── requests from elsewhere ──────────────────────────────────────────────

def test_state_changing_requests_need_the_header_and_this_origin(app, clients):
    admin = clients["admin"]
    for key, method, route in routes(app):
        if method in SAFE or GUARDS[key] is PUBLIC:
            continue
        url = fill(route.path)
        r = send(admin, method, url, json={})
        assert r.status_code == 403 and r.json()["error"] == "csrf", (key, r.status_code)
        r = send(admin, method, url, json={}, headers={**CSRF, "Origin": "https://evil.example"})
        assert r.status_code == 403 and r.json()["error"] == "cross_origin", (key, r.status_code)
    assert admin.get("/edge/v1/auth/me").status_code == 200  # nothing above signed the admin out


def test_the_session_cookie_is_httponly_strict_and_not_readable_by_script(app):
    with TestClient(app) as c:
        r = c.post("/edge/v1/auth/login", json={"email": "admin@dtp.test", "pin": PIN})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/" in cookie
    assert PIN not in r.text and "pinhash" not in r.text.lower()


# ── guessed ids and other sessions ───────────────────────────────────────

def test_a_guessed_id_is_not_found_and_never_a_server_error(app, clients):
    admin = clients["admin"]
    odd = ("' OR '1'='1", "%00", "x" * 4000, "1;DROP TABLE segments")
    for key, method, route in routes(app):
        if not set(re.findall(r"\{(\w+)\}", route.path)) - {"name", "file"} or GUARDS[key] is PUBLIC:
            continue
        for value in (str(uuid.uuid4()), *odd):
            url = re.sub(r"\{(?!name\})\w+\}", value, route.path).replace("{name}", "ground")
            r = send(admin, method, url, headers=CSRF, json={})
            assert r.status_code in (404, 405, 422), (key, value, r.status_code, r.text[:200])
            assert "Traceback" not in r.text and "sqlite" not in r.text.lower()
    assert admin.get("/edge/v1/sources/nowhere").status_code == 404
    assert admin.get("/edge/v1/live/ground/..%2F..%2Fpaths%2Flist").status_code in (400, 404)


def test_another_sessions_records_look_the_same_as_records_that_do_not_exist(app, service, clients):
    other = other_records(service)
    for name in ("operator", "assessor", "lead"):
        c = clients[name]
        for key, method, route in routes(app):
            params = re.findall(r"\{(\w+)\}", route.path)
            if not params or "name" in params or not set(params) <= set(other) or GUARDS[key] is PUBLIC:
                continue
            real = send(c, method, fill(route.path, **other), headers=CSRF, json={})
            guess = send(c, method, fill(route.path), headers=CSRF, json={})
            assert real.status_code == guess.status_code, (name, key, real.status_code, real.text, guess.status_code)
            if real.status_code == 404:
                assert real.json()["message"] == guess.json()["message"], (name, key)
        # The lists filtered by the other session's ids show nothing of it.
        assert c.get(f"/edge/v1/incidents?sessionId={OTHER}").status_code == 404
        assert c.get(f"/edge/v1/evidence?incidentId={other['incident_id']}").status_code == 404
        assert OTHER not in json.dumps(c.get("/edge/v1/sessions").json())
    assert clients["admin"].get(f"/edge/v1/evidence/{other['evidence_id']}").status_code == 200
    # An organiser is not told that evidence withheld from them exists, in their session or another.
    own = other_records(service, OWN)
    org = clients["organiser"]
    for ev in (own["evidence_id"], other["evidence_id"]):
        for tail in ("", "/manifest", "/file"):
            real, guess = org.get(f"/edge/v1/evidence/{ev}{tail}"), org.get(f"/edge/v1/evidence/{uuid.uuid4()}{tail}")
            assert (real.status_code, real.json()) == (guess.status_code, guess.json()), (ev, tail)


def test_the_console_file_server_serves_only_the_console(service, tmp_path):
    console = tmp_path / "console"
    (console / "assets").mkdir(parents=True)
    (console / "index.html").write_text("<!doctype html><title>console</title>")
    (console / "assets" / "app.js").write_text("console.log(1)")
    service.settings = replace(service.settings, console_dir=console)
    app = create_app(service, run_loop=False)
    with TestClient(app) as c:
        assert c.get("/assets/app.js").text == "console.log(1)"
        for path in ("/../data/fairplay.db", "/..%2Fdata%2Ffairplay.db", "/%2e%2e/%2e%2e/etc/passwd",
                     "/assets/../../bundle.json", "/..\\bundle.json", f"/{tmp_path}/bundle.json"):
            r = c.get(path)
            # The console's own page (its routes fall back to it), or nothing.
            assert r.status_code == 404 or r.text == "<!doctype html><title>console</title>", (path, r.text[:100])
        assert c.get("/edge/v1/nowhere").status_code == 404


# ── secrets ──────────────────────────────────────────────────────────────

def test_no_secret_in_any_response_the_logs_the_tables_or_the_outbox(app, service, clients, anon, caplog):
    caplog.set_level(logging.DEBUG)
    admin = clients["admin"]
    cookies = [c.cookies.get("fp_session") for c in clients.values()]
    assert all(cookies)
    # Some work to log: a failed sign-in, an incident with a clip, a sync attempt the cloud never answers.
    anon.post("/edge/v1/auth/login", json={"email": "admin@dtp.test", "pin": "000000"})
    inc = admin.post("/edge/v1/incidents", headers=CSRF,
                     json={"sessionId": OWN, "eventUtc": iso(at(40)), "basis": "manual", "category": "foul"}).json()
    admin.post(f"/edge/v1/incidents/{inc['id']}/clips", headers=CSRF, json={"source": "ground"})
    service.run_jobs_once()
    service.sync_once()
    seen = [anon.get("/edge/v1/auth/status").text, anon.get("/edge/v1/healthz").text]
    for key, method, route in routes(app):
        if method == "GET" and "{" not in route.path and GUARDS[key] is not PUBLIC:
            seen.append(admin.get(route.path).text)
    seen.append(admin.get(f"/edge/v1/incidents/{inc['id']}/audit").text)
    tables = {t["name"]: service.store.query(f"SELECT * FROM {t['name']}")  # noqa: S608 (names from sqlite_master)
              for t in service.store.query("SELECT name FROM sqlite_master WHERE type = 'table'")}
    secrets_ = [SECRET, *cookies, service.settings.api_token, service.settings.cloud_device_token]
    # The PIN on its own: six digits inside a hash or an id are not the PIN.
    pin = re.compile(rf"(?<![0-9a-fA-F]){PIN}(?![0-9a-fA-F])")
    places = {"responses": "\n".join(seen), "logs": caplog.text,
              "tables": json.dumps(tables, default=str)}
    for where, text in places.items():
        for s in secrets_:
            assert s not in text, f"a secret is in the {where}"
        assert not pin.search(text), f"the PIN is in the {where}"
        # PIN hashes stay in the bundle file: they can be attacked offline (F16).
        assert "scrypt$" not in text, f"a PIN hash is in the {where}"


# ── exports ──────────────────────────────────────────────────────────────

def test_every_route_that_hands_out_footage_or_evidence_is_audited(app, service, clients):
    admin = clients["admin"]
    other = other_records(service)
    admin.post(f"/edge/v1/sessions/{OTHER}/rights", headers=CSRF, json={
        "footageKind": "synthetic", "status": "not_recorded", "minorsPresent": "no"})
    inc = other["incident_id"]
    assert admin.post(f"/edge/v1/incidents/{inc}/review/start", headers={**CSRF, "If-Match": "1"}).status_code == 200
    r = admin.post(f"/edge/v1/incidents/{inc}/review/complete", headers={**CSRF, "If-Match": "2"},
                   json={"result": "supports_original", "factualNotes": "Clean tackle; ball first.",
                         "onFieldDecision": "play on", "evidenceIds": [other["evidence_id"]]})
    assert r.status_code == 200, r.text
    assert admin.post(f"/edge/v1/evidence/{other['evidence_id']}/approve", headers=CSRF).status_code == 200

    async def fetched(url, params, target):
        target.write_bytes(fmp4(1))
        return 200

    app.state.fetch_window = fetched
    calls = {
        "GET /edge/v1/media/{name}": lambda: admin.get(f"/edge/v1/media/ground?start={iso(at(10))}&durationMs=5000"),
        "GET /edge/v1/evidence/{evidence_id}/file": lambda: admin.get(f"/edge/v1/evidence/{other['evidence_id']}/file"),
        "GET /edge/v1/evidence/{evidence_id}/manifest":
            lambda: admin.get(f"/edge/v1/evidence/{other['evidence_id']}/manifest"),
        "POST /edge/v1/evidence/{evidence_id}/export":
            lambda: admin.post(f"/edge/v1/evidence/{other['evidence_id']}/export", headers=CSRF),
    }
    assert set(calls) == set(EXPORTS)
    for key, call in calls.items():
        before = {e["seq"] for e in admin.get("/edge/v1/audit?limit=1000").json()}
        r = call()
        assert r.status_code == 200, (key, r.status_code, r.text[:200])
        new = [e for e in admin.get("/edge/v1/audit?limit=1000").json() if e["seq"] not in before]
        assert EXPORTS[key] in [e["action"] for e in new], (key, [e["action"] for e in new])
        assert all(e["actor_id"] == "u-admin" for e in new if e["action"] == EXPORTS[key])
    assert admin.get("/edge/v1/audit/verify").json()["ok"] is True


def test_every_route_that_serves_bytes_is_in_the_exports_table(app):
    """A route returning a file or a proxied stream must be listed (and so audited), or be the live preview."""
    servers = set()
    for key, _, route in routes(app):
        source = inspect.getsource(route.endpoint)
        if "FileResponse" in source or "_proxy(" in source:
            servers.add(key)
    assert servers - set(EXPORTS) == {"GET /edge/v1/live/{name}/{file}"}
