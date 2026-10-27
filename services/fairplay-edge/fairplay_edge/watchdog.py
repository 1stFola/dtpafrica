"""Source, recorder, disk and media-server health, turned into alerts and feed intervals.

"Recording" is decided from evidence, never from a connection: a source is recording only
when it is publishing *and* its current segment file grew within `record_stall_seconds`.
A connected publisher whose segment has stopped growing raises `recording_stalled`.

Alert kinds (one open alert per kind and source at a time):
  media_server_down   critical   MediaMTX's API unreachable or refusing the Edge
  source_disconnected critical for a required source, warning otherwise
  recording_stalled   critical   publishing, but nothing written
  disk_soft_limit     warning    free space below the soft threshold
  disk_hard_limit     critical   free space below the hard threshold
plus the scanner's segment_partial / segment_corrupt / segment_missing / segment_mismatch.
"""

from __future__ import annotations

import json
import logging
import shutil
from dataclasses import dataclass
from datetime import timedelta

from .config import Settings
from .mediamtx import MediaMtx, MediaMtxUnavailable, PathStatus
from .naming import iso, parse_iso, utcnow
from .store import Store, new_id

log = logging.getLogger("fairplay.watchdog")


@dataclass
class Snapshot:
    """The latest observation, kept in memory for the API between polls."""

    at_utc: str | None = None
    media_server_up: bool | None = None
    media_server_error: str | None = None
    paths: dict[str, PathStatus] | None = None
    disk_free_bytes: int | None = None
    disk_total_bytes: int | None = None

    def publishing(self) -> dict[str, bool]:
        return {name: status.ready for name, status in (self.paths or {}).items()}


class Watchdog:
    def __init__(self, settings: Settings, store: Store, mediamtx: MediaMtx):
        self.settings = settings
        self.store = store
        self.mediamtx = mediamtx
        self.snapshot = Snapshot()

    def poll(self) -> Snapshot:
        now = utcnow()
        at = iso(now)
        snap = Snapshot(at_utc=at)
        try:
            snap.paths = self.mediamtx.paths()
            snap.media_server_up = True
            self.store.resolve_alert("media_server_down", None, at)
        except MediaMtxUnavailable as exc:
            snap.media_server_up = False
            snap.media_server_error = str(exc)
            if self.store.open_alert("media_server_down", None, "critical", at, {"error": str(exc)}):
                log.warning(json.dumps({"alert": "media_server_down", "error": str(exc)}))

        usage = shutil.disk_usage(self.settings.recordings_dir)
        snap.disk_free_bytes, snap.disk_total_bytes = usage.free, usage.total
        self._disk(usage.free, at)

        if snap.media_server_up:
            for source in self.settings.sources:
                status = snap.paths.get(source.name)
                self._source(source, bool(status and status.ready), status, now)
        self.snapshot = snap
        return snap

    # ── per source ────────────────────────────────────────────────────────
    def _source(self, source, publishing: bool, status: PathStatus | None, now) -> None:
        at = iso(now)
        prev = self.store.one("SELECT * FROM source_state WHERE source = ?", (source.name,))
        detail = json.dumps({"tracks": list(status.tracks), "codecProps": list(status.codec_props)}) if status else None
        with self.store.tx() as db:
            if prev is None:
                db.execute(
                    "INSERT INTO source_state (source, publishing, since_utc, last_seen_publishing_utc, detail)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (source.name, int(publishing), at, at if publishing else None, detail),
                )
            else:
                changed = bool(prev["publishing"]) != publishing
                db.execute(
                    "UPDATE source_state SET publishing = ?, since_utc = ?, last_seen_publishing_utc = ?,"
                    " detail = COALESCE(?, detail) WHERE source = ?",
                    (
                        int(publishing),
                        at if changed else prev["since_utc"],
                        at if publishing else prev["last_seen_publishing_utc"],
                        detail,
                        source.name,
                    ),
                )
                # A drop counts from the first poll that saw it gone, after the source had
                # been seen publishing. The recorded spans (playback /list) are the other,
                # authoritative view of the same gaps, and need no Edge to have been running.
                if changed and not publishing:
                    db.execute(
                        "INSERT INTO feed_intervals (id, source, down_from_utc) VALUES (?, ?, ?)",
                        (new_id(), source.name, at),
                    )
                elif changed and publishing:
                    db.execute(
                        "UPDATE feed_intervals SET down_to_utc = ? WHERE source = ? AND down_to_utc IS NULL",
                        (at, source.name),
                    )
        if publishing:
            self.store.resolve_alert("source_disconnected", source.name, at)
        else:
            severity = "critical" if source.required else "warning"
            if self.store.open_alert("source_disconnected", source.name, severity, at, {"required": source.required}):
                log.warning(json.dumps({"alert": "source_disconnected", "source": source.name, "severity": severity}))
        self._recording(source, publishing, now)

    def recording_state(self, source_name: str, publishing: bool, now=None) -> dict:
        now = now or utcnow()
        current = self.store.one(
            "SELECT id, rel_path, last_size, last_growth_utc FROM segments"
            " WHERE source = ? AND state = 'recording' ORDER BY start_utc DESC LIMIT 1",
            (source_name,),
        )
        growing = False
        if current and current["last_growth_utc"]:
            age = now - parse_iso(current["last_growth_utc"])
            growing = age <= timedelta(seconds=self.settings.record_stall_seconds)
        return {
            "recording": bool(publishing and growing),
            "currentSegmentId": current["id"] if current else None,
            "currentSegmentBytes": current["last_size"] if current else None,
            "lastGrowthUtc": current["last_growth_utc"] if current else None,
        }

    def _recording(self, source, publishing: bool, now) -> None:
        at = iso(now)
        state = self.recording_state(source.name, publishing, now)
        if not publishing or state["recording"]:
            self.store.resolve_alert("recording_stalled", source.name, at)
            return
        # Publishing but not written. Give a new publisher one stall window to produce
        # its first segment before calling it stalled.
        row = self.store.one("SELECT since_utc FROM source_state WHERE source = ?", (source.name,))
        since = parse_iso(row["since_utc"]) if row else now
        if now - since > timedelta(seconds=self.settings.record_stall_seconds):
            if self.store.open_alert("recording_stalled", source.name, "critical", at, state):
                log.warning(json.dumps({"alert": "recording_stalled", "source": source.name}))

    # ── disk ──────────────────────────────────────────────────────────────
    def _disk(self, free: int, at: str) -> None:
        s = self.settings
        if free < s.disk_hard_free_bytes:
            self.store.open_alert("disk_hard_limit", None, "critical", at, {"freeBytes": free})
        else:
            self.store.resolve_alert("disk_hard_limit", None, at)
        if free < s.disk_soft_free_bytes:
            self.store.open_alert("disk_soft_limit", None, "warning", at, {"freeBytes": free})
        else:
            self.store.resolve_alert("disk_soft_limit", None, at)
