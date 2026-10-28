"""Discover MediaMTX's segments, decide when each is final, and write its manifest.

MediaMTX's hooks would need a shell inside its image, which has none, so the Edge watches
the recordings folder instead (ADR-0011). That also covers what a hook cannot: a segment
finalised while the Edge was down is found on the next scan.

A segment is final when either
  - a newer segment exists for the same source (MediaMTX moved on), or
  - the source is not publishing and the file has not grown for `finalize_quiet_seconds`
    (the feed ended, or MediaMTX died mid-segment).
Final segments are checked structurally (mp4.inspect), probed, hashed over every byte, and
recorded twice: a row in SQLite and a JSON sidecar in `manifests/`. A file with a
half-written tail is `partial`, never `finalized`; one ffprobe cannot read is `corrupt`.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import timedelta
from pathlib import Path

from . import __version__, mp4, outbox
from .config import Settings
from .naming import NotASegment, iso, parse_iso, parse_rel_path, utcnow
from .probe import ProbeError, probe, sha256_file, video_packets, video_span_s
from .store import Store, new_id

log = logging.getLogger("fairplay.manifest")

MANIFEST_SCHEMA = "fairplay.segment-manifest/v1"
# Pictures missing between the end of one segment's video and the next segment's first
# decodable frame. Seen with MediaMTX 1.21.3 when a feed's audio runs more than a second
# ahead of its video: at each segment switch the recorder discards the late video ("sample
# of track received too late"). See docs/fairplay/phase-3-incidents-and-evidence.md.
VIDEO_GAP_MS = 250


def list_segment_files(recordings_dir: Path, source_names: set[str]) -> list[tuple[str, Path]]:
    found = []
    for name in source_names:
        folder = recordings_dir / name
        if not folder.is_dir():
            continue
        for entry in folder.iterdir():
            if entry.is_file() and entry.suffix == ".mp4":
                found.append((f"{name}/{entry.name}", entry))
    return found


class Scanner:
    def __init__(self, settings: Settings, store: Store):
        self.settings = settings
        self.store = store

    # ── discovery ─────────────────────────────────────────────────────────
    def scan(self, publishing: dict[str, bool]) -> list[str]:
        """One pass. `publishing` is the watchdog's latest view; a source absent from it
        (MediaMTX unreachable) counts as not publishing. Returns ids finalised this pass."""
        now = utcnow()
        names = {s.name for s in self.settings.sources}
        files = list_segment_files(self.settings.recordings_dir, names)
        known = {r["rel_path"]: r for r in self.store.query("SELECT * FROM segments")}
        newest_start: dict[str, str] = {}
        for rel, path in files:
            try:
                source, start = parse_rel_path(rel)
            except NotASegment:
                continue
            start_s = iso(start)
            newest_start[source] = max(newest_start.get(source, start_s), start_s)
            if rel not in known:
                size = path.stat().st_size
                with self.store.tx() as db:
                    db.execute(
                        "INSERT INTO segments (id, source, rel_path, start_utc, state, discovered_utc, last_size,"
                        " last_growth_utc) VALUES (?, ?, ?, ?, 'recording', ?, ?, ?)",
                        (new_id(), source, rel, start_s, iso(now), size, iso(now)),
                    )
                log.info(json.dumps({"event": "segment.discovered", "rel_path": rel}))

        present = {rel for rel, _ in files}
        finalised = []
        for row in self.store.query("SELECT * FROM segments WHERE state = 'recording'"):
            path = self.settings.recordings_dir / row["rel_path"]
            if row["rel_path"] not in present:
                self._mark_missing(row, now)
                continue
            size = path.stat().st_size
            if size != row["last_size"]:
                with self.store.tx() as db:
                    db.execute(
                        "UPDATE segments SET last_size = ?, last_growth_utc = ? WHERE id = ?",
                        (size, iso(now), row["id"]),
                    )
                row["last_growth_utc"] = iso(now)
            reason = None
            if newest_start.get(row["source"], row["start_utc"]) > row["start_utc"]:
                reason = "newer_segment"
            elif not publishing.get(row["source"], False):
                quiet = now - parse_iso(row["last_growth_utc"] or row["discovered_utc"])
                if quiet >= timedelta(seconds=self.settings.finalize_quiet_seconds):
                    reason = "source_stopped"
            if reason:
                self.finalise(row["id"], reason)
                finalised.append(row["id"])
        return finalised

    def _mark_missing(self, row: dict, now) -> None:
        with self.store.tx() as db:
            db.execute("UPDATE segments SET state = 'missing' WHERE id = ?", (row["id"],))
            Store.log_event(db, iso(now), "segment.missing", row["id"], {"rel_path": row["rel_path"]})
        self.store.open_alert(
            "segment_missing", row["source"], "critical", iso(now), {"segment_id": row["id"], "rel_path": row["rel_path"]}
        )

    # ── finalisation ──────────────────────────────────────────────────────
    def finalise(self, segment_id: str, reason: str) -> dict:
        row = self.store.one("SELECT * FROM segments WHERE id = ?", (segment_id,))
        if row is None:
            raise KeyError(segment_id)
        path = self.settings.recordings_dir / row["rel_path"]
        started = time.monotonic()
        structure = mp4.inspect(path)
        problems = list(structure.problems)
        probe_result = None
        try:
            probe_result = probe(path)
        except ProbeError as exc:
            problems.append(f"ffprobe: {exc}")
        if probe_result is None or not structure.has_media:
            state = "corrupt"
        elif structure.is_complete:
            state = "finalized"
        else:
            state = "partial"
        probed = time.monotonic()
        digest = sha256_file(path)
        hashed = time.monotonic()
        now = iso(utcnow())
        start = parse_iso(row["start_utc"])
        duration_ms = probe_result.duration_ms if probe_result else None
        end_utc = iso(start + timedelta(milliseconds=duration_ms)) if duration_ms is not None else None
        values = {
            "id": segment_id,
            "state": state,
            "bytes": structure.file_bytes,
            "complete_bytes": structure.complete_bytes,
            "sha256": digest,
            "problems": json.dumps(problems) if problems else None,
            "duration_ms": duration_ms,
            "end_utc": end_utc,
            "codec": probe_result.codec if probe_result else None,
            "profile": probe_result.profile if probe_result else None,
            "width": probe_result.width if probe_result else None,
            "height": probe_result.height if probe_result else None,
            "fps": probe_result.fps if probe_result else None,
            "time_base": probe_result.time_base if probe_result else None,
            "start_pts": probe_result.start_pts if probe_result else None,
            "start_time_s": probe_result.start_time_s if probe_result else None,
            "has_audio": int(probe_result.has_audio) if probe_result else None,
            "probe_json": json.dumps(probe_result.raw) if probe_result else None,
            "finalized_utc": now,
            "finalize_reason": reason,
            "last_size": structure.file_bytes,
        }
        with self.store.tx() as db:
            db.execute(
                "UPDATE segments SET state=:state, bytes=:bytes, complete_bytes=:complete_bytes, sha256=:sha256,"
                " problems=:problems, duration_ms=:duration_ms, end_utc=:end_utc, codec=:codec, profile=:profile,"
                " width=:width, height=:height, fps=:fps, time_base=:time_base, start_pts=:start_pts,"
                " start_time_s=:start_time_s, has_audio=:has_audio, probe_json=:probe_json,"
                " finalized_utc=:finalized_utc, finalize_reason=:finalize_reason, last_size=:last_size"
                " WHERE id=:id AND state='recording'",
                values,
            )
            # Timings feed the segment-duration choice (docs/fairplay/phase-1-edge-foundation.md).
            Store.log_event(db, now, f"segment.{state}", segment_id, {
                "reason": reason, "sha256": digest, "bytes": structure.file_bytes,
                "inspectProbeMs": round((probed - started) * 1000), "hashMs": round((hashed - probed) * 1000)})
        lost = self.pictures_lost_before(row, path, probe_result) if probe_result else None
        if lost is not None and lost > VIDEO_GAP_MS:
            # The file is whole, so it stays finalized; the loss is recorded and raised.
            problems.append(f"{lost} ms of pictures missing before this segment's first decodable frame")
            with self.store.tx() as db:
                db.execute("UPDATE segments SET problems = ? WHERE id = ?", (json.dumps(problems), segment_id))
            self.store.open_alert("segment_video_gap", row["source"], "warning", now,
                                  {"segment_id": segment_id, "rel_path": row["rel_path"], "lostMs": lost})
        elif lost is not None:
            self.store.resolve_alert("segment_video_gap", row["source"], now)
        if state != "finalized":
            self.store.open_alert(
                f"segment_{state}", row["source"], "warning", now,
                {"segment_id": segment_id, "rel_path": row["rel_path"], "problems": problems},
            )
        # MediaMTX has moved on from this file (an open handle keeps writing regardless, so this
        # can never cost a recording). Read-only stops a casual edit; the hash catches the rest.
        try:
            path.chmod(0o444)
        except OSError:
            pass
        manifest = self.write_sidecar(segment_id)
        self.sync(segment_id, manifest)
        log.info(json.dumps({"event": f"segment.{state}", "rel_path": row["rel_path"], "sha256": digest}))
        return manifest

    def pictures_lost_before(self, row: dict, path: Path, probed) -> int | None:
        """Milliseconds between the previous segment's last picture and this segment's first
        decodable one (a keyframe), on the receive-time clock. None when it cannot be told:
        no previous segment, or no video timing."""
        prev = self.store.one(
            "SELECT start_utc, probe_json FROM segments WHERE source = ? AND start_utc < ? AND probe_json IS NOT NULL"
            " AND state IN ('finalized','partial') ORDER BY start_utc DESC LIMIT 1", (row["source"], row["start_utc"]))
        before = video_span_s(json.loads(prev["probe_json"])) if prev else None
        mine = video_span_s(probed.raw)
        if before is None or mine is None:
            return None
        try:
            first_key = next((pts for pts, key in video_packets(path, "%+10") if key), None)
        except ProbeError:
            return None
        if first_key is None:
            return None
        prev_end = parse_iso(prev["start_utc"]) + timedelta(seconds=before[1])
        first_shown = parse_iso(row["start_utc"]) + timedelta(seconds=first_key - mine[0])
        return max(0, round((first_shown - prev_end).total_seconds() * 1000))

    def sync(self, segment_id: str, manifest: dict | None = None) -> None:
        """Queue the segment's manifest for the cloud: what exists, never the video."""
        manifest = manifest or self.manifest_for(segment_id)
        with self.store.tx() as db:
            outbox.enqueue(db, "segment", segment_id, None, manifest)

    # ── sidecar ───────────────────────────────────────────────────────────
    def manifest_for(self, segment_id: str) -> dict:
        row = self.store.one("SELECT * FROM segments WHERE id = ?", (segment_id,))
        if row is None:
            raise KeyError(segment_id)
        source = self.settings.source(row["source"])
        derivatives = self.store.query(
            "SELECT id, kind, rel_path, bytes, sha256, duration_ms, lost_bytes, created_utc FROM derivatives"
            " WHERE segment_id = ? ORDER BY created_utc", (segment_id,),
        )
        return {
            "schema": MANIFEST_SCHEMA,
            "id": row["id"],
            "source": {
                "name": row["source"],
                "role": source.role if source else None,
                "mediamtxPath": row["source"],
            },
            "state": row["state"],
            "problems": json.loads(row["problems"]) if row["problems"] else [],
            "file": {
                "relPath": row["rel_path"],
                "bytes": row["bytes"],
                "completeBytes": row["complete_bytes"],
                "sha256": row["sha256"],
            },
            "timing": {
                "startUtc": row["start_utc"],
                "endUtc": row["end_utc"],
                "durationMs": row["duration_ms"],
                # useAbsoluteTimestamp is off: the start is MediaMTX's receive time.
                "basis": "mediamtx_receive_time",
            },
            "media": {
                "container": "fmp4",
                "codec": row["codec"],
                "profile": row["profile"],
                "width": row["width"],
                "height": row["height"],
                "fps": row["fps"],
                "timeBase": row["time_base"],
                "startPts": row["start_pts"],
                "startTimeS": row["start_time_s"],
                "hasAudio": None if row["has_audio"] is None else bool(row["has_audio"]),
            },
            "finalizedUtc": row["finalized_utc"],
            "finalizeReason": row["finalize_reason"],
            "verifiedUtc": row["verified_utc"],
            "deletedUtc": row["deleted_utc"],
            "derivatives": derivatives,
            "edge": {"device": self.settings.device_label, "version": __version__},
        }

    def write_sidecar(self, segment_id: str) -> dict:
        manifest = self.manifest_for(segment_id)
        rel = Path(manifest["file"]["relPath"])
        target = self.settings.manifests_dir / rel.parent / f"{rel.stem}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2, sort_keys=True)
            fh.flush()
            os.fsync(fh.fileno())
        tmp.replace(target)
        return manifest

    # ── verification ──────────────────────────────────────────────────────
    def verify(self, segment_id: str) -> dict:
        """Re-hash a final segment. A mismatch means the original changed: never silent."""
        row = self.store.one("SELECT * FROM segments WHERE id = ?", (segment_id,))
        if row is None:
            raise KeyError(segment_id)
        if row["state"] == "recording":
            return {"id": segment_id, "result": "not_final"}
        if row["state"] == "deleted":
            return {"id": segment_id, "result": "deleted"}
        path = self.settings.recordings_dir / row["rel_path"]
        now = iso(utcnow())
        if not path.exists():
            result = {"id": segment_id, "result": "missing"}
        else:
            actual = sha256_file(path)
            result = {
                "id": segment_id,
                "result": "match" if actual == row["sha256"] else "mismatch",
                "expected": row["sha256"],
                "actual": actual,
            }
        with self.store.tx() as db:
            if result["result"] == "match":
                db.execute("UPDATE segments SET verified_utc = ? WHERE id = ?", (now, segment_id))
            Store.log_event(db, now, f"segment.verify.{result['result']}", segment_id, result)
        if result["result"] in ("mismatch", "missing"):
            self.store.open_alert(f"segment_{result['result']}", row["source"], "critical", now, result)
        self.write_sidecar(segment_id)
        return result
