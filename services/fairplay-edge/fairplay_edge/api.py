"""The Edge's local API, under `/edge/v1`.

Every route except `/edge/v1/healthz` (liveness, no data) needs `Authorization: Bearer
<FAIRPLAY_EDGE_API_TOKEN>`. There is no CORS middleware, so a browser page from another
origin cannot read anything; the console arrives in Phase 2 on this same origin. MediaMTX's
playback server is never exposed: `/media/...` proxies it after the token check.

Phase 1's token is a single scoped device secret. Phase 2 replaces it for people with the
signed operator bundle and PIN sign-in (ADR-0005); the token remains for the fixtures.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import __version__, retention
from .mediamtx import MediaMtxUnavailable
from .naming import iso, parse_iso, utcnow
from .repair import RepairRefused, repair
from .service import EdgeService

MAX_WINDOW_MS = 10 * 60 * 1000
SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}


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


def create_app(service: EdgeService, *, run_loop: bool = True) -> FastAPI:
    settings = service.settings
    token_digest = hashlib.sha256(settings.api_token.encode()).digest()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if run_loop:
            service.start()
        yield
        await service.stop()

    # No public schema or docs: /edge/v1/openapi.json below is behind the token.
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
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    def authorised(request: Request) -> None:
        header = request.headers.get("authorization", "")
        scheme, _, value = header.partition(" ")
        if scheme.lower() != "bearer" or not value:
            raise HTTPException(401, {"statusCode": 401, "error": "unauthorised", "message": "bearer token required"},
                                headers={"WWW-Authenticate": "Bearer"})
        if not hmac.compare_digest(hashlib.sha256(value.encode()).digest(), token_digest):
            raise HTTPException(401, {"statusCode": 401, "error": "unauthorised", "message": "token not accepted"},
                                headers={"WWW-Authenticate": "Bearer"})

    auth = [Depends(authorised)]

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
        row = service.store.one(
            "SELECT id, rel_path, state, start_utc, end_utc, duration_ms, bytes, sha256, finalized_utc FROM segments"
            " WHERE source = ? AND state IN ('finalized','partial','corrupt') ORDER BY start_utc DESC LIMIT 1",
            (source,),
        )
        return row

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

    # ── liveness: no data, no auth ───────────────────────────────────────
    @app.get("/edge/v1/healthz")
    def healthz():
        return {"ok": True}

    @app.get("/edge/v1/openapi.json", dependencies=auth)
    def openapi():
        return app.openapi()

    # ── health ───────────────────────────────────────────────────────────
    @app.get("/edge/v1/health", dependencies=auth)
    def health():
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
            "disk": disk(),
            "sources": [
                {k: v[k] for k in ("name", "role", "required", "publishing", "recording", "currentSegmentId",
                                   "lastFinalSegment")}
                for v in (source_view(s) for s in settings.sources)
            ],
            "segments": counts,
            "openAlerts": alerts,
        }

    @app.get("/edge/v1/disk", dependencies=auth)
    def disk():
        usage = shutil.disk_usage(settings.recordings_dir)
        state = "ok"
        if usage.free < settings.disk_hard_free_bytes:
            state = "hard_limit"
        elif usage.free < settings.disk_soft_free_bytes:
            state = "soft_limit"
        return {"freeBytes": usage.free, "totalBytes": usage.total, "softLimitFreeBytes": settings.disk_soft_free_bytes,
                "hardLimitFreeBytes": settings.disk_hard_free_bytes, "state": state}

    # ── sources ──────────────────────────────────────────────────────────
    @app.get("/edge/v1/sources", dependencies=auth)
    def sources():
        return [source_view(s) for s in settings.sources]

    @app.get("/edge/v1/sources/{name}", dependencies=auth)
    def source(name: str):
        return source_view(source_or_404(name))

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

    @app.get("/edge/v1/sources/{name}/spans", dependencies=auth)
    def spans(name: str, start: str | None = None, end: str | None = None):
        source_or_404(name)
        s = _when(start, "start") if start else None
        e = _when(end, "end") if end else None
        items, basis = spans_for(name, s, e)
        return {"source": name, "basis": basis, "spans": items}

    @app.get("/edge/v1/sources/{name}/gaps", dependencies=auth)
    def gaps(name: str, start: str, end: str, minGapMs: int = Query(500, ge=0)):
        source_or_404(name)
        s, e = _when(start, "start"), _when(end, "end")
        if e <= s:
            raise refusal(400, "bad_window", "end must be after start")
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

    @app.get("/edge/v1/sources/{name}/window", dependencies=auth)
    def window(name: str, start: str, durationMs: int = Query(..., gt=0, le=MAX_WINDOW_MS)):
        """What a replay request for this window would show, and which originals it comes from."""
        source_or_404(name)
        s = _when(start, "start")
        e = s + timedelta(milliseconds=durationMs)
        items, basis = spans_for(name, s, e)
        covered = sum(
            (min(parse_iso(x["endUtc"]), e) - max(parse_iso(x["startUtc"]), s)).total_seconds() * 1000 for x in items
        )
        segments = service.store.query(
            "SELECT id, rel_path, state, start_utc, end_utc, sha256 FROM segments WHERE source = ?"
            " AND start_utc < ? AND (end_utc IS NULL OR end_utc > ?) AND state != 'deleted' ORDER BY start_utc",
            (name, iso(e), iso(s)),
        )
        coverage = "full" if covered >= durationMs - 50 else ("none" if covered <= 0 else "partial")
        return {
            "source": name,
            "startUtc": iso(s),
            "endUtc": iso(e),
            "durationMs": durationMs,
            "coverage": coverage,
            "coveredMs": round(covered),
            "basis": basis,
            "segments": segments,
            "playbackPath": f"/edge/v1/media/{name}?start={iso(s)}&durationMs={durationMs}",
        }

    @app.get("/edge/v1/media/{name}", dependencies=auth)
    async def media(name: str, start: str, durationMs: int = Query(..., gt=0, le=MAX_WINDOW_MS)):
        source_or_404(name)
        s = _when(start, "start")
        url, params = service.mediamtx.get_url(name, s, durationMs / 1000)
        client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=60.0), auth=service.mediamtx.auth)
        try:
            upstream = await client.send(client.build_request("GET", url, params=params), stream=True)
        except httpx.HTTPError as exc:
            await client.aclose()
            raise refusal(503, "media_server_unavailable", f"MediaMTX playback unreachable: {exc.__class__.__name__}")
        if upstream.status_code != 200:
            text = (await upstream.aread()).decode(errors="replace")[:200]
            await upstream.aclose()
            await client.aclose()
            if upstream.status_code == 404:
                raise refusal(404, "no_recording", "no recording covers this window", "check /spans or /gaps")
            raise refusal(502, "media_server_error", f"MediaMTX playback returned {upstream.status_code}: {text}")

        async def body():
            try:
                async for chunk in upstream.aiter_bytes():
                    yield chunk
            finally:
                await upstream.aclose()
                await client.aclose()

        return StreamingResponse(body(), media_type=upstream.headers.get("content-type", "video/mp4"))

    # ── segments ─────────────────────────────────────────────────────────
    @app.get("/edge/v1/segments", dependencies=auth)
    def segments(source: str | None = None, state: str | None = None, start: str | None = None,
                 end: str | None = None, limit: int = Query(100, ge=1, le=500), after: str | None = None):
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
        if start:
            sql += " AND COALESCE(end_utc, start_utc) > ?"
            params.append(iso(_when(start, "start")))
        if end:
            sql += " AND start_utc < ?"
            params.append(iso(_when(end, "end")))
        if after:
            cursor_start, _, cursor_id = after.partition("|")
            sql += " AND (start_utc, id) > (?, ?)"
            params += [cursor_start, cursor_id]
        rows = service.store.query(sql + " ORDER BY start_utc, id LIMIT ?", (*params, limit + 1))
        more = len(rows) > limit
        rows = rows[:limit]
        return {"items": rows, "next": f"{rows[-1]['start_utc']}|{rows[-1]['id']}" if more else None}

    @app.get("/edge/v1/segments/{segment_id}", dependencies=auth)
    def segment(segment_id: str):
        try:
            return service.scanner.manifest_for(segment_id)
        except KeyError:
            raise refusal(404, "unknown_segment", "no such segment")

    @app.post("/edge/v1/segments/{segment_id}/verify", dependencies=auth)
    def verify(segment_id: str):
        try:
            return service.scanner.verify(segment_id)
        except KeyError:
            raise refusal(404, "unknown_segment", "no such segment")

    @app.post("/edge/v1/segments/{segment_id}/repair", dependencies=auth)
    def repair_segment(segment_id: str):
        try:
            return repair(settings, service.store, service.scanner, segment_id)
        except KeyError:
            raise refusal(404, "unknown_segment", "no such segment")
        except RepairRefused as exc:
            raise refusal(409, "repair_refused", str(exc))

    # ── alerts, events ───────────────────────────────────────────────────
    @app.get("/edge/v1/alerts", dependencies=auth)
    def alerts(state: str = Query("open", pattern="^(open|all)$"), limit: int = Query(200, ge=1, le=1000)):
        if state == "open":
            return open_alerts()
        rows = service.store.query("SELECT * FROM alerts ORDER BY opened_utc DESC LIMIT ?", (limit,))
        for r in rows:
            r["detail"] = json.loads(r["detail"]) if r["detail"] else None
        return rows

    @app.get("/edge/v1/events", dependencies=auth)
    def events(limit: int = Query(200, ge=1, le=1000), after: int = 0):
        rows = service.store.query("SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?", (after, limit))
        for r in rows:
            r["detail"] = json.loads(r["detail"]) if r["detail"] else None
        return rows

    # ── holds and retention ──────────────────────────────────────────────
    @app.get("/edge/v1/holds", dependencies=auth)
    def holds(active: bool = True):
        sql = "SELECT * FROM holds" + (" WHERE released_utc IS NULL" if active else "") + " ORDER BY from_utc"
        return service.store.query(sql)

    @app.post("/edge/v1/holds", dependencies=auth, status_code=201)
    def create_hold(body: HoldIn):
        if body.source is not None:
            source_or_404(body.source)
        try:
            return retention.create_hold(service.store, body.source, _when(body.fromUtc, "fromUtc"),
                                         _when(body.toUtc, "toUtc"), body.reason, body.ref)
        except ValueError as exc:
            raise refusal(400, "bad_hold", str(exc))

    @app.post("/edge/v1/holds/{hold_id}/release", dependencies=auth)
    def release(hold_id: str, body: ReleaseIn):
        released = retention.release_hold(service.store, hold_id, body.reason)
        if released is None:
            raise refusal(404, "unknown_hold", "no such active hold")
        return released

    @app.get("/edge/v1/retention/plan", dependencies=auth)
    def retention_plan(days: int | None = Query(None, ge=1)):
        chosen = days or settings.retention_days
        if chosen is None:
            raise refusal(400, "retention_off", "retention is off; pass ?days=N to preview a rule",
                          "set FAIRPLAY_RETENTION_DAYS only after the organiser agrees a period")
        rows = retention.plan(service.store, chosen)
        return {"enabled": settings.retention_days is not None, "days": chosen, "now": iso(utcnow()),
                "wouldDelete": [{k: r[k] for k in ("id", "source", "rel_path", "state", "start_utc", "end_utc")}
                                for r in rows]}

    return app
