"""Measuring the matchday kit (Phase 6.4; docs/fairplay/hardware-validation.md).

`report` only reads: what each camera really delivered (bitrate, codec, keyframes, recorded
share of the time), how fast replay and clips were, and the current calibrations. `disk` writes
one temporary file beside the recordings and removes it, and refuses while a session is open.
Nothing here decides a pass: the targets are the PID's, and a person records the result.
"""

from __future__ import annotations

import math
import os
import shutil
import time
from pathlib import Path

from . import probe, timing
from .config import Settings
from .naming import iso, parse_iso, utcnow
from .store import Store

BLOCK = 1024 * 1024
DISK_WINDOW_S = 5
# Stop a disk test this far above the Edge's own hard limit, whatever was asked for.
DISK_MARGIN_BYTES = 5 * 1024**3


def _span(rows: list[dict]) -> tuple[int, int, list[dict]]:
    """Time spanned, time covered and the gaps, in ms, of rows with start_utc and end_utc."""
    intervals = sorted((parse_iso(r["start_utc"]), parse_iso(r["end_utc"])) for r in rows)
    covered, gaps = 0, []
    start, end = intervals[0]
    first = start
    for s, e in intervals[1:]:
        if s > end:
            covered += (end - start).total_seconds() * 1000
            gaps.append({"fromUtc": iso(end), "toUtc": iso(s), "ms": round((s - end).total_seconds() * 1000)})
            start, end = s, e
        else:
            end = max(end, e)
    covered += (end - start).total_seconds() * 1000
    return round((end - first).total_seconds() * 1000), round(covered), gaps


def _keyframes(path: Path) -> float | None:
    """Median seconds between keyframes in one recording, from its index, with no decoding."""
    try:
        keys = [pts for pts, key in probe.video_packets(path) if key]
    except probe.ProbeError:
        return None
    steps = sorted(b - a for a, b in zip(keys, keys[1:]))
    return round(steps[len(steps) // 2], 3) if steps else None


def _source(settings: Settings, name: str, rows: list[dict]) -> dict:
    timed = [r for r in rows if r["end_utc"]]
    if not timed:
        return {"source": name, "segments": 0}
    span, covered, gaps = _span(timed)
    measured = [r for r in timed if r["bytes"] and r["duration_ms"]]
    bytes_, ms = sum(r["bytes"] for r in measured), sum(r["duration_ms"] for r in measured)
    mbit = round(bytes_ * 8 / (ms / 1000) / 1e6, 2) if ms else None
    latest = timed[-1]
    path = settings.recordings_dir / latest["rel_path"]
    return {
        "source": name, "segments": len(timed), "partial": sum(r["state"] == "partial" for r in timed),
        "fromUtc": timed[0]["start_utc"], "toUtc": latest["end_utc"],
        "recordedPercent": round(covered * 100 / span, 2) if span else None, "gapCount": len(gaps),
        "longestGapMs": max((g["ms"] for g in gaps), default=0), "gaps": sorted(gaps, key=lambda g: -g["ms"])[:5],
        "mbitPerSecond": mbit, "gbPerHour": round(mbit * 3600 / 8 / 1000, 2) if mbit else None,
        "codec": latest["codec"], "profile": latest["profile"], "width": latest["width"], "height": latest["height"],
        "fps": latest["fps"], "hasAudio": bool(latest["has_audio"]),
        "keyframeIntervalS": _keyframes(path) if path.exists() else None,
    }


def _percentile(ordered: list[int], p: float) -> int | None:
    return ordered[max(0, math.ceil(p * len(ordered)) - 1)] if ordered else None


def report(settings: Settings, store: Store, since_minutes: float | None = None) -> dict:
    now = utcnow()
    since = iso(now.fromtimestamp(now.timestamp() - since_minutes * 60, now.tzinfo)) if since_minutes else None
    where = " AND start_utc >= ?" if since else ""
    args = (since,) if since else ()
    rows = store.query("SELECT * FROM segments WHERE state IN ('finalized', 'partial') AND deleted_utc IS NULL"
                       f"{where} ORDER BY start_utc", args)  # noqa: S608 (a fixed clause)
    names = sorted({r["source"] for r in rows})
    sources = [_source(settings, n, [r for r in rows if r["source"] == n]) for n in names]
    clips = store.query("SELECT created_utc, finished_utc FROM jobs WHERE state = 'succeeded' AND finished_utc IS NOT NULL"
                        + (" AND created_utc >= ?" if since else ""), args)
    clip_ms = sorted(round((parse_iso(c["finished_utc"]) - parse_iso(c["created_utc"])).total_seconds() * 1000) for c in clips)
    failed = store.one("SELECT COUNT(*) AS n FROM jobs WHERE state = 'failed'" + (" AND created_utc >= ?" if since else ""), args)["n"]
    alerts = store.query("SELECT kind, COUNT(*) AS n FROM alerts" + (" WHERE opened_utc >= ?" if since else "")
                         + " GROUP BY kind ORDER BY kind", args)
    calibrations = store.query("SELECT c.source, c.offset_ms, c.uncertainty_ms, c.method FROM calibrations c"
                               " JOIN (SELECT source, MAX(created_utc) AS latest FROM calibrations GROUP BY source) l"
                               " ON l.source = c.source AND l.latest = c.created_utc ORDER BY c.source")
    return {"measuredUtc": iso(now), "sinceUtc": since, "sources": sources,
            "allSourcesMbit": round(sum(s.get("mbitPerSecond") or 0 for s in sources), 2),
            "allSourcesGbPerHour": round(sum(s.get("gbPerHour") or 0 for s in sources), 2),
            "replay": timing.replay_summary(store, since),
            "clips": {"made": len(clip_ms), "failed": failed, "p50Ms": _percentile(clip_ms, 0.5), "p95Ms": _percentile(clip_ms, 0.95),
                      "maxMs": clip_ms[-1] if clip_ms else None},
            "alertsOpened": {a["kind"]: a["n"] for a in alerts}, "latestCalibrations": calibrations,
            "disk": {"freeGb": round(shutil.disk_usage(settings.recordings_dir).free / 1e9, 1)}}


class DiskTestRefused(RuntimeError):
    pass


def disk(settings: Settings, store: Store, seconds: int = 300, *, force: bool = False) -> dict:
    """Sustained write beside the recordings: incompressible data, flushed every block group, so
    the figure is the disk's and not its cache's. The slowest window matters more than the mean."""
    if not force and store.one("SELECT 1 FROM match_sessions WHERE ended_utc IS NULL LIMIT 1"):
        raise DiskTestRefused("a session is open: this test would compete with its recording. End it, or use --force on a bench")
    folder = settings.recordings_dir
    floor = settings.disk_hard_free_bytes + DISK_MARGIN_BYTES
    target = folder / f".measure-disk-{os.getpid()}"
    pool = [os.urandom(BLOCK) for _ in range(16)]
    written, stopped, windows = 0, "time", []
    started = window_start = time.monotonic()
    window_bytes = 0
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        while (now := time.monotonic()) - started < seconds:
            if shutil.disk_usage(folder).free < floor:
                stopped = "free space"
                break
            for i in range(64):
                # A changed first bytes per block, so a deduplicating disk cannot flatter the figure.
                os.write(fd, written.to_bytes(8, "big") + pool[i % len(pool)][8:])
                written += BLOCK
                window_bytes += BLOCK
            os.fsync(fd)
            now = time.monotonic()
            if now - window_start >= DISK_WINDOW_S:
                windows.append(window_bytes / (now - window_start) / 1e6)
                window_start, window_bytes = now, 0
    finally:
        os.close(fd)
        target.unlink(missing_ok=True)
    took = time.monotonic() - started
    return {"seconds": round(took, 1), "writtenGb": round(written / 1e9, 2), "meanMBps": round(written / took / 1e6, 1) if took else None,
            "slowestWindowMBps": round(min(windows), 1) if windows else None, "windowSeconds": DISK_WINDOW_S, "stoppedBy": stopped,
            "folder": str(folder)}
