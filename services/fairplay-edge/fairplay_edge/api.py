"""The Edge's local API under `/edge/v1`, and the operator console at `/`.

Two ways in, both required on every route but `healthz` and `auth/status|login`:
  - an operator session cookie (`fp_session`), from email + PIN against the signed bundle
    (auth.py). State-changing requests made with the cookie must also carry
    `X-FairPlay-Request: 1`, which a cross-site form cannot send, and any `Origin` must be
    this server's own;
  - the device bearer token (`FAIRPLAY_EDGE_API_TOKEN`), for the fixtures and the Edge's own
    command line. It has every permission and no name, so it is recorded as "device".

There is no CORS middleware: a page from another origin can read nothing. MediaMTX is never
exposed: recorded windows (`/media`) and live preview (`/live`) are proxied after the same
check. The console is served with a Content-Security-Policy that allows this origin only, so
it works with no internet and cannot load anything from elsewhere.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import __version__, audit, evidence, incidents, retention, timing
from .audit import Actor
from .auth import COOKIE, CSRF_HEADER, DEVICE, IDLE_MINUTES, STAFF_PERMISSIONS, AuthError, Principal
from .mediamtx import MediaMtxUnavailable
from .naming import iso, parse_iso, utcnow
from .repair import RepairRefused, repair
from .service import EdgeService
from .store import Store

MAX_WINDOW_MS = 10 * 60 * 1000
SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")
HLS_FILE = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
REPLAY_CACHE_FILES = 60
REPLAY_CACHE_BYTES = 2 * 1024**3
# What a person signed in for one session may replay: from a while before it was opened
# (the warm-up, or a session opened late) to a while after it ended (F5).
SESSION_REPLAY_BEFORE = timedelta(hours=3)
SESSION_REPLAY_AFTER = timedelta(hours=1)
UUID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; "
       "img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; "
       "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'")


def refusal(status: int, error: str, message: str, remediation: str | None = None) -> HTTPException:
    """The same shape the cloud API's Vision routes use (`vision/shared/refusals.ts`)."""
    body = {"statusCode": status, "error": error, "message": message}
    if remediation:
        body["remediation"] = remediation
    return HTTPException(status_code=status, detail=body)


def _when(value: str, name: str) -> datetime:
    try:
        return parse_iso(value)
    except ValueError:
        raise refusal(400, "bad_timestamp", f"{name} must be RFC 3339 with a time zone, e.g. 2026-10-27T14:03:11.250Z")


class HoldIn(BaseModel):
    source: str | None = None
    fromUtc: str
    toUtc: str
    reason: str = Field(pattern="^(incident|evidence|manual)$")
    ref: str | None = Field(default=None, max_length=200)


class ReleaseIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    pin: str = Field(min_length=6, max_length=32)


class SessionIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    matchRef: str | None = Field(default=None, max_length=120)
    mode: str = Field(default="shadow", pattern="^(shadow|post_match)$")


class PeriodIn(BaseModel):
    period: str = Field(pattern="^(1|2|3|4|penalties)$")
    edge: str = Field(pattern="^(start|end)$")
    atUtc: str | None = None
    supersedes: str | None = None
    consoleAnchorUtc: str | None = None


class CalibrationIn(BaseModel):
    source: str
    referenceUtc: str
    observedIngestUtc: str
    uncertaintyMs: int = Field(ge=0, le=60_000)
    method: str
    period: str | None = None
    referenceSource: str | None = None
    evidenceSegmentId: str | None = None
    note: str | None = Field(default=None, max_length=500)
    supersedes: str | None = None


class IncidentIn(BaseModel):
    sessionId: str
    eventUtc: str | None = None
    basis: str = Field(default="operator_now", pattern="^(operator_now|period_mark|manual|sheet_event|match_clock)$")
    category: str = "other"
    note: str | None = Field(default=None, max_length=2000)
    preRollMs: int = 20_000
    postRollMs: int = 10_000
    period: str | None = None
    matchMinute: int | None = Field(default=None, ge=0, le=200)
    matchSecond: int | None = Field(default=None, ge=0, le=59)
    sheetEventId: str | None = Field(default=None, max_length=120)
    playerRef: str | None = Field(default=None, max_length=120)


class IncidentPatch(BaseModel):
    preRollMs: int | None = None
    postRollMs: int | None = None
    category: str | None = None
    note: str | None = Field(default=None, max_length=2000)
    matchMinute: int | None = Field(default=None, ge=0, le=200)
    matchSecond: int | None = Field(default=None, ge=0, le=59)
    period: str | None = None
    playerRef: str | None = Field(default=None, max_length=120)


class ReviewIn(BaseModel):
    result: str = Field(pattern="^(supports_original|supports_alternative|inconclusive|footage_unavailable)$")
    factualNotes: str = Field(min_length=3, max_length=5000)
    onFieldDecision: str | None = Field(default=None, max_length=500)
    evidenceIds: list[str] = Field(default_factory=list, max_length=20)


class ReopenIn(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)


class ClipIn(BaseModel):
    source: str


class RightsIn(BaseModel):
    footageKind: str = Field(pattern="^(synthetic|real)$")
    status: str = Field(pattern="^(not_recorded|internal_review_only|external_release_permitted)$")
    minorsPresent: str = Field(pattern="^(yes|no|unknown)$")
    basis: str | None = Field(default=None, max_length=500)
    consentReference: str | None = Field(default=None, max_length=300)


class ReplayMetricIn(BaseModel):
    source: str
    windowStartUtc: str
    durationMs: int = Field(gt=0, le=MAX_WINDOW_MS)
    toFirstFrameMs: int | None = Field(default=None, ge=0)
    toPlayableMs: int | None = Field(default=None, ge=0)
    bytes: int | None = Field(default=None, ge=0)
    outcome: str = Field(pattern="^(playable|error|no_footage|aborted)$")
    note: str | None = Field(default=None, max_length=300)


class DisableIn(BaseModel):
    userId: str
    reason: str = Field(min_length=3, max_length=300)


def create_app(service: EdgeService, *, run_loop: bool = True) -> FastAPI:
    settings = service.settings
    api_token = settings.api_token.encode()
    secure_cookie = settings.tls_cert is not None

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if run_loop:
            service.start()
        yield
        await service.stop()
        if "c" in hls_client:
            await hls_client["c"].aclose()

    # No public schema or docs: /edge/v1/openapi.json below is behind authentication.
    app = FastAPI(title="DTP FairPlay Edge", version=__version__, lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(HTTPException)
    async def _refusal(_: Request, exc: HTTPException):
        body = exc.detail if isinstance(exc.detail, dict) else {
            "statusCode": exc.status_code, "error": "error", "message": str(exc.detail)}
        return JSONResponse(body, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.middleware("http")
    async def _headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = CSP
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        if secure_cookie:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    # ── who is calling ───────────────────────────────────────────────────
    def principal(request: Request) -> Principal:
        header = request.headers.get("authorization", "")
        scheme, _, value = header.partition(" ")
        if scheme.lower() == "bearer" and value:
            # Constant time on the raw bytes; nothing to gain from hashing a random token first.
            if hmac.compare_digest(value.encode(), api_token):
                return DEVICE
            raise HTTPException(401, {"statusCode": 401, "error": "unauthorised", "message": "token not accepted"},
                                headers={"WWW-Authenticate": "Bearer"})
        cookie = request.cookies.get(COOKIE)
        who = service.sessions.resolve(cookie, service.bundle) if cookie else None
        if who is None:
            raise HTTPException(401, {"statusCode": 401, "error": "unauthorised",
                                      "message": "sign in, or present the device token"},
                                headers={"WWW-Authenticate": "Bearer"})
        if request.method not in SAFE_METHODS:
            if request.headers.get(CSRF_HEADER) != "1":
                raise refusal(403, "csrf", f"state-changing requests need the {CSRF_HEADER} header")
            origin = request.headers.get("origin")
            if origin and origin != f"{request.url.scheme}://{request.url.netloc}":
                raise refusal(403, "cross_origin", "requests from another origin are refused")
        return who

    def require(permission: str):
        def check(who: Principal = Depends(principal)) -> Principal:
            if not who.can(permission):
                raise refusal(403, "forbidden", f"this needs {permission}")
            return who
        return check

    def require_any(permissions: tuple[str, ...]):
        def check(who: Principal = Depends(principal)) -> Principal:
            if not any(who.can(p) for p in permissions):
                raise refusal(403, "forbidden", "this is for venue staff; organisers see approved evidence only")
            return who
        return check

    viewer = Depends(principal)  # anyone signed in, organisers included: only for who-am-I and sign-out
    staff = Depends(require_any(STAFF_PERMISSIONS))
    operator = Depends(require("fairplay.incident.operate"))
    reviewer = Depends(require("fairplay.incident.review"))
    exporter = Depends(require("fairplay.evidence.export"))
    organiser = Depends(require_any(("fairplay.report.view", *STAFF_PERMISSIONS)))
    manager = Depends(require("fairplay.session.manage"))
    admin = Depends(require("fairplay.edge.admin"))

    def source_or_404(name: str):
        source = settings.source(name)
        if source is None:
            raise refusal(404, "unknown_source", f"no configured source named {name!r}")
        return source

    def open_alerts(source: str | None = None) -> list[dict]:
        sql = "SELECT * FROM alerts WHERE resolved_utc IS NULL"
        params: tuple = ()
        if source is not None:
            sql += " AND source = ?"
            params = (source,)
        rows = service.store.query(sql + " ORDER BY opened_utc", params)
        for r in rows:
            r["detail"] = json.loads(r["detail"]) if r["detail"] else None
        return rows

    def last_final(source: str) -> dict | None:
        return service.store.one(
            "SELECT id, rel_path, state, start_utc, end_utc, duration_ms, bytes, sha256, finalized_utc FROM segments"
            " WHERE source = ? AND state IN ('finalized','partial','corrupt') ORDER BY start_utc DESC LIMIT 1",
            (source,),
        )

    def source_view(source) -> dict:
        snap = service.watchdog.snapshot
        status = (snap.paths or {}).get(source.name)
        state = service.store.one("SELECT * FROM source_state WHERE source = ?", (source.name,))
        publishing = bool(status and status.ready)
        return {
            "name": source.name,
            "label": source.label,
            "role": source.role,
            "required": source.required,
            "protocol": source.protocol,
            "mediamtxPath": source.name,
            "observedUtc": snap.at_utc,
            "mediaServerUp": snap.media_server_up,
            "publishing": publishing if snap.media_server_up else None,
            "publishingSince": status.ready_time if status else None,
            "stateSinceUtc": state["since_utc"] if state else None,
            "lastSeenPublishingUtc": state["last_seen_publishing_utc"] if state else None,
            "tracks": list(status.tracks) if status else [],
            "codecProps": list(status.codec_props) if status else [],
            "bytesReceived": status.bytes_received if status else None,
            **service.watchdog.recording_state(source.name, publishing),
            "lastFinalSegment": last_final(source.name),
            "openAlerts": open_alerts(source.name),
        }

    def spans_for(name: str, start: datetime | None, end: datetime | None) -> tuple[list[dict], str]:
        try:
            raw = service.mediamtx.spans(name, start, end)
            basis = "mediamtx_playback"
        except MediaMtxUnavailable:
            # MediaMTX down: the manifest still knows what was finalised.
            rows = service.store.query(
                "SELECT start_utc, duration_ms FROM segments WHERE source = ? AND duration_ms IS NOT NULL"
                " AND state IN ('finalized','partial') ORDER BY start_utc", (name,))
            raw = [{"start": r["start_utc"], "duration": r["duration_ms"] / 1000} for r in rows]
            basis = "manifest"
        out = []
        for span in raw:
            s = parse_iso(span["start"])
            e = s + timedelta(seconds=span["duration"])
            if (start and e <= start) or (end and s >= end):
                continue
            out.append({"startUtc": iso(s), "endUtc": iso(e), "durationMs": round(span["duration"] * 1000)})
        return out, basis

    def actor(who: Principal) -> str:
        return who.user_id

    def actor_of(who: Principal) -> Actor:
        return Actor(id=who.user_id, name=who.name, kind=who.kind)

    # ── which session a person may read (F5) ─────────────────────────────
    # A person reads the session their bundle was signed for, and the footage around it.
    # An Edge admin may read any session on the device, and each first read of another one
    # in an hour is in the audit chain. The device token and DEV bundles without a session
    # are not bound.
    def unbound(who: Principal) -> bool:
        return who.kind == "device" or who.bundle_session is None

    def check_session(who: Principal, session_id: str, missing: tuple[str, str] = ("unknown_session", "no such session")):
        if unbound(who) or session_id == who.bundle_session:
            return
        if who.can("fairplay.edge.admin"):
            audit.record_once(service.store, f"outside|{who.user_id}|{session_id}", actor_of(who),
                              "session.accessed_outside_bundle", "session", session_id,
                              {"bundleSession": who.bundle_session})
            return
        # The same answer as for a session that does not exist.
        raise refusal(404, *missing)

    def replay_span(who: Principal) -> tuple[datetime, datetime] | None:
        if unbound(who) or who.can("fairplay.edge.admin"):
            return None
        row = service.store.one("SELECT created_utc, ended_utc FROM match_sessions WHERE id = ?", (who.bundle_session,))
        now = utcnow()
        # Not opened here yet: the hours before now, for the rehearsal.
        opened = parse_iso(row["created_utc"]) if row else now
        closed = parse_iso(row["ended_utc"]) if row and row["ended_utc"] else now
        return opened - SESSION_REPLAY_BEFORE, closed + SESSION_REPLAY_AFTER

    def check_window(who: Principal, start: datetime, end: datetime) -> None:
        span = replay_span(who)
        if span and (start < span[0] or end > span[1]):
            raise refusal(403, "outside_session", "this footage is outside the session you are signed in for",
                          "an Edge admin can open footage from other times")

    def clamp(who: Principal, start: datetime | None, end: datetime | None):
        span = replay_span(who)
        if span is None:
            return start, end
        return max(start or span[0], span[0]), min(end or span[1], span[1])

    def incident_session(who: Principal, incident_id: str, missing: tuple[str, str] = ("not_found", "no such record")) -> dict:
        row = lifecycle(incidents.get, service.store, incident_id)
        check_session(who, row["session_id"], missing)
        return row

    # ── liveness and sign-in: no auth ────────────────────────────────────
    @app.get("/edge/v1/healthz")
    def healthz():
        return {"ok": True}

    @app.get("/edge/v1/auth/status")
    def auth_status():
        """What the sign-in page needs: is anyone able to sign in, and is it a DEV bundle. No names."""
        b = service.bundle
        return {"bundleLoaded": b is not None, "dev": b.dev if b else None,
                "expiresUtc": iso(b.expires_utc) if b else None, "sessionLabel": b.session_label if b else None,
                "problem": service.bundle_error, "device": settings.device_label, "secure": secure_cookie}

    @app.post("/edge/v1/auth/login")
    def login(body: LoginIn, request: Request, response: Response):
        try:
            token, who = service.sessions.login(service.bundle, body.email, body.pin,
                                                request.client.host if request.client else "unknown")
        except AuthError as exc:
            raise refusal(401, "sign_in_refused", str(exc))
        response.set_cookie(COOKIE, token, httponly=True, samesite="strict", secure=secure_cookie, path="/",
                            max_age=int(min(8 * 3600, (service.bundle.expires_utc - utcnow()).total_seconds())))
        return me_view(who)

    def me_view(who: Principal) -> dict:
        return {"userId": who.user_id, "email": who.email, "name": who.name, "kind": who.kind,
                "permissions": list(who.permissions), "devBundle": who.bundle_dev, "idleMinutes": IDLE_MINUTES}

    @app.get("/edge/v1/auth/me")
    def me(who: Principal = viewer):
        return me_view(who)

    @app.post("/edge/v1/auth/logout")
    def logout(response: Response, who: Principal = viewer):
        if who.session_id:
            service.sessions.revoke(who.session_id, "sign-out")
        response.delete_cookie(COOKIE, path="/")
        return {"signedOut": True}

    @app.post("/edge/v1/auth/disable")
    def disable(body: DisableIn, who: Principal = admin):
        """Offline revocation: the only way to stop a person at the venue before the bundle expires."""
        service.sessions.disable(body.userId, actor_of(who), body.reason)
        return {"disabled": body.userId}

    @app.get("/edge/v1/openapi.json")
    def openapi(_: Principal = staff):
        return app.openapi()

    # ── health ───────────────────────────────────────────────────────────
    @app.get("/edge/v1/health")
    def health(_: Principal = staff):
        snap = service.watchdog.snapshot
        alerts = open_alerts()
        worst = max((SEVERITY_RANK[a["severity"]] for a in alerts), default=-1)
        status = {-1: "ok", 0: "ok", 1: "degraded", 2: "critical"}[worst]
        if service.passes == 0:
            status = "starting"
        counts = {r["state"]: r["n"] for r in service.store.query("SELECT state, COUNT(*) AS n FROM segments GROUP BY state")}
        return {
            "status": status,
            "version": __version__,
            "device": settings.device_label,
            "observedUtc": snap.at_utc,
            "passes": service.passes,
            "lastPassError": service.last_pass_error,
            "mediaServer": {"up": snap.media_server_up, "error": snap.media_server_error},
            "disk": disk_view(),
            "clock": timing.clock_state(service.store),
            "cloud": {**service.outbox.status(service.sync_configured),
                      "uploads": service.uploader.status() if service.uploader else None,
                      "bundleRefresh": service.bundle_refresh},
            "audit": audit.head(service.store),
            "bundle": {"loaded": service.bundle is not None, "dev": service.bundle.dev if service.bundle else None,
                       "expiresUtc": iso(service.bundle.expires_utc) if service.bundle else None,
                       "problem": service.bundle_error},
            "sources": [
                {k: v[k] for k in ("name", "label", "role", "required", "publishing", "recording", "currentSegmentId",
                                   "lastFinalSegment")}
                for v in (source_view(s) for s in settings.sources)
            ],
            "segments": counts,
            "openAlerts": alerts,
        }

    def disk_view() -> dict:
        usage = shutil.disk_usage(settings.recordings_dir)
        state = "ok"
        if usage.free < settings.disk_full_free_bytes:
            state = "full"
        elif usage.free < settings.disk_hard_free_bytes:
            state = "hard_limit"
        elif usage.free < settings.disk_soft_free_bytes:
            state = "soft_limit"
        return {"freeBytes": usage.free, "totalBytes": usage.total, "softLimitFreeBytes": settings.disk_soft_free_bytes,
                "hardLimitFreeBytes": settings.disk_hard_free_bytes, "fullFreeBytes": settings.disk_full_free_bytes,
                "state": state,
                **service.watchdog.disk_outlook(usage.free)}

    def refuse_at_hard_limit(what: str) -> None:
        """Below the hard limit the space left is kept for the recordings themselves: nothing
        new that writes files is started. Nothing is deleted to make room."""
        if shutil.disk_usage(settings.recordings_dir).free < settings.disk_hard_free_bytes:
            raise refusal(507, "disk_hard_limit", f"the Edge's disk is below its hard limit: no new {what} until space is freed",
                          "an Edge admin frees space (export and remove old matches, or run retention); recording carries on until the disk is full")

    @app.get("/edge/v1/disk")
    def disk(_: Principal = staff):
        return disk_view()

    @app.get("/edge/v1/clock")
    def clock(_: Principal = staff):
        return timing.clock_state(service.store)

    # ── sources and recordings ───────────────────────────────────────────
    @app.get("/edge/v1/sources")
    def sources(_: Principal = staff):
        return [source_view(s) for s in settings.sources]

    @app.get("/edge/v1/sources/{name}")
    def source(name: str, _: Principal = staff):
        return source_view(source_or_404(name))

    @app.get("/edge/v1/sources/{name}/spans")
    def spans(name: str, start: str | None = None, end: str | None = None, who: Principal = staff):
        source_or_404(name)
        s = _when(start, "start") if start else None
        e = _when(end, "end") if end else None
        s, e = clamp(who, s, e)
        items, basis = spans_for(name, s, e)
        return {"source": name, "basis": basis, "spans": items}

    @app.get("/edge/v1/sources/{name}/gaps")
    def gaps(name: str, start: str, end: str, minGapMs: int = Query(500, ge=0), who: Principal = staff):
        source_or_404(name)
        s, e = _when(start, "start"), _when(end, "end")
        if e <= s:
            raise refusal(400, "bad_window", "end must be after start")
        check_window(who, s, e)
        items, basis = spans_for(name, s, e)
        holes, cursor = [], s
        for span in items:
            span_start, span_end = parse_iso(span["startUtc"]), parse_iso(span["endUtc"])
            if span_start - cursor >= timedelta(milliseconds=minGapMs):
                holes.append({"fromUtc": iso(cursor), "toUtc": iso(span_start),
                              "durationMs": round((span_start - cursor).total_seconds() * 1000)})
            cursor = max(cursor, span_end)
        if e - cursor >= timedelta(milliseconds=minGapMs):
            holes.append({"fromUtc": iso(cursor), "toUtc": iso(e), "durationMs": round((e - cursor).total_seconds() * 1000)})
        drops = service.store.query(
            "SELECT down_from_utc AS fromUtc, down_to_utc AS toUtc FROM feed_intervals WHERE source = ?"
            " AND down_from_utc < ? AND COALESCE(down_to_utc, ?) > ? ORDER BY down_from_utc",
            (name, iso(e), iso(e), iso(s)),
        )
        return {"source": name, "window": {"startUtc": iso(s), "endUtc": iso(e)}, "basis": basis,
                "notRecorded": holes, "observedDrops": drops}

    @app.get("/edge/v1/sources/{name}/window")
    def window(name: str, start: str, durationMs: int = Query(..., gt=0, le=MAX_WINDOW_MS), who: Principal = staff):
        """What a replay request for this window would show, and which originals it comes from."""
        source_or_404(name)
        s = _when(start, "start")
        e = s + timedelta(milliseconds=durationMs)
        check_window(who, s, e)
        items, basis = spans_for(name, s, e)
        covered = timing.coverage(items, s, e)
        segments = service.store.query(
            "SELECT id, rel_path, state, start_utc, end_utc, sha256 FROM segments WHERE source = ?"
            " AND start_utc < ? AND (end_utc IS NULL OR end_utc > ?) AND state != 'deleted' ORDER BY start_utc",
            (name, iso(e), iso(s)),
        )
        coverage = "full" if covered >= durationMs - 50 else ("none" if covered <= 0 else "partial")
        return {
            "source": name, "startUtc": iso(s), "endUtc": iso(e), "durationMs": durationMs,
            "coverage": coverage, "coveredMs": round(covered), "basis": basis, "segments": segments,
            "playbackPath": f"/edge/v1/media/{name}?start={iso(s)}&durationMs={durationMs}",
        }

    # MediaMTX groups an HLS reader's requests into a session with a cookie it sets after a
    # redirect (`?cookieCheck=1`). One long-lived client holds that cookie for the Edge, the
    # only HLS reader MediaMTX ever sees; browsers never receive it.
    hls_client: dict[str, httpx.AsyncClient] = {}

    def live_client() -> httpx.AsyncClient:
        if "c" not in hls_client:
            hls_client["c"] = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=20.0), auth=service.mediamtx.auth,
                                                follow_redirects=True, max_redirects=3)
        return hls_client["c"]

    async def _proxy(url: str, params: dict | None, not_found: tuple[str, str], timeout_read: float = 60.0,
                     shared: httpx.AsyncClient | None = None):
        client = shared or httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=timeout_read), auth=service.mediamtx.auth)

        async def close_client():
            if shared is None:
                await client.aclose()

        try:
            upstream = await client.send(client.build_request("GET", url, params=params), stream=True)
        except httpx.HTTPError as exc:
            await close_client()
            raise refusal(503, "media_server_unavailable", f"MediaMTX unreachable: {exc.__class__.__name__}")
        if upstream.status_code != 200:
            text = (await upstream.aread()).decode(errors="replace")[:200]
            await upstream.aclose()
            await close_client()
            if upstream.status_code == 404:
                raise refusal(404, *not_found)
            raise refusal(502, "media_server_error", f"MediaMTX returned {upstream.status_code}: {text}")

        async def body():
            try:
                async for chunk in upstream.aiter_bytes():
                    yield chunk
            finally:
                await upstream.aclose()
                await close_client()

        headers = {"Cache-Control": "no-store"}
        if "content-length" in upstream.headers:
            headers["Content-Length"] = upstream.headers["content-length"]
        return StreamingResponse(body(), media_type=upstream.headers.get("content-type", "application/octet-stream"),
                                 headers=headers)

    # Replay windows are fetched whole into a bounded cache and served from disk, because a
    # browser can only seek a video whose server answers byte-range requests, and MediaMTX's
    # /get streams without them. The cache holds copies of recordings, so it lives in the data
    # volume beside them, never in memory-backed /tmp, and is pruned oldest-first.
    cache_dir = settings.data_dir / "replay-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    async def fetch_window(url: str, params: dict, target) -> int:
        """Fetch MediaMTX's /get output into `target`; return the HTTP status."""
        tmp = target.with_suffix(f".{secrets.token_hex(4)}.part")
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=60.0), auth=service.mediamtx.auth) as client:
            async with client.stream("GET", url, params=params) as upstream:
                if upstream.status_code != 200:
                    return upstream.status_code
                with tmp.open("wb") as fh:
                    async for chunk in upstream.aiter_bytes():
                        fh.write(chunk)
        tmp.replace(target)
        return 200

    app.state.fetch_window = fetch_window

    def prune_cache() -> None:
        files = sorted(cache_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
        total = 0
        for i, f in enumerate(files):
            total += f.stat().st_size
            if i >= REPLAY_CACHE_FILES or total > REPLAY_CACHE_BYTES:
                f.unlink(missing_ok=True)

    # One audit entry per person, source and window an hour (audit.record_once, kept in the
    # database so a restart does not forget what was already written).
    def note_access(who: Principal, source: str, start: datetime, duration_ms: int) -> None:
        audit.record_once(service.store, f"media|{who.user_id}|{source}|{iso(start)}|{duration_ms}", actor_of(who),
                          "media.accessed", "source", source, {"startUtc": iso(start), "durationMs": duration_ms})

    @app.get("/edge/v1/media/{name}")
    async def media(name: str, start: str, durationMs: int = Query(..., gt=0, le=MAX_WINDOW_MS), who: Principal = staff):
        source_or_404(name)
        s = _when(start, "start")
        end = s + timedelta(milliseconds=durationMs)
        check_window(who, s, end)
        note_access(who, name, s, durationMs)
        # A window reaching into the last seconds may still be growing: never reuse it.
        fresh = end > utcnow() - timedelta(seconds=10)
        key = hashlib.sha256(f"{name}|{iso(s)}|{durationMs}|{utcnow().timestamp() if fresh else ''}".encode()).hexdigest()[:32]
        target = cache_dir / f"{key}.mp4"
        if not target.exists():
            url, params = service.mediamtx.get_url(name, s, durationMs / 1000)
            try:
                status = await app.state.fetch_window(url, params, target)
            except httpx.HTTPError as exc:
                raise refusal(503, "media_server_unavailable", f"MediaMTX playback unreachable: {exc.__class__.__name__}")
            if status == 404:
                raise refusal(404, "no_recording", "no recording covers this window", "check /spans or /gaps")
            if status != 200:
                raise refusal(502, "media_server_error", f"MediaMTX playback returned {status}")
            prune_cache()
        else:
            target.touch()
        return FileResponse(target, media_type="video/mp4", headers={"Cache-Control": "no-store"})

    @app.get("/edge/v1/live/{name}/{file}")
    async def live(name: str, file: str, session: str | None = Query(None, pattern=UUID_PATTERN), _: Principal = staff):
        """Live preview: MediaMTX's HLS playlists and fMP4 parts, proxied after authorisation.
        MediaMTX names its HLS session in `?session=`; that one parameter is passed through."""
        source_or_404(name)
        if not HLS_FILE.match(file) or ".." in file:
            raise refusal(400, "bad_name", "not an HLS file name")
        return await _proxy(f"{settings.mediamtx_hls_url}/{name}/{file}", {"session": session} if session else None,
                            ("not_live", "this source is not publishing"), shared=live_client())

    # ── segments ─────────────────────────────────────────────────────────
    @app.get("/edge/v1/segments")
    def segments(source: str | None = None, state: str | None = None, start: str | None = None,
                 end: str | None = None, limit: int = Query(100, ge=1, le=500), after: str | None = None,
                 who: Principal = staff):
        sql = ("SELECT id, source, rel_path, state, start_utc, end_utc, duration_ms, bytes, complete_bytes, sha256,"
               " codec, width, height, fps, finalized_utc, verified_utc, deleted_utc FROM segments WHERE 1=1")
        params: list = []
        if source:
            source_or_404(source)
            sql += " AND source = ?"
            params.append(source)
        if state:
            sql += " AND state = ?"
            params.append(state)
        lo, hi = clamp(who, _when(start, "start") if start else None, _when(end, "end") if end else None)
        if lo:
            sql += " AND COALESCE(end_utc, start_utc) > ?"
            params.append(iso(lo))
        if hi:
            sql += " AND start_utc < ?"
            params.append(iso(hi))
        if after:
            cursor_start, _sep, cursor_id = after.partition("|")
            sql += " AND (start_utc, id) > (?, ?)"
            params += [cursor_start, cursor_id]
        rows = service.store.query(sql + " ORDER BY start_utc, id LIMIT ?", (*params, limit + 1))
        more = len(rows) > limit
        rows = rows[:limit]
        return {"items": rows, "next": f"{rows[-1]['start_utc']}|{rows[-1]['id']}" if more else None}

    def segment_in_span(who: Principal, segment_id: str) -> None:
        span = replay_span(who)
        row = service.store.one("SELECT start_utc, end_utc FROM segments WHERE id = ?", (segment_id,))
        if row is None or (span and (parse_iso(row["start_utc"]) >= span[1]
                                     or parse_iso(row["end_utc"] or row["start_utc"]) <= span[0])):
            raise refusal(404, "unknown_segment", "no such segment")

    @app.get("/edge/v1/segments/{segment_id}")
    def segment(segment_id: str, who: Principal = staff):
        segment_in_span(who, segment_id)
        try:
            return service.scanner.manifest_for(segment_id)
        except KeyError:
            raise refusal(404, "unknown_segment", "no such segment")

    @app.post("/edge/v1/segments/{segment_id}/verify")
    def verify(segment_id: str, who: Principal = staff):
        segment_in_span(who, segment_id)
        try:
            return service.scanner.verify(segment_id)
        except KeyError:
            raise refusal(404, "unknown_segment", "no such segment")

    @app.post("/edge/v1/segments/{segment_id}/repair")
    def repair_segment(segment_id: str, who: Principal = admin):
        refuse_at_hard_limit("repaired copies")
        try:
            return repair(settings, service.store, service.scanner, segment_id, actor_of(who))
        except KeyError:
            raise refusal(404, "unknown_segment", "no such segment")
        except RepairRefused as exc:
            raise refusal(409, "repair_refused", str(exc))

    # ── alerts, events ───────────────────────────────────────────────────
    @app.get("/edge/v1/alerts")
    def alerts(state: str = Query("open", pattern="^(open|all)$"), limit: int = Query(200, ge=1, le=1000),
               _: Principal = staff):
        if state == "open":
            return open_alerts()
        rows = service.store.query("SELECT * FROM alerts ORDER BY opened_utc DESC LIMIT ?", (limit,))
        for r in rows:
            r["detail"] = json.loads(r["detail"]) if r["detail"] else None
        return rows

    @app.get("/edge/v1/events")
    def events(limit: int = Query(200, ge=1, le=1000), after: int = 0, _: Principal = staff):
        rows = service.store.query("SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?", (after, limit))
        for r in rows:
            r["detail"] = json.loads(r["detail"]) if r["detail"] else None
        return rows

    # ── holds and retention ──────────────────────────────────────────────
    @app.get("/edge/v1/holds")
    def holds(active: bool = True, _: Principal = staff):
        sql = "SELECT * FROM holds" + (" WHERE released_utc IS NULL" if active else "") + " ORDER BY from_utc"
        return service.store.query(sql)

    @app.post("/edge/v1/holds", status_code=201)
    def create_hold(body: HoldIn, who: Principal = operator):
        if body.source is not None:
            source_or_404(body.source)
        try:
            return retention.create_hold(service.store, body.source, _when(body.fromUtc, "fromUtc"),
                                         _when(body.toUtc, "toUtc"), body.reason, body.ref, actor_of(who))
        except ValueError as exc:
            raise refusal(400, "bad_hold", str(exc))

    @app.post("/edge/v1/alerts/{alert_id}/acknowledge")
    def acknowledge(alert_id: str, body: ReleaseIn, who: Principal = admin):
        """An admin confirms a camera's new publisher address is the camera's (and not someone
        publishing in its place). Only that alert waits for a person; the others clear themselves."""
        row = service.store.one("SELECT * FROM alerts WHERE id = ? AND resolved_utc IS NULL", (alert_id,))
        if row is None:
            raise refusal(404, "unknown_alert", "no such open alert")
        if row["kind"] != "publisher_address_changed":
            raise refusal(409, "not_acknowledgeable", "this alert clears itself when its cause is gone")
        detail = json.loads(row["detail"])
        at = iso(utcnow())
        with service.store.tx() as db:
            db.execute("UPDATE alerts SET resolved_utc = ? WHERE id = ? AND resolved_utc IS NULL", (at, alert_id))
            Store.log_event(db, at, "source.publisher_address", None,
                            {"source": row["source"], "address": detail["address"], "accepted": True, "by": who.user_id})
            audit.append(db, actor_of(who), "alert.acknowledged", "alert", alert_id, None,
                         {"kind": row["kind"], "source": row["source"], "address": detail["address"], "reason": body.reason})
        return service.store.one("SELECT * FROM alerts WHERE id = ?", (alert_id,))

    @app.post("/edge/v1/holds/{hold_id}/release")
    def release(hold_id: str, body: ReleaseIn, who: Principal = admin):
        released = retention.release_hold(service.store, hold_id, body.reason, actor_of(who))
        if released is None:
            raise refusal(404, "unknown_hold", "no such active hold")
        return released

    @app.get("/edge/v1/retention/plan")
    def retention_plan(days: int | None = Query(None, ge=1), _: Principal = staff):
        chosen = days or settings.retention_days
        if chosen is None:
            raise refusal(400, "retention_off", "retention is off; pass ?days=N to preview a rule",
                          "set FAIRPLAY_RETENTION_DAYS only after the organiser agrees a period")
        rows = retention.plan(service.store, chosen)
        return {"enabled": settings.retention_days is not None, "days": chosen, "now": iso(utcnow()),
                "wouldDelete": [{k: r[k] for k in ("id", "source", "rel_path", "state", "start_utc", "end_utc")}
                                for r in rows]}

    # ── match sessions and the time model ────────────────────────────────
    def session_or_404(session_id: str) -> dict:
        try:
            return timing.get_session(service.store, session_id)
        except KeyError:
            raise refusal(404, "unknown_session", "no such session")

    def timing_call(fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except KeyError:
            raise refusal(404, "not_found", "no such record")
        except timing.Conflict as exc:
            raise refusal(409, "conflict", str(exc))
        except timing.TimingError as exc:
            raise refusal(400, "invalid", str(exc))

    @app.get("/edge/v1/sessions")
    def list_sessions(who: Principal = staff):
        if unbound(who) or who.can("fairplay.edge.admin"):
            return service.store.query("SELECT * FROM match_sessions ORDER BY created_utc DESC")
        return service.store.query("SELECT * FROM match_sessions WHERE id = ?", (who.bundle_session,))

    @app.post("/edge/v1/sessions", status_code=201)
    def new_session(body: SessionIn, who: Principal = manager):
        refuse_at_hard_limit("sessions")
        b = service.bundle
        if b is not None and b.issuer == "dtp-cloud" and b.session_id:
            # The cloud provisioned this session for this device: its id, match and mode are
            # the cloud's, and the cloud accepts no other session from this Edge.
            if body.matchRef not in (None, b.match_ref) or body.mode != (b.session_mode or body.mode):
                raise refusal(409, "conflict", "the signed bundle fixes this session's match and mode")
            row = timing_call(timing.create_session, service.store, body.label, b.match_ref, b.session_mode or body.mode,
                              actor(who), session_id=b.session_id)
            audit.record(service.store, actor_of(who), "session.opened_from_bundle", "session", b.session_id, None,
                         {"bundleId": b.bundle_id, "matchId": b.match_ref})
            return row
        return timing_call(timing.create_session, service.store, body.label, body.matchRef, body.mode, actor(who))

    @app.get("/edge/v1/sessions/{session_id}")
    def session(session_id: str, who: Principal = staff):
        check_session(who, session_id)
        row = session_or_404(session_id)
        return {**row, "periods": timing.current_periods(service.store, session_id),
                "calibration": timing.calibration_view(service.store, settings, session_id, spans_for),
                "clock": timing.clock_state(service.store)}

    @app.post("/edge/v1/sessions/{session_id}/end")
    def end(session_id: str, who: Principal = manager):
        check_session(who, session_id)
        return timing_call(timing.end_session, service.store, session_id, actor(who))

    @app.post("/edge/v1/sessions/{session_id}/periods", status_code=201)
    def period(session_id: str, body: PeriodIn, who: Principal = operator):
        check_session(who, session_id)
        at = _when(body.atUtc, "atUtc") if body.atUtc else None
        return timing_call(timing.mark_period, service.store, session_id, body.period, body.edge, actor(who),
                           at=at, supersedes=body.supersedes, console_anchor=body.consoleAnchorUtc)

    @app.get("/edge/v1/sessions/{session_id}/calibrations")
    def calibrations(session_id: str, who: Principal = staff):
        check_session(who, session_id)
        session_or_404(session_id)
        return {"current": timing.calibration_view(service.store, settings, session_id, spans_for),
                "history": service.store.query("SELECT * FROM calibrations WHERE session_id = ? ORDER BY created_utc",
                                               (session_id,))}

    @app.post("/edge/v1/sessions/{session_id}/calibrations", status_code=201)
    def calibrate(session_id: str, body: CalibrationIn, who: Principal = operator):
        check_session(who, session_id)
        return timing_call(timing.calibrate, service.store, settings, session_id, body.source,
                           _when(body.referenceUtc, "referenceUtc"), _when(body.observedIngestUtc, "observedIngestUtc"),
                           body.uncertaintyMs, body.method, actor(who), period=body.period,
                           reference_source=body.referenceSource, evidence_segment_id=body.evidenceSegmentId,
                           note=body.note, supersedes=body.supersedes)

    @app.get("/edge/v1/sessions/{session_id}/sync-test")
    def sync(session_id: str, at: str, halfWidthMs: int = Query(2000, ge=200, le=30_000), who: Principal = staff):
        check_session(who, session_id)
        return timing_call(timing.sync_test, service.store, settings, session_id, _when(at, "at"), spans_for,
                           halfWidthMs)

    # ── incidents and reviews ────────────────────────────────────────────
    def lifecycle(fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except (KeyError, incidents.NotFound):
            raise refusal(404, "not_found", "no such record")
        except timing.Conflict as exc:
            raise refusal(409, "conflict", str(exc), "reload, check what changed, and try again")
        except timing.TimingError as exc:
            raise refusal(400, "invalid", str(exc))
        except evidence.ClipFailed as exc:
            raise refusal(409, exc.code, str(exc))

    def version_of(if_match: str) -> int:
        try:
            return int(if_match.strip('"'))
        except ValueError:
            raise refusal(400, "bad_if_match", "If-Match must be the incident's version number")

    def once(key: str | None, who: Principal, route: str, body: dict, status: int, fn) -> JSONResponse:
        """Run `fn` at most once per Idempotency-Key: a repeat gets the first answer back."""
        if key is None:
            return JSONResponse(fn(), status_code=status)
        if not re.match(r"^[A-Za-z0-9_-]{8,80}$", key):
            raise refusal(400, "bad_idempotency_key", "Idempotency-Key must be 8-80 letters, digits, - or _")
        try:
            seen = incidents.claim_request(service.store, key, who.user_id, route, body)
        except timing.Conflict as exc:
            raise refusal(409, "idempotency_conflict", str(exc))
        if seen is not None:
            return JSONResponse(seen["body"], status_code=seen["status"], headers={"Idempotent-Replayed": "true"})
        try:
            result = fn()
        except BaseException:
            incidents.finish_request(service.store, key, 0, None)
            raise
        incidents.finish_request(service.store, key, status, result)
        return JSONResponse(result, status_code=status)

    @app.get("/edge/v1/incidents")
    def list_incidents(sessionId: str, who: Principal = staff):
        check_session(who, sessionId)
        session_or_404(sessionId)
        return [incidents.view(r) for r in
                service.store.query("SELECT * FROM incidents WHERE session_id = ? ORDER BY event_utc DESC", (sessionId,))]

    @app.post("/edge/v1/incidents", status_code=201)
    def flag(body: IncidentIn, who: Principal = operator,
             idempotency_key: str | None = Header(None, alias="Idempotency-Key")):
        check_session(who, body.sessionId)

        def run():
            event = _when(body.eventUtc, "eventUtc") if body.eventUtc else None
            return lifecycle(incidents.create, service.store, settings, body.sessionId, actor_of(who), event_utc=event,
                             basis=body.basis if (body.eventUtc or body.basis in ("match_clock", "sheet_event"))
                             else "operator_now",
                             category=body.category, note=body.note, pre_roll_ms=body.preRollMs,
                             post_roll_ms=body.postRollMs, period=body.period, match_minute=body.matchMinute,
                             match_second=body.matchSecond, sheet_event_id=body.sheetEventId, player_ref=body.playerRef)
        return once(idempotency_key, who, "incidents.create", body.model_dump(), 201, run)

    @app.get("/edge/v1/incidents/{incident_id}")
    def incident_detail(incident_id: str, who: Principal = staff):
        row = incident_session(who, incident_id)
        return {**row, "reviews": incidents.reviews(service.store, incident_id),
                "evidence": [evidence.evidence_view(e) for e in service.store.query(
                    "SELECT * FROM evidence WHERE incident_id = ? ORDER BY created_utc", (incident_id,))],
                "jobs": service.store.query("SELECT * FROM jobs WHERE incident_id = ? ORDER BY created_utc",
                                            (incident_id,)),
                "rights": incidents.current_rights(service.store, row["session_id"])}

    @app.patch("/edge/v1/incidents/{incident_id}")
    def patch_incident(incident_id: str, body: IncidentPatch, if_match: str = Header(..., alias="If-Match"),
                       who: Principal = operator):
        incident_session(who, incident_id)
        changes = {k: v for k, v in {
            "pre_roll_ms": body.preRollMs, "post_roll_ms": body.postRollMs, "category": body.category,
            "note": body.note, "match_minute": body.matchMinute, "match_second": body.matchSecond,
            "period": body.period, "player_ref": body.playerRef}.items() if v is not None}
        return lifecycle(incidents.edit, service.store, settings, incident_id, version_of(if_match), actor_of(who),
                         changes)

    @app.get("/edge/v1/incidents/{incident_id}/windows")
    def windows(incident_id: str, who: Principal = staff):
        incident_session(who, incident_id)
        return timing_call(timing.incident_windows, service.store, settings, incident_id, spans_for)

    @app.post("/edge/v1/incidents/{incident_id}/review/start")
    def review_start(incident_id: str, if_match: str = Header(..., alias="If-Match"), who: Principal = reviewer):
        incident_session(who, incident_id)
        return lifecycle(incidents.start_review, service.store, incident_id, version_of(if_match), actor_of(who))

    @app.post("/edge/v1/incidents/{incident_id}/review/complete")
    def review_complete(incident_id: str, body: ReviewIn, if_match: str = Header(..., alias="If-Match"),
                        who: Principal = reviewer):
        incident_session(who, incident_id)
        # What each camera shows is judged here, not taken from the browser.
        shown = timing_call(timing.incident_windows, service.store, settings, incident_id, spans_for)
        states = {w["source"]: w["state"] for w in shown["perSource"]}
        return lifecycle(incidents.complete_review, service.store, incident_id, version_of(if_match), actor_of(who),
                         result=body.result, factual_notes=body.factualNotes, on_field_decision=body.onFieldDecision,
                         evidence_ids=body.evidenceIds, footage_states=states)

    @app.post("/edge/v1/incidents/{incident_id}/archive")
    def archive(incident_id: str, if_match: str = Header(..., alias="If-Match"), who: Principal = reviewer):
        incident_session(who, incident_id)
        return lifecycle(incidents.archive, service.store, incident_id, version_of(if_match), actor_of(who))

    @app.post("/edge/v1/incidents/{incident_id}/reopen")
    def reopen(incident_id: str, body: ReopenIn, if_match: str = Header(..., alias="If-Match"),
               who: Principal = reviewer):
        incident_session(who, incident_id)
        return lifecycle(incidents.reopen, service.store, incident_id, version_of(if_match), actor_of(who), body.reason)

    @app.get("/edge/v1/incidents/{incident_id}/audit")
    def incident_audit(incident_id: str, who: Principal = staff):
        incident_session(who, incident_id)
        return audit.for_incident(service.store, incident_id)

    # ── evidence ─────────────────────────────────────────────────────────
    @app.post("/edge/v1/incidents/{incident_id}/clips")
    def request_clip(incident_id: str, body: ClipIn, who: Principal = operator):
        incident_session(who, incident_id)
        source_or_404(body.source)
        refuse_at_hard_limit("clips")
        job, created = lifecycle(evidence.request_clip, service.store, settings, incident_id, body.source, actor_of(who))
        return JSONResponse(job, status_code=202 if created else 200)

    @app.get("/edge/v1/jobs/{job_id}")
    def job(job_id: str, who: Principal = staff):
        row = service.store.one("SELECT * FROM jobs WHERE id = ?", (job_id,))
        if row is None:
            raise refusal(404, "not_found", "no such job")
        # Another session's job gets the answer a guessed id gets.
        incident_session(who, row["incident_id"], ("not_found", "no such job"))
        return row

    def evidence_or_404(evidence_id: str, who: Principal) -> dict:
        row = lifecycle(evidence.get, service.store, evidence_id)
        check_session(who, row["session_id"], ("not_found", "no such record"))  # what a guessed id gets
        return row

    def readable(who: Principal, row: dict) -> str:
        """'staff', or 'organiser' when only released evidence may be read; refuses otherwise."""
        if any(who.can(p) for p in STAFF_PERMISSIONS):
            return "staff"
        ok, why = evidence.released(service.store, row)
        if not ok:
            # Not 403, and the words a guessed id gets: an organiser is not told that withheld evidence exists.
            raise refusal(404, "not_found", "no such record")
        return "organiser"

    @app.get("/edge/v1/evidence")
    def list_evidence(incidentId: str, who: Principal = staff):
        incident_session(who, incidentId)
        rows = service.store.query("SELECT * FROM evidence WHERE incident_id = ? ORDER BY created_utc", (incidentId,))
        return [{**evidence.evidence_view(r), "release": dict(zip(("allowed", "reason"),
                                                                 evidence.released(service.store, r)))} for r in rows]

    @app.get("/edge/v1/evidence/{evidence_id}")
    def evidence_detail(evidence_id: str, who: Principal = organiser):
        row = evidence_or_404(evidence_id, who)
        readable(who, row)
        return row

    @app.get("/edge/v1/evidence/{evidence_id}/manifest")
    def evidence_manifest(evidence_id: str, who: Principal = organiser):
        row = evidence_or_404(evidence_id, who)
        as_role = readable(who, row)
        lifecycle(evidence.verify_file, service.store, settings, row)
        # One request, one file: every manifest download is in the chain (F8).
        audit.record(service.store, actor_of(who), "evidence.manifest_accessed", "evidence", evidence_id, None,
                     {"as": as_role, "manifestSha256": row["manifest_sha256"]})
        return FileResponse(evidence.path_of(settings, row, "manifest_rel_path"), media_type="application/json")

    @app.get("/edge/v1/evidence/{evidence_id}/file")
    def evidence_file(evidence_id: str, who: Principal = organiser):
        row = evidence_or_404(evidence_id, who)
        as_role = readable(who, row)
        path = evidence.path_of(settings, row)
        if not path.exists():
            raise refusal(409, "evidence_missing", "the evidence file is missing from this Edge")
        audit.record_once(service.store, f"evidence|{who.user_id}|{evidence_id}", actor_of(who), "evidence.accessed",
                          "evidence", evidence_id, {"as": as_role, "sha256": row["sha256"]})
        return FileResponse(path, media_type="video/mp4")

    @app.post("/edge/v1/evidence/{evidence_id}/approve")
    def approve_evidence(evidence_id: str, who: Principal = exporter):
        evidence_or_404(evidence_id, who)
        return lifecycle(evidence.approve, service.store, settings, evidence_id, actor_of(who))

    @app.post("/edge/v1/evidence/{evidence_id}/export")
    def export_evidence(evidence_id: str, who: Principal = exporter):
        row = evidence_or_404(evidence_id, who)
        refuse_at_hard_limit("exports")
        ok, why = evidence.released(service.store, row)
        if not ok:
            raise refusal(409, "not_released", why, "approve it once the finding is complete and rights are recorded")
        path, digest = lifecycle(evidence.export_package, service.store, settings, row, actor_of(who),
                                 settings.data_dir / "exports")
        return FileResponse(path, media_type="application/zip", filename=path.name,
                            headers={"X-Package-SHA256": digest})

    # ── rights, the organiser's report, audit and sync ───────────────────
    @app.get("/edge/v1/sessions/{session_id}/rights")
    def rights(session_id: str, who: Principal = staff):
        check_session(who, session_id)
        session_or_404(session_id)
        current = incidents.current_rights(service.store, session_id)
        ok, why = incidents.release_check(current)
        return {"current": current, "externalRelease": {"allowed": ok, "reason": why},
                "history": service.store.query("SELECT * FROM session_rights WHERE session_id = ? ORDER BY created_utc",
                                               (session_id,))}

    @app.post("/edge/v1/sessions/{session_id}/rights", status_code=201)
    def record_rights(session_id: str, body: RightsIn, who: Principal = admin):
        check_session(who, session_id)
        session_or_404(session_id)
        return lifecycle(incidents.record_rights, service.store, session_id, actor_of(who),
                         footage_kind=body.footageKind, status=body.status, minors_present=body.minorsPresent,
                         basis=body.basis, consent_reference=body.consentReference)

    @app.get("/edge/v1/report/sessions")
    def report_sessions(who: Principal = organiser):
        sql = "SELECT id, label, match_ref, mode, created_utc, ended_utc FROM match_sessions"
        if unbound(who) or who.can("fairplay.edge.admin"):
            return service.store.query(sql + " ORDER BY created_utc DESC")
        return service.store.query(sql + " WHERE id = ?", (who.bundle_session,))

    @app.get("/edge/v1/report/sessions/{session_id}")
    def report(session_id: str, who: Principal = organiser):
        """What an organiser may see: completed findings and the evidence released with them."""
        check_session(who, session_id)
        session = session_or_404(session_id)
        out = []
        for inc in service.store.query("SELECT * FROM incidents WHERE session_id = ? AND state IN ('reviewed','archived')"
                                       " ORDER BY event_utc", (session_id,)):
            finding = service.store.one("SELECT result, factual_notes, on_field_decision, completed_at, reviewer_name"
                                        " FROM reviews WHERE id = ?", (inc["current_review_id"],))
            released = [evidence.evidence_view(e) for e in service.store.query(
                "SELECT * FROM evidence WHERE incident_id = ? AND state = 'approved'", (inc["id"],))
                if evidence.released(service.store, e)[0]]
            out.append({"incidentId": inc["id"], "period": inc["period"], "matchMinute": inc["match_minute"],
                        "matchSecond": inc["match_second"], "category": inc["category"], "finding": finding,
                        "evidence": [{k: e[k] for k in ("id", "source", "sha256", "bytes", "duration_ms",
                                                        "coverage", "footage_kind")} for e in released]})
        return {"session": {k: session[k] for k in ("id", "label", "match_ref", "mode")},
                "authorityMode": "shadow",
                "note": "Shadow review only: these findings did not and cannot change any decision in the match.",
                "incidents": out}

    @app.get("/edge/v1/audit")
    def audit_entries(after: int = 0, limit: int = Query(200, ge=1, le=1000), _: Principal = admin):
        return audit.entries(service.store, after=after, limit=limit)

    @app.get("/edge/v1/audit/verify")
    def audit_verify(_: Principal = admin):
        return audit.verify(service.store)

    @app.get("/edge/v1/outbox")
    def outbox_view(_: Principal = staff):
        status = service.outbox.status(service.sync_configured)
        parked = service.store.query("SELECT seq, idempotency_key, entity_type, result, last_error FROM outbox"
                                     " WHERE state = 'parked' ORDER BY seq")
        return {**status, "parkedItems": parked}

    # ── measured replay latency ──────────────────────────────────────────
    @app.post("/edge/v1/metrics/replay", status_code=201)
    def record_replay(body: ReplayMetricIn, who: Principal = staff):
        source_or_404(body.source)
        with service.store.tx() as db:
            db.execute("INSERT INTO replay_metrics (at_utc, user_id, source, window_start_utc, duration_ms,"
                       " to_first_frame_ms, to_playable_ms, bytes, outcome, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       (iso(utcnow()), who.user_id, body.source, body.windowStartUtc, body.durationMs,
                        body.toFirstFrameMs, body.toPlayableMs, body.bytes, body.outcome, body.note))
        return {"recorded": True}

    @app.get("/edge/v1/metrics/replay")
    def replay_summary(since: str | None = None, _: Principal = staff):
        return timing.replay_summary(service.store, iso(_when(since, "since")) if since else None)

    # ── the console ──────────────────────────────────────────────────────
    console = settings.console_dir
    if console is not None:
        root = console.resolve()

        @app.get("/{path:path}", include_in_schema=False)
        def console_files(path: str):
            if path.startswith("edge/"):
                raise refusal(404, "not_found", "no such route")
            target = (root / path).resolve() if path else root / "index.html"
            if path and target.is_file() and root in target.parents:
                cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-store"
                return FileResponse(target, headers={"Cache-Control": cache})
            index = root / "index.html"
            if not index.is_file():
                raise refusal(404, "console_missing", "the console has not been built",
                              "run `pnpm --filter @dtp/fairplay-console build`")
            return FileResponse(index, headers={"Cache-Control": "no-store"})

    return app
