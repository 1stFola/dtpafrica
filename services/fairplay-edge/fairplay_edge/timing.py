"""The time model: four clocks kept apart, and the windows an incident asks each source for.

  edge_utc      the Edge's wall clock (NTP when it has it; free-running offline)
  edge_mono_ns  the Edge's monotonic clock, which never jumps; it is how a wall-clock step
                is noticed
  ingest_utc    when MediaMTX received a frame (its segment names and playback index;
                `useAbsoluteTimestamp` is off). Source PTS lives inside each segment and is
                recorded in its manifest; it is never compared across sources
  match_clock   period + minute + second, as the referee's game runs; anchored by period
                marks on the Edge clock, never by file names

A calibration says: a visible event that happened at `reference_utc` (Edge clock) appears in
this source's recording at `observed_ingest_utc`. `offset_ms` = observed − reference, so a
positive offset means the source lags. Each source has its own; nothing assumes the drone
and the ground share one. A calibration holds for the unbroken stretch of recording it was
measured in: footage on the other side of a drop or a recording gap is
`stale_after_reconnect` until that stretch is calibrated too. This is judged in footage
time, so footage recorded before a later drop keeps its calibration.

Browser seeks land on keyframes. Nothing here claims frame accuracy: a window is a request
for "about this moment, give or take the stated uncertainty".
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timedelta
from typing import Callable

from . import outbox
from .config import Settings
from .naming import iso, parse_iso, utcnow
from .store import Store, new_id

PERIODS = ("1", "2", "3", "4", "penalties")
METHODS = ("whistle", "ball_strike", "clapper", "marker", "manual")
CATEGORIES = ("goal", "penalty", "offside", "foul", "handball", "card", "goalkeeper", "other")
# A guess, not a measurement: an uncalibrated camera's delay is unknown. Phase 3's fixture
# runs measured 0.9-2.3 s on the synthetic feeds, so the Phase 2 value of 2 s was too tight.
UNCALIBRATED_UNCERTAINTY_MS = 3000
HIGH_UNCERTAINTY_MS = 500
STEP_THRESHOLD_MS = 1000
HOLD_MARGIN = timedelta(seconds=60)
MAX_WINDOW_MS = 10 * 60 * 1000
STATE_PRIORITY = ("no_footage", "gap", "stale_after_reconnect", "uncalibrated", "uncertainty_high")

SpansFn = Callable[[str, datetime, datetime], tuple[list[dict], str]]


class TimingError(ValueError):
    pass


class Conflict(TimingError):
    pass


def mono_ns() -> int:
    return time.monotonic_ns()


# ── match sessions ────────────────────────────────────────────────────────

def create_session(store: Store, label: str, match_ref: str | None, mode: str, actor: str,
                   session_id: str | None = None) -> dict:
    """`session_id` is the cloud's, from a signed bundle: the session the cloud provisioned
    for this device, which is the only one the cloud accepts from it."""
    if mode not in ("shadow", "post_match"):
        # ADR-0001: there is no third mode.
        raise TimingError("mode must be shadow or post_match")
    if session_id and store.one("SELECT 1 FROM match_sessions WHERE id = ?", (session_id,)):
        raise TimingError("this session has already been started on this Edge")
    row = {"id": session_id or new_id(), "label": label.strip()[:120], "match_ref": match_ref, "mode": mode,
           "created_utc": iso(utcnow()), "created_by": actor}
    if not row["label"]:
        raise TimingError("a session needs a label")
    with store.tx() as db:
        db.execute("INSERT INTO match_sessions (id, label, match_ref, mode, created_utc, created_by)"
                   " VALUES (:id, :label, :match_ref, :mode, :created_utc, :created_by)", row)
        Store.log_event(db, row["created_utc"], "session.created", None, row)
        outbox.enqueue(db, "session", row["id"], None, {**row, "ended_utc": None})
    return row


def get_session(store: Store, session_id: str) -> dict:
    row = store.one("SELECT * FROM match_sessions WHERE id = ?", (session_id,))
    if row is None:
        raise KeyError(session_id)
    return row


def end_session(store: Store, session_id: str, actor: str) -> dict:
    get_session(store, session_id)
    at = iso(utcnow())
    with store.tx() as db:
        db.execute("UPDATE match_sessions SET ended_utc = COALESCE(ended_utc, ?) WHERE id = ?", (at, session_id))
        Store.log_event(db, at, "session.ended", None, {"id": session_id, "by": actor})
        outbox.enqueue(db, "session", session_id, None,
                       dict(db.execute("SELECT * FROM match_sessions WHERE id = ?", (session_id,)).fetchone()))
    return get_session(store, session_id)


def _open(store: Store, session_id: str) -> dict:
    session = get_session(store, session_id)
    if session["ended_utc"]:
        raise Conflict("the session has ended")
    return session


# ── period marks ──────────────────────────────────────────────────────────

def mark_period(store: Store, session_id: str, period: str, edge: str, actor: str,
                at: datetime | None = None, supersedes: str | None = None, console_anchor: str | None = None) -> dict:
    _open(store, session_id)
    if period not in PERIODS or edge not in ("start", "end"):
        raise TimingError("period must be 1, 2, 3, 4 or penalties; edge start or end")
    when = at or utcnow()
    delta = None
    if console_anchor:
        delta = round((when - parse_iso(console_anchor)).total_seconds() * 1000)
    row = {"id": new_id(), "session_id": session_id, "period": period, "edge": edge, "edge_utc": iso(when),
           "edge_mono_ns": mono_ns(), "console_anchor_utc": console_anchor, "console_delta_ms": delta,
           "actor_id": actor, "supersedes": supersedes, "created_utc": iso(utcnow())}
    with store.tx() as db:
        db.execute("INSERT INTO period_marks (id, session_id, period, edge, edge_utc, edge_mono_ns, console_anchor_utc,"
                   " console_delta_ms, actor_id, supersedes, created_utc) VALUES (:id, :session_id, :period, :edge,"
                   " :edge_utc, :edge_mono_ns, :console_anchor_utc, :console_delta_ms, :actor_id, :supersedes,"
                   " :created_utc)", row)
        Store.log_event(db, row["created_utc"], "period.marked", None, row)
        outbox.enqueue(db, "period", row["id"], 1, row)
    return row


def current_periods(store: Store, session_id: str) -> list[dict]:
    return store.query(
        "SELECT * FROM period_marks p WHERE session_id = ? AND NOT EXISTS"
        " (SELECT 1 FROM period_marks q WHERE q.supersedes = p.id) ORDER BY edge_utc", (session_id,))


# ── calibrations ──────────────────────────────────────────────────────────

def _frame_ms(store: Store, source: str) -> int:
    row = store.one("SELECT fps FROM segments WHERE source = ? AND fps IS NOT NULL ORDER BY start_utc DESC LIMIT 1",
                    (source,))
    if row and row["fps"]:
        num, _, den = row["fps"].partition("/")
        try:
            return max(1, math.ceil(1000 * int(den or 1) / int(num)))
        except (ValueError, ZeroDivisionError):
            pass
    return 20


def calibrate(store: Store, settings: Settings, session_id: str, source: str, reference_utc: datetime,
              observed_ingest_utc: datetime, uncertainty_ms: int, method: str, actor: str, *,
              period: str | None = None, reference_source: str | None = None, evidence_segment_id: str | None = None,
              note: str | None = None, supersedes: str | None = None) -> dict:
    _open(store, session_id)
    if settings.source(source) is None:
        raise TimingError(f"no configured source named {source!r}")
    if reference_source is not None and settings.source(reference_source) is None:
        raise TimingError(f"no configured source named {reference_source!r}")
    if method not in METHODS:
        raise TimingError(f"method must be one of {', '.join(METHODS)}")
    floor = _frame_ms(store, source)
    if uncertainty_ms < floor:
        # Seeking is keyframe-constrained and frames are discrete: no claim tighter than a frame.
        raise TimingError(f"uncertainty below one frame ({floor} ms) is not a claim the footage supports")
    offset = round((observed_ingest_utc - reference_utc).total_seconds() * 1000)
    row = {"id": new_id(), "session_id": session_id, "source": source, "period": period,
           "reference_utc": iso(reference_utc), "observed_ingest_utc": iso(observed_ingest_utc), "offset_ms": offset,
           "uncertainty_ms": int(uncertainty_ms), "method": method, "reference_source": reference_source,
           "evidence_segment_id": evidence_segment_id, "note": note, "actor_id": actor, "supersedes": supersedes,
           "created_utc": iso(utcnow())}
    with store.tx() as db:
        db.execute("INSERT INTO calibrations (id, session_id, source, period, reference_utc, observed_ingest_utc,"
                   " offset_ms, uncertainty_ms, method, reference_source, evidence_segment_id, note, actor_id,"
                   " supersedes, created_utc) VALUES (:id, :session_id, :source, :period, :reference_utc,"
                   " :observed_ingest_utc, :offset_ms, :uncertainty_ms, :method, :reference_source,"
                   " :evidence_segment_id, :note, :actor_id, :supersedes, :created_utc)", row)
        Store.log_event(db, row["created_utc"], "calibration.added", None, row)
        outbox.enqueue(db, "calibration", row["id"], 1, row)
    return row


def current_calibration(store: Store, session_id: str, source: str) -> dict | None:
    return store.one(
        "SELECT * FROM calibrations c WHERE session_id = ? AND source = ? AND NOT EXISTS"
        " (SELECT 1 FROM calibrations d WHERE d.supersedes = c.id) ORDER BY created_utc DESC LIMIT 1",
        (session_id, source))


INTERRUPTION_MS = 500


def interrupted_between(store: Store, source: str, a: datetime, b: datetime,
                        spans_fn: SpansFn | None = None) -> dict | None:
    """Was this source's stream broken anywhere between footage times `a` and `b`?

    A calibration is measured on one unbroken stretch of a source's recording. After the
    stream drops and comes back, the source's delay may differ (a new encoder session, a new
    network path), so the calibration says nothing about footage on the other side of the
    break. Two kinds of evidence, either enough: a drop the watchdog saw, or a gap in the
    recordings themselves (which needs no Edge to have been running at the time).
    """
    lo, hi = (a, b) if a <= b else (b, a)
    if hi - lo <= timedelta(milliseconds=INTERRUPTION_MS):
        return None
    drop = store.one(
        "SELECT * FROM feed_intervals WHERE source = ? AND down_from_utc < ? AND COALESCE(down_to_utc, ?) > ?"
        " ORDER BY down_from_utc DESC LIMIT 1", (source, iso(hi), iso(hi), iso(lo)))
    if drop:
        return {"kind": "drop", "fromUtc": drop["down_from_utc"], "toUtc": drop["down_to_utc"]}
    if spans_fn is not None:
        spans, _ = spans_fn(source, lo, hi)
        covered = coverage(spans, lo, hi)
        if covered < (hi - lo).total_seconds() * 1000 - INTERRUPTION_MS:
            return {"kind": "recording_gap", "coveredMs": covered,
                    "spanMs": round((hi - lo).total_seconds() * 1000)}
    return None


def calibration_view(store: Store, settings: Settings, session_id: str, spans_fn: SpansFn | None = None,
                     now: datetime | None = None) -> list[dict]:
    """Each source's current calibration, judged for footage being recorded now."""
    now = now or utcnow()
    out = []
    for source in settings.sources:
        cal = current_calibration(store, session_id, source.name)
        stale = interrupted_between(store, source.name, parse_iso(cal["observed_ingest_utc"]), now, spans_fn) if cal else None
        flags = []
        if cal is None:
            flags.append("uncalibrated")
        else:
            if stale:
                flags.append("stale_after_reconnect")
            if cal["uncertainty_ms"] > HIGH_UNCERTAINTY_MS:
                flags.append("uncertainty_high")
        out.append({
            "source": source.name, "role": source.role,
            "offsetMs": cal["offset_ms"] if cal else 0,
            "uncertaintyMs": cal["uncertainty_ms"] if cal else UNCALIBRATED_UNCERTAINTY_MS,
            "calibration": cal, "flags": flags,
            "reconnect": stale,
        })
    return out


# ── incidents ─────────────────────────────────────────────────────────────

def _validate_rolls(pre: int, post: int) -> None:
    if pre < 0 or post < 0 or pre + post <= 0 or pre + post > MAX_WINDOW_MS:
        raise TimingError("pre-roll and post-roll must be non-negative and total at most 10 minutes")


def _hold_window(event: datetime, pre: int, post: int) -> tuple[datetime, datetime]:
    return event - timedelta(milliseconds=pre) - HOLD_MARGIN, event + timedelta(milliseconds=post) + HOLD_MARGIN


# ── windows ───────────────────────────────────────────────────────────────

def coverage(spans: list[dict], start: datetime, end: datetime) -> int:
    covered = 0.0
    for span in spans:
        lo = max(parse_iso(span["startUtc"]), start)
        hi = min(parse_iso(span["endUtc"]), end)
        if hi > lo:
            covered += (hi - lo).total_seconds() * 1000
    return round(covered)


def source_window(store: Store, session_id: str, source: str, event: datetime, pre_ms: int, post_ms: int,
                  spans_fn: SpansFn) -> dict:
    cal = current_calibration(store, session_id, source)
    offset = cal["offset_ms"] if cal else 0
    unc = cal["uncertainty_ms"] if cal else UNCALIBRATED_UNCERTAINTY_MS
    duration = min(pre_ms + post_ms + 2 * unc, MAX_WINDOW_MS)
    start = event - timedelta(milliseconds=pre_ms) + timedelta(milliseconds=offset - unc)
    end = start + timedelta(milliseconds=duration)
    spans, basis = spans_fn(source, start, end)
    covered = coverage(spans, start, end)
    flags = []
    if covered <= 0:
        flags.append("no_footage")
    elif covered < duration - 50:
        flags.append("gap")
    if cal is None:
        flags.append("uncalibrated")
    else:
        # Judged in footage time: the window is only as good as its link to the calibrated stretch.
        if interrupted_between(store, source, parse_iso(cal["observed_ingest_utc"]), event + timedelta(milliseconds=offset),
                               spans_fn):
            flags.append("stale_after_reconnect")
        if unc > HIGH_UNCERTAINTY_MS:
            flags.append("uncertainty_high")
    state = next((s for s in STATE_PRIORITY if s in flags), "ok")
    return {
        "source": source,
        "startIngestUtc": iso(start),
        "durationMs": duration,
        "eventAtMs": pre_ms + unc,  # where the incident falls inside the window
        "offsetMs": offset,
        "uncertaintyMs": unc,
        "calibrationId": cal["id"] if cal else None,
        "coveredMs": covered,
        "basis": basis,
        "state": state,
        "flags": flags,
        "playbackPath": f"/edge/v1/media/{source}?start={iso(start)}&durationMs={duration}",
    }


def incident_windows(store: Store, settings: Settings, incident_id: str, spans_fn: SpansFn) -> dict:
    row = store.one("SELECT * FROM incidents WHERE id = ?", (incident_id,))
    if row is None:
        raise KeyError(incident_id)
    event = parse_iso(row["event_utc"])
    return {
        "incidentId": incident_id,
        "eventUtc": row["event_utc"],
        "eventUtcBasis": row["basis"],
        "preRollMs": row["pre_roll_ms"],
        "postRollMs": row["post_roll_ms"],
        "perSource": [source_window(store, row["session_id"], s.name, event, row["pre_roll_ms"], row["post_roll_ms"],
                                    spans_fn) for s in settings.sources],
        "clock": clock_state(store),
        "note": "Seeks land on keyframes; positions are approximate to the stated uncertainty, not frame-accurate.",
    }


def sync_test(store: Store, settings: Settings, session_id: str, at: datetime, spans_fn: SpansFn,
              half_width_ms: int = 2000) -> dict:
    """The same Edge-clock instant on every source, as each one's calibration maps it."""
    get_session(store, session_id)
    windows = [source_window(store, session_id, s.name, at, half_width_ms, half_width_ms, spans_fn)
               for s in settings.sources]
    usable = [w for w in windows if w["state"] not in ("no_footage",)]
    calibrated = [w for w in usable if "uncalibrated" not in w["flags"] and "stale_after_reconnect" not in w["flags"]]
    combined = sum(w["uncertaintyMs"] for w in calibrated) if len(calibrated) == len(usable) else None
    return {
        "atUtc": iso(at),
        "windows": windows,
        "aligned": combined is not None and len(usable) >= 2,
        # Conservative: the uncertainties add. Anything uncalibrated means no claim at all.
        "alignmentUncertaintyMs": combined,
        "statement": (f"aligned within ±{combined} ms" if combined is not None and len(usable) >= 2 else
                      "not aligned: calibrate every source (and re-calibrate after a reconnect) first"),
    }


# ── the Edge clock ────────────────────────────────────────────────────────

class ClockWatch:
    """Samples wall and monotonic clocks together; a disagreement means the wall clock jumped."""

    def __init__(self, store: Store, ntp_state: str = "unknown"):
        self.store = store
        self.ntp_state = ntp_state
        self._last: tuple[datetime, int] | None = None

    def sample(self, now: datetime | None = None, mono: int | None = None) -> dict:
        now = now or utcnow()
        mono = mono if mono is not None else mono_ns()
        step = None
        if self._last is not None:
            wall_delta = (now - self._last[0]).total_seconds() * 1000
            mono_delta = (mono - self._last[1]) / 1e6
            step = round(wall_delta - mono_delta)
        self._last = (now, mono)
        with self.store.tx() as db:
            db.execute("INSERT INTO clock_samples (edge_utc, edge_mono_ns, ntp_state, step_ms) VALUES (?, ?, ?, ?)",
                       (iso(now), mono, self.ntp_state, step))
        if step is not None and abs(step) > STEP_THRESHOLD_MS:
            self.store.open_alert("clock_stepped", None, "warning", iso(now), {"stepMs": step})
        elif step is not None:
            self.store.resolve_alert("clock_stepped", None, iso(now))
        return {"edgeUtc": iso(now), "edgeMonoNs": mono, "ntpState": self.ntp_state, "stepMs": step}


def clock_state(store: Store) -> dict:
    last = store.one("SELECT * FROM clock_samples ORDER BY seq DESC LIMIT 1")
    steps = store.query("SELECT edge_utc, step_ms FROM clock_samples WHERE ABS(step_ms) > ? ORDER BY seq DESC LIMIT 10",
                        (STEP_THRESHOLD_MS,))
    return {
        "edgeUtc": iso(utcnow()),
        "edgeMonoNs": mono_ns(),
        "ntpState": last["ntp_state"] if last else "unknown",
        "lastSample": last,
        "recentSteps": steps,
        "cloudOffsetMs": None,  # Phase 3: measured against /api/v1/time when online
    }


def replay_summary(store: Store, since_utc: str | None = None) -> dict:
    sql = "SELECT * FROM replay_metrics" + (" WHERE at_utc >= ?" if since_utc else "") + " ORDER BY seq"
    rows = store.query(sql, (since_utc,) if since_utc else ())
    ok = sorted(r["to_playable_ms"] for r in rows if r["outcome"] == "playable" and r["to_playable_ms"] is not None)

    def pct(p: float) -> int | None:
        if not ok:
            return None
        # Nearest-rank percentile: the value at or above which p of the samples fall.
        return ok[max(0, math.ceil(p * len(ok)) - 1)]

    return {"samples": len(rows), "playable": len(ok),
            "failed": [{k: r[k] for k in ("at_utc", "source", "outcome", "note")} for r in rows if r["outcome"] != "playable"],
            "p50Ms": pct(0.5), "p95Ms": pct(0.95), "maxMs": ok[-1] if ok else None,
            "bySource": {s: len([r for r in rows if r["source"] == s]) for s in sorted({r["source"] for r in rows})},
            "definition": "browser: request sent to the replay video's canplay event, on the operator's device"}


def as_json(row: dict) -> dict:
    return json.loads(json.dumps(row, default=str))
