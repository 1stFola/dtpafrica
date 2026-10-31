"""Evidence clips: a final MP4 of one camera's window around an incident, cut from the
original segments on this disk, with a manifest that says exactly where every byte came from.

Replay never needs this (it streams from MediaMTX's playback server, ADR-0012). A clip is
made only when someone asks for one, as a job in the background:

  1. the window is the incident's, on that camera's calibrated clock;
  2. every original segment the window touches must be final and must still hash to the
     SHA-256 recorded when it was finalised. One that does not is refused, never "used
     anyway", and a segment still being written makes the job wait;
  3. ffmpeg **stream-copies** the window (`-c copy`): no decoding, no re-encoding, so the
     pictures are the camera's own and the cost is a file copy, not an encode of the game.
     A copy cut begins at the keyframe at or before the requested start, so the clip may
     carry up to one GOP of extra lead-in; the manifest says so;
  4. the output is probed, hashed and written read-only beside its manifest. Only then does
     an evidence row exist. No footage means a failed job and no file: there are no empty
     or stand-in evidence assets.

A job interrupted by a restart is found on start-up, its half-written file removed, and run
again. It cannot leave a truncated clip behind, because the clip is written as `.part` and
renamed only after it probes.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Protocol

from . import __version__, audit, incidents, outbox
from .audit import Actor
from .config import Settings
from .naming import iso, parse_iso, utcnow
from .probe import Probe, ProbeError, probe, sha256_file, video_packets
from .store import Store, new_id

MANIFEST_SCHEMA = "fairplay.evidence-manifest/v1"
SCHEMA_FILE = Path(__file__).with_name("schemas") / "evidence-manifest.v1.schema.json"
RETRY_WAIT = timedelta(seconds=15)
GAP_TOLERANCE_MS = 50
CLIP_STATES = ("flagged", "reviewing")


class ClipFailed(Exception):
    """The clip cannot be made from what is on disk. No retry will change that."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class NotYet(Exception):
    """The footage exists but is not final yet: try again shortly."""


class Cutter(Protocol):
    name: str

    def version(self) -> str: ...

    def cut(self, pieces: list[dict], target: Path) -> list[str]:
        """Write `target` from `pieces` ({path, inpointS, outpointS}, either may be None for
        the file's own start or end); return the arguments used."""

    def probe(self, path: Path) -> Probe: ...

    def first_keyframe_s(self, path: Path) -> float | None:
        """The first keyframe's timestamp in an original, or None if there is none early on."""

    def keyframe_before_s(self, path: Path, at_s: float) -> float | None:
        """The last keyframe at or before `at_s` in an original: where a copy cut really starts."""

    def video_pts(self, path: Path) -> list[float]:
        """Every video packet's timestamp in a clip, in presentation order."""


class FfmpegCutter:
    name = "ffmpeg"

    def __init__(self, timeout_s: float = 300):
        self.timeout_s = timeout_s
        self._version: str | None = None

    def _bin(self) -> str:
        found = shutil.which("ffmpeg")
        if not found:
            raise ClipFailed("cutter_missing", "ffmpeg is not on PATH")
        return found

    def version(self) -> str:
        if self._version is None:
            out = subprocess.run([self._bin(), "-hide_banner", "-version"], capture_output=True, timeout=30)
            self._version = out.stdout.decode(errors="replace").splitlines()[0] if out.stdout else "unknown"
        return self._version

    def _run(self, args: list[str]) -> None:
        try:
            out = subprocess.run([self._bin(), *args], capture_output=True, timeout=self.timeout_s)
        except subprocess.TimeoutExpired as exc:
            raise ClipFailed("cut_failed", f"ffmpeg did not finish in {self.timeout_s:.0f} s") from exc
        # ffmpeg can stop reading part-way, log an error and still exit 0. At this log level
        # anything it prints is an error, so anything printed fails the cut.
        errors = out.stderr.decode(errors="replace").strip()
        if out.returncode != 0 or errors:
            raise ClipFailed("cut_failed", errors[:500] or f"ffmpeg exited {out.returncode}")

    def cut(self, pieces: list[dict], target: Path) -> list[str]:
        """Each piece is copied out of its original by input seeking (`-ss` to a keyframe,
        `-t` for its length), then the pieces are joined whole. Phase 3's fixture runs showed
        the concat demuxer's own inpoint/outpoint cannot be trusted with these recordings:
        it refused in-points before a keyframe (EPERM), and on a segment whose audio starts
        after its video it stopped 0.85 s early, both times exiting 0."""
        common = ["-map", "0", "-c", "copy", "-map_metadata", "-1", "-fflags", "+bitexact"]
        final = ["-movflags", "+faststart", "-f", "mp4", "-y", str(target)]
        recorded: list[str] = []
        made: list[Path] = []
        try:
            for i, piece in enumerate(pieces):
                start = piece["inpointS"] if piece["inpointS"] is not None else 0.0
                seek = ["-ss", f"{start:.6f}"] if piece["inpointS"] is not None else []
                length = ["-t", f"{piece['outpointS'] - start:.6f}"]
                out = target if len(pieces) == 1 else target.with_name(f"{target.stem}.piece{i}.part")
                args = ["-nostdin", "-hide_banner", "-loglevel", "error", *seek, "-i", str(piece["path"]),
                        *length, *common, *(final if out == target else ["-f", "mp4", "-y", str(out)])]
                self._run(args)
                recorded += ["<original>" if a == str(piece["path"]) else "<piece>" if a == str(out) else a
                             for a in args] + ["|"]
                if out != target:
                    made.append(out)
            if made:
                with tempfile.NamedTemporaryFile("w", suffix=".txt", dir=target.parent, delete=False,
                                                 encoding="utf-8") as fh:
                    for part in made:
                        fh.write("file '" + str(part).replace("'", r"'\''") + "'\n")
                    listing = fh.name
                try:
                    args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
                            "-i", listing, *common, *final]
                    self._run(args)
                    recorded += ["<piece list>" if a == listing else a for a in args]
                finally:
                    Path(listing).unlink(missing_ok=True)
        finally:
            for part in made:
                part.unlink(missing_ok=True)
        # Recorded without paths: originals and pieces are named in the manifest's sources.
        return [a.replace(str(target), "<clip>") for a in recorded]

    def probe(self, path: Path) -> Probe:
        return probe(path)

    def first_keyframe_s(self, path: Path) -> float | None:
        return next((pts for pts, key in video_packets(path, "%+10") if key), None)

    def keyframe_before_s(self, path: Path, at_s: float) -> float | None:
        keys = [pts for pts, key in video_packets(path, f"%{at_s + 1:.3f}") if key and pts <= at_s + 0.0005]
        return keys[-1] if keys else None

    def video_pts(self, path: Path) -> list[float]:
        return [pts for pts, _ in video_packets(path)]


# ── requesting ────────────────────────────────────────────────────────────

def window_for(store: Store, settings: Settings, incident: dict, source: str) -> dict:
    definition = next(w for w in incidents.window_definitions(
        store, settings, incident["session_id"], parse_iso(incident["event_utc"]), incident["pre_roll_ms"],
        incident["post_roll_ms"]) if w["source"] == source)
    start, end = parse_iso(definition["fromIngestUtc"]), parse_iso(definition["toIngestUtc"])
    return {**definition, "startUtc": iso(start), "durationMs": round((end - start).total_seconds() * 1000),
            "eventAtMs": incident["pre_roll_ms"]}


def job_view(row: dict) -> dict:
    return dict(row)


def _sync_job(db, job_id: str) -> None:
    row = dict(db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone())
    outbox.enqueue(db, "job", job_id, None, row)


def request_clip(store: Store, settings: Settings, incident_id: str, source: str, actor: Actor) -> tuple[dict, bool]:
    """(job, created). Asking twice for the same window returns the first job."""
    incident = incidents.get(store, incident_id)
    if settings.source(source) is None:
        raise incidents.TimingError(f"no configured source named {source!r}")
    if incident["state"] not in CLIP_STATES:
        raise incidents.Conflict(f"evidence is gathered before the finding; this incident is {incident['state']}"
                                 " (reopen it to add evidence)")
    if store.one("SELECT 1 FROM withdrawals w JOIN evidence e ON e.id = w.evidence_id WHERE e.incident_id = ?"
                 " AND e.source = ?", (incident_id, source)):
        # D11: what was withdrawn on request is not made again from the recordings.
        raise incidents.Conflict(f"a clip of this incident from {source} was withdrawn on request; no new one is cut")
    window = window_for(store, settings, incident, source)
    key = f"{incident_id}:{source}:{window['startUtc']}:{window['durationMs']}"
    now = iso(utcnow())
    with store.tx() as db:
        existing = db.execute("SELECT * FROM jobs WHERE dedupe_key = ? AND state IN ('queued','running','succeeded')",
                              (key,)).fetchone()
        if existing:
            return job_view(dict(existing)), False
        job = {"id": new_id(), "kind": "evidence_clip", "incident_id": incident_id,
               "incident_version": incident["version"], "source": source, "window_start_utc": window["startUtc"],
               "window_duration_ms": window["durationMs"], "dedupe_key": key, "state": "queued", "attempts": 0,
               "max_attempts": settings.clip_max_attempts, "next_attempt_utc": now, "requested_by": actor.id,
               "requested_name": actor.name, "created_utc": now}
        db.execute("INSERT INTO jobs (id, kind, incident_id, incident_version, source, window_start_utc,"
                   " window_duration_ms, dedupe_key, state, attempts, max_attempts, next_attempt_utc, requested_by,"
                   " requested_name, created_utc) VALUES (:id, :kind, :incident_id, :incident_version, :source,"
                   " :window_start_utc, :window_duration_ms, :dedupe_key, :state, :attempts, :max_attempts,"
                   " :next_attempt_utc, :requested_by, :requested_name, :created_utc)", job)
        audit.append(db, actor, "evidence.requested", "job", job["id"], 1,
                     {"incidentId": incident_id, "incidentVersion": incident["version"], "source": source,
                      "windowStartUtc": window["startUtc"], "windowDurationMs": window["durationMs"],
                      "calibrationId": window["calibrationId"]})
        _sync_job(db, job["id"])
    return job, True


# ── planning a cut ────────────────────────────────────────────────────────

def plan_cut(store: Store, settings: Settings, source: str, start: datetime, duration_ms: int,
             now: datetime | None = None) -> dict:
    """Which originals cover the window, and where in each. Verifies every one it will use."""
    now = now or utcnow()
    end = start + timedelta(milliseconds=duration_ms)
    rows = store.query(
        "SELECT * FROM segments WHERE source = ? AND state != 'deleted' AND start_utc < ?"
        " AND (end_utc IS NULL OR end_utc > ?) ORDER BY start_utc", (source, iso(end), iso(start)))
    if any(r["state"] == "recording" for r in rows):
        raise NotYet("a segment in this window is still being recorded")
    if end > now - timedelta(seconds=settings.finalize_quiet_seconds + 2) and not any(
            parse_iso(r["end_utc"]) >= end for r in rows if r["end_utc"]):
        raise NotYet("the end of the window has not been recorded and finalised yet")
    pieces, used, problems = [], [], []
    # MediaMTX writes each sample to exactly one segment, in order, so consecutive segments
    # never hold the same footage, even where their recorded times overlap (a clock
    # artefact). Only the window's own edges are trimmed; every segment between is taken
    # whole. Trimming an overlap, as Phase 3 first did, skipped real footage.
    for row in rows:
        if row["state"] == "missing":
            raise ClipFailed("source_missing", f"original {row['rel_path']} is missing from disk")
        if row["state"] == "corrupt" or row["duration_ms"] is None or row["end_utc"] is None:
            problems.append({"segmentId": row["id"], "state": row["state"], "note": "unreadable; not used"})
            continue
        path = settings.recordings_dir / row["rel_path"]
        if not path.exists():
            raise ClipFailed("source_missing", f"original {row['rel_path']} is missing from disk")
        actual = sha256_file(path)
        if actual != row["sha256"]:
            raise ClipFailed("source_mismatch", f"original {row['rel_path']} no longer matches its manifest hash")
        seg_start = parse_iso(row["start_utc"])
        base = row["start_time_s"] or 0.0
        seg_end = seg_start + timedelta(seconds=video_seconds(row))
        lo, hi = max(start, seg_start), min(end, seg_end)
        if hi <= lo:
            continue
        # No in/out point where the piece runs to the segment's own edge: a seek that is not
        # needed is one that cannot fail.
        # The outpoint is always set: without one, the concat demuxer places the next segment
        # after this file's container duration, which includes any audio running past the
        # video, and opens a false gap in the clip's pictures.
        piece = {"path": path, "baseS": base, "spanS": (hi - lo).total_seconds(),
                 "inpointS": None if lo == seg_start else base + (lo - seg_start).total_seconds(),
                 "outpointS": base + (hi - seg_start).total_seconds()}
        pieces.append(piece)
        used.append({"segmentId": row["id"], "relPath": row["rel_path"], "state": row["state"],
                     "startUtc": row["start_utc"], "endUtc": row["end_utc"], "durationMs": row["duration_ms"],
                     "bytes": row["bytes"], "sha256": row["sha256"], "verifiedSha256AtCut": actual,
                     "usedFromUtc": iso(lo), "usedToUtc": iso(hi),
                     "inpointS": None if piece["inpointS"] is None else round(piece["inpointS"], 6),
                     "outpointS": round(piece["outpointS"], 6)})
    if not pieces:
        raise ClipFailed("no_footage", "no recording of this camera covers the window")
    gaps, cursor = [], start
    for u in used:
        lo, hi = parse_iso(u["usedFromUtc"]), parse_iso(u["usedToUtc"])
        if (lo - cursor).total_seconds() * 1000 > GAP_TOLERANCE_MS:
            gaps.append({"fromUtc": iso(cursor), "toUtc": iso(lo), "durationMs": round((lo - cursor).total_seconds() * 1000)})
        cursor = max(cursor, hi)
    if (end - cursor).total_seconds() * 1000 > GAP_TOLERANCE_MS:
        gaps.append({"fromUtc": iso(cursor), "toUtc": iso(end), "durationMs": round((end - cursor).total_seconds() * 1000)})
    covered = duration_ms - sum(g["durationMs"] for g in gaps)
    source_fps = next((r["fps"] for r in rows if r["fps"] and r["state"] in ("finalized", "partial")), None)
    return {"pieces": pieces, "used": used, "gaps": gaps, "unused": problems, "coveredMs": covered,
            "coverage": "full" if not gaps else "partial", "sourceFps": source_fps}


def video_seconds(row: dict) -> float:
    """How long the segment's video lasts, from its first frame. A feed's audio can start
    later or run on past its video, and the container's length then overstates the
    pictures: consecutive segments would overlap and the same moment be cut twice."""
    try:
        raw = json.loads(row["probe_json"] or "{}")
        video = next(s for s in raw.get("streams", []) if s.get("codec_type") == "video")
        return float(video["duration"])
    except (StopIteration, KeyError, TypeError, ValueError):
        return row["duration_ms"] / 1000


# ── fitting the cut to the footage, and checking what came out ───────────

def fit_to_keyframes(plan: dict, cutter: Cutter) -> None:
    """Move any piece's start that falls before its first keyframe onto that keyframe.

    A segment can open with video frames that cannot be decoded, because their keyframe was
    in footage the recorder discarded. Those frames show nothing, so they are not counted
    as covered: the time up to the keyframe is recorded as missing."""
    for piece, used in zip(plan["pieces"], plan["used"]):
        first = cutter.first_keyframe_s(piece["path"])
        start = piece["inpointS"] if piece["inpointS"] is not None else piece["baseS"]
        if first is not None and first > start + 0.001:
            piece["inpointS"] = first
            used["inpointS"] = round(first, 6)
            used["undecodableLeadMs"] = round((first - start) * 1000)
    # A piece whose first keyframe comes after its end has no picture to give.
    for piece, used in list(zip(plan["pieces"], plan["used"])):
        if piece["outpointS"] is not None and piece["inpointS"] is not None and piece["inpointS"] >= piece["outpointS"]:
            used["undecodableLeadMs"] = round(piece["spanS"] * 1000)
            plan["pieces"].remove(piece)
            plan["unused"].append({"segmentId": used["segmentId"], "state": used["state"],
                                   "note": "no keyframe within the part of it the window needed"})
            plan["used"].remove(used)
            plan.setdefault("dropped", []).append(used)
    if not plan["pieces"]:
        raise ClipFailed("no_footage", "no decodable picture of this camera in the window")
    # A copy cut starts at the keyframe at or before the first in-point, so the clip opens
    # with that much footage from before the window. It is shown, but it is not the window.
    head = plan["pieces"][0]
    plan["leadInMs"] = 0
    if head["inpointS"] is not None:
        key = cutter.keyframe_before_s(head["path"], head["inpointS"])
        if key is not None and key < head["inpointS"]:
            plan["leadInMs"] = round((head["inpointS"] - key) * 1000)
            head["inpointS"] = key
            plan["used"][0]["inpointS"] = round(key, 6)


def check_video(pts: list[float], fps: str | None, window_ms: int, plan: dict, window_start: datetime) -> dict:
    """What the clip's video track actually holds, from its packet timestamps (no decode).

    Holes are runs of more than two and a half frames with no picture. Times in UTC are
    approximate: the clip's timeline starts at the requested start, give or take the
    keyframe lead-in."""
    shown = [p for p in pts if p >= -0.001]
    # The sources' own rate, not the clip's average: a clip that repeats footage has more
    # frames in the same time, so its average rate is wrong in exactly the case that matters.
    fps = plan.get("sourceFps") or fps
    try:
        num, _, den = (fps or "25/1").partition("/")
        frame = int(den or 1) / int(num)
    except (ValueError, ZeroDivisionError):
        frame = 0.04
    lead_in = plan.get("leadInMs", 0) / 1000
    origin = (shown[0] if shown else 0.0) + lead_in  # clip time of the window's start
    holes = []
    for a, b in zip(shown, shown[1:]):
        if b - a > 2.5 * frame:
            holes.append({"fromS": round(a + frame, 3), "toS": round(b, 3), "durationMs": round((b - a - frame) * 1000),
                          "approxFromUtc": iso(window_start + timedelta(seconds=a + frame - origin)),
                          "approxToUtc": iso(window_start + timedelta(seconds=b - origin))})
    span = (shown[-1] - shown[0] + frame) if shown else 0.0
    covered = max(0.0, span - lead_in - sum(h["durationMs"] for h in holes) / 1000)
    lead = sum(u.get("undecodableLeadMs", 0) for u in plan["used"])
    missing = max(0, round(window_ms - covered * 1000))
    # More pictures than the lead-in and the window can hold means the recording's own
    # times disagree with its frames: segments whose recorded start times overlap (MediaMTX
    # re-anchoring its clock, "detected drift ... resetting"). The footage is all there,
    # once, but times inside the clip are uncertain by that much, so it is not called full.
    excess = max(0, round((len(shown) * frame - lead_in) * 1000 - (window_ms - missing)))
    return {"method": "video packet timestamps of the clip (no decode)", "fps": fps, "frames": len(shown),
            "firstPtsS": round(shown[0], 3) if shown else None, "lastPtsS": round(shown[-1], 3) if shown else None,
            "leadInMs": plan.get("leadInMs", 0), "holes": holes, "undecodableLeadMs": lead, "missingMs": missing,
            "excessMs": excess,
            "full": not holes and missing <= round(3 * frame * 1000) and excess <= round(3 * frame * 1000)}


# ── running jobs ──────────────────────────────────────────────────────────

def _read_only(path: Path) -> None:
    try:
        path.chmod(stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
    except OSError:
        pass  # the hash, not the mode, is the integrity control


def _finish_failed(store: Store, job: dict, code: str, message: str) -> dict:
    now = iso(utcnow())
    with store.tx() as db:
        db.execute("UPDATE jobs SET state = 'failed', error_code = ?, error = ?, finished_utc = ? WHERE id = ?",
                   (code, message[:500], now, job["id"]))
        audit.append(db, Actor.system(), "evidence.failed", "job", job["id"], None,
                     {"incidentId": job["incident_id"], "source": job["source"], "code": code, "message": message[:500]})
        _sync_job(db, job["id"])
    return store.one("SELECT * FROM jobs WHERE id = ?", (job["id"],))


def build_manifest(store: Store, settings: Settings, job: dict, incident: dict, window: dict, plan: dict,
                   derivative: dict, cutter: Cutter, args: list[str], evidence_id: str, footage_kind: str,
                   created_utc: str) -> dict:
    trail = audit.for_incident(store, incident["id"])
    head = audit.head(store)
    return {
        "schema": MANIFEST_SCHEMA,
        "evidenceId": evidence_id,
        "createdUtc": created_utc,
        "authorityMode": "shadow",
        "footageKind": footage_kind,
        "edge": {"deviceId": store.device_id, "device": settings.device_label, "version": __version__},
        "incident": {
            "id": incident["id"], "version": job["incident_version"], "sessionId": incident["session_id"],
            "matchId": incident["match_id"], "scoreboardEventId": incident["sheet_event_id"],
            "period": incident["period"], "matchMinute": incident["match_minute"],
            "matchSecond": incident["match_second"], "eventUtc": incident["event_utc"],
            "eventUtcBasis": incident["basis"], "category": incident["category"], "playerRef": incident["player_ref"],
        },
        "window": {
            "source": job["source"], "requestedStartUtc": job["window_start_utc"],
            "requestedDurationMs": job["window_duration_ms"],
            # In the clip as cut: after the keyframe lead-in, so a player seeking here finds the moment.
            "eventAtMs": window["eventAtMs"] + plan.get("leadInMs", 0),
            "offsetMs": window["offsetMs"], "uncertaintyMs": window["uncertaintyMs"],
            "calibrationId": window["calibrationId"], "clock": "ingest_utc (MediaMTX receive time)",
        },
        "coverage": {"state": plan["coverage"], "coveredMs": plan["coveredMs"], "gaps": plan["gaps"],
                     "unusedSegments": plan["unused"], "videoCheck": plan["video"]},
        "sources": plan["used"],
        "derivative": derivative,
        "derivation": {
            "method": "copy", "tool": cutter.name, "toolVersion": cutter.version(), "arguments": args,
            "note": ("stream copy, no re-encoding: the pictures are the camera's own. The clip starts at the keyframe"
                     " at or before the requested start, so it may include up to one GOP of lead-in."),
        },
        "custody": {
            "jobId": job["id"],
            "requestedBy": {"id": job["requested_by"], "name": job["requested_name"]},
            "requestedUtc": job["created_utc"],
            "auditHeadAtCut": {"seq": head["seq"], "entryHash": head["entry_hash"]} if head else None,
            "activity": [{"seq": e["seq"], "atUtc": e["at_utc"], "actorId": e["actor_id"], "actorName": e["actor_name"],
                          "action": e["action"], "entityType": e["entity_type"], "entityId": e["entity_id"],
                          "entryHash": e["entry_hash"]} for e in trail],
        },
    }


def run_job(store: Store, settings: Settings, cutter: Cutter, job_id: str, now: datetime | None = None) -> dict:
    job = store.one("SELECT * FROM jobs WHERE id = ?", (job_id,))
    if job is None:
        raise KeyError(job_id)
    if job["state"] != "queued":
        return job
    with store.tx() as db:
        cur = db.execute("UPDATE jobs SET state = 'running', attempts = attempts + 1, started_utc = ? WHERE id = ?"
                         " AND state = 'queued'", (iso(utcnow()), job_id))
        if cur.rowcount != 1:
            return dict(db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone())
    job = store.one("SELECT * FROM jobs WHERE id = ?", (job_id,))
    incident = incidents.get(store, job["incident_id"])
    target_dir = settings.evidence_dir / incident["session_id"] / incident["id"]
    target_dir.mkdir(parents=True, exist_ok=True)
    evidence_id = new_id()
    part = target_dir / f"{evidence_id}.mp4.part"
    try:
        plan = plan_cut(store, settings, job["source"], parse_iso(job["window_start_utc"]), job["window_duration_ms"],
                        now)
        fit_to_keyframes(plan, cutter)
        args = cutter.cut(plan["pieces"], part)
        try:
            probed = cutter.probe(part)
            video = check_video(cutter.video_pts(part), probed.fps, job["window_duration_ms"], plan,
                                parse_iso(job["window_start_utc"]))
        except ProbeError as exc:
            raise ClipFailed("cut_failed", f"the cut does not probe: {exc}") from exc
        if not part.exists() or part.stat().st_size == 0 or not probed.duration_ms or not video["frames"]:
            raise ClipFailed("empty_output", "the cut produced no playable video")
        # The clip's coverage is what its pictures hold, never only what was planned.
        lost = [{"fromUtc": h["approxFromUtc"], "toUtc": h["approxToUtc"], "durationMs": h["durationMs"],
                 "kind": "video"} for h in video["holes"]]
        for u in plan["used"] + plan.get("dropped", []):
            if u.get("undecodableLeadMs"):
                lo = parse_iso(u["usedFromUtc"])
                lost.append({"fromUtc": u["usedFromUtc"], "toUtc": iso(lo + timedelta(milliseconds=u["undecodableLeadMs"])),
                             "durationMs": u["undecodableLeadMs"], "kind": "undecodable"})
        plan["gaps"] = sorted([{**g, "kind": g.get("kind", "not_recorded")} for g in plan["gaps"]] + lost,
                              key=lambda g: g["fromUtc"])
        plan["video"] = video
        if not video["full"] or plan["gaps"]:
            plan["coverage"] = "partial"
            plan["coveredMs"] = min(plan["coveredMs"], job["window_duration_ms"] - video["missingMs"])
    except NotYet as exc:
        part.unlink(missing_ok=True)
        with store.tx() as db:
            # Waiting is not a failed attempt.
            db.execute("UPDATE jobs SET state = 'queued', attempts = attempts - 1, next_attempt_utc = ?, error = ?"
                       " WHERE id = ?", (iso(utcnow() + RETRY_WAIT), str(exc), job_id))
        return store.one("SELECT * FROM jobs WHERE id = ?", (job_id,))
    except ClipFailed as exc:
        part.unlink(missing_ok=True)
        return _finish_failed(store, job, exc.code, str(exc))
    except Exception as exc:  # anything unforeseen: retry a bounded number of times
        part.unlink(missing_ok=True)
        if job["attempts"] >= job["max_attempts"]:
            return _finish_failed(store, job, "cut_failed", f"{exc.__class__.__name__}: {exc}")
        with store.tx() as db:
            db.execute("UPDATE jobs SET state = 'queued', next_attempt_utc = ?, error = ? WHERE id = ?",
                       (iso(utcnow() + RETRY_WAIT * job["attempts"]), f"{exc.__class__.__name__}: {exc}"[:500], job_id))
        return store.one("SELECT * FROM jobs WHERE id = ?", (job_id,))

    clip = target_dir / f"{evidence_id}.mp4"
    part.replace(clip)
    _read_only(clip)
    created = iso(utcnow())
    rel = clip.relative_to(settings.evidence_dir).as_posix()
    derivative = {"relPath": rel, "container": "mp4", "bytes": clip.stat().st_size, "sha256": sha256_file(clip),
                  "durationMs": probed.duration_ms, "codec": probed.codec, "width": probed.width,
                  "height": probed.height, "fps": probed.fps, "hasAudio": probed.has_audio}
    window = window_for(store, settings, incident, job["source"])
    footage_kind = incidents.current_rights(store, incident["session_id"])["footage_kind"]
    manifest = build_manifest(store, settings, job, incident, window, plan, derivative, cutter, args, evidence_id,
                              footage_kind, created)
    manifest_path = target_dir / f"{evidence_id}.manifest.json"
    body = json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    tmp = manifest_path.with_suffix(".json.part")
    with tmp.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
        fh.flush()
        os.fsync(fh.fileno())
    tmp.replace(manifest_path)
    _read_only(manifest_path)
    manifest_sha = sha256_file(manifest_path)
    row = {"id": evidence_id, "incident_id": incident["id"], "incident_version": job["incident_version"],
           "session_id": incident["session_id"], "source": job["source"], "job_id": job_id, "state": "ready",
           "derivation": "copy", "footage_kind": footage_kind, "window_start_utc": job["window_start_utc"],
           "window_duration_ms": job["window_duration_ms"], "coverage": plan["coverage"],
           "covered_ms": plan["coveredMs"], "duration_ms": probed.duration_ms, "rel_path": rel,
           "bytes": derivative["bytes"], "sha256": derivative["sha256"],
           "manifest_rel_path": manifest_path.relative_to(settings.evidence_dir).as_posix(),
           "manifest_sha256": manifest_sha, "source_segment_ids": json.dumps([u["segmentId"] for u in plan["used"]]),
           "created_by": job["requested_by"], "created_utc": created}
    with store.tx() as db:
        db.execute("INSERT INTO evidence (id, incident_id, incident_version, session_id, source, job_id, state,"
                   " derivation, footage_kind, window_start_utc, window_duration_ms, coverage, covered_ms, duration_ms,"
                   " rel_path, bytes, sha256, manifest_rel_path, manifest_sha256, source_segment_ids, created_by,"
                   " created_utc) VALUES (:id, :incident_id, :incident_version, :session_id, :source, :job_id, :state,"
                   " :derivation, :footage_kind, :window_start_utc, :window_duration_ms, :coverage, :covered_ms,"
                   " :duration_ms, :rel_path, :bytes, :sha256, :manifest_rel_path, :manifest_sha256,"
                   " :source_segment_ids, :created_by, :created_utc)", row)
        # Retention already refuses to delete a segment that unsynced evidence references.
        for u in plan["used"]:
            db.execute("INSERT INTO evidence_refs (id, segment_id, synced, created_utc) VALUES (?, ?, 0, ?)",
                       (new_id(), u["segmentId"], created))
        db.execute("UPDATE jobs SET state = 'succeeded', evidence_id = ?, finished_utc = ?, error = NULL,"
                   " error_code = NULL WHERE id = ?", (evidence_id, created, job_id))
        audit.append(db, Actor.system(), "evidence.created", "evidence", evidence_id, 1,
                     {"incidentId": incident["id"], "jobId": job_id, "sha256": row["sha256"], "bytes": row["bytes"],
                      "manifestSha256": manifest_sha, "coverage": plan["coverage"],
                      "sourceSha256": [u["sha256"] for u in plan["used"]]})
        outbox.enqueue(db, "evidence", evidence_id, 1, evidence_view(row))
        _sync_job(db, job_id)
    return store.one("SELECT * FROM jobs WHERE id = ?", (job_id,))


def recover(store: Store, settings: Settings) -> list[str]:
    """After a restart: jobs that were running were interrupted. Remove their half-written
    output and queue them again, or fail them if they have used their attempts."""
    interrupted = store.query("SELECT * FROM jobs WHERE state = 'running'")
    for job in interrupted:
        if job["attempts"] >= job["max_attempts"]:
            _finish_failed(store, job, "interrupted", "interrupted by a restart too many times")
            continue
        with store.tx() as db:
            db.execute("UPDATE jobs SET state = 'queued', next_attempt_utc = ?, error = 'interrupted by a restart'"
                       " WHERE id = ? AND state = 'running'", (iso(utcnow()), job["id"]))
            Store.log_event(db, iso(utcnow()), "job.recovered", None, {"id": job["id"]})
    if settings.evidence_dir.exists():
        for leftover in settings.evidence_dir.rglob("*.part"):
            leftover.unlink(missing_ok=True)
    return [j["id"] for j in interrupted]


def due_job(store: Store, now: datetime | None = None) -> dict | None:
    return store.one("SELECT * FROM jobs WHERE state = 'queued' AND next_attempt_utc <= ? ORDER BY created_utc LIMIT 1",
                     (iso(now or utcnow()),))


# ── reading, approving and exporting ──────────────────────────────────────

def evidence_view(row: dict) -> dict:
    out = dict(row)
    out["source_segment_ids"] = json.loads(row["source_segment_ids"])
    return out


def get(store: Store, evidence_id: str) -> dict:
    row = store.one("SELECT * FROM evidence WHERE id = ?", (evidence_id,))
    if row is None:
        raise incidents.NotFound(evidence_id)
    return evidence_view(row)


def released(store: Store, row: dict) -> tuple[bool, str]:
    """Visible outside the Edge's staff: approved, its incident's finding stands, and the
    session's rights permit it, all checked at the moment of reading. Never once withdrawn."""
    if withdrawal_of(store, row["id"]):
        return False, "withdrawn on request"
    if row["state"] != "approved":
        return False, "not approved for release"
    incident = incidents.get(store, row["incident_id"])
    if incident["state"] not in ("reviewed", "archived"):
        return False, "the incident has been reopened; its evidence is withheld until the new finding"
    return incidents.release_check(incidents.current_rights(store, row["session_id"]))


def approve(store: Store, settings: Settings, evidence_id: str, actor: Actor) -> dict:
    row = get(store, evidence_id)
    incident = incidents.get(store, row["incident_id"])
    if incident["state"] not in ("reviewed", "archived"):
        raise incidents.Conflict("evidence is approved for release only after the incident's finding is complete")
    ok, why = incidents.release_check(incidents.current_rights(store, row["session_id"]))
    if not ok:
        raise incidents.Conflict(why)
    if withdrawal_of(store, evidence_id):
        raise incidents.Conflict("this clip was withdrawn on request")
    if row["state"] == "approved":
        return row
    verify_file(store, settings, row)
    now = iso(utcnow())
    with store.tx() as db:
        db.execute("UPDATE evidence SET state = 'approved', approved_by = ?, approved_name = ?, approved_utc = ?"
                   " WHERE id = ? AND state = 'ready'", (actor.id, actor.name, now, evidence_id))
        audit.append(db, actor, "evidence.approved", "evidence", evidence_id, 2,
                     {"incidentId": row["incident_id"], "sha256": row["sha256"], "basis": why})
        outbox.enqueue(db, "evidence", evidence_id, 2,
                       evidence_view(dict(db.execute("SELECT * FROM evidence WHERE id = ?", (evidence_id,)).fetchone())))
    return get(store, evidence_id)


def path_of(settings: Settings, row: dict, key: str = "rel_path") -> Path:
    return settings.evidence_dir / row[key]


def verify_file(store: Store, settings: Settings, row: dict, clip: bool = True) -> None:
    """Both files against their recorded hashes; only the manifest once the clip is withdrawn."""
    files = (("rel_path", row["sha256"]), ("manifest_rel_path", row["manifest_sha256"]))
    for key, digest in files if clip else files[1:]:
        path = path_of(settings, row, key)
        if not path.exists():
            raise ClipFailed("evidence_missing", f"{row[key]} is missing")
        if sha256_file(path) != digest:
            store.open_alert("evidence_mismatch", row["source"], "critical", iso(utcnow()),
                             {"evidenceId": row["id"], "file": row[key]})
            raise ClipFailed("evidence_mismatch", f"{row[key]} no longer matches its recorded hash")


# ── withdrawal on request (decisions.md D11) ──────────────────────────────

def withdrawal_of(store: Store, evidence_id: str) -> dict | None:
    return store.one("SELECT * FROM withdrawals WHERE evidence_id = ?", (evidence_id,))


def withdraw(store: Store, settings: Settings, evidence_id: str, reason: str, requester: str, actor: Actor, *,
             origin: str = "edge", withdrawal_id: str | None = None, request_ref: str | None = None) -> dict:
    """Remove a clip at a player's or a parent's request: the clip file and any export
    package of it are deleted, its uploads are cancelled, and it is never released, exported
    or cut again. The evidence row, its manifest and a withdrawal row stay: the hash, the
    size, the reason and the requester. Synced to the cloud, which removes its copies.

    `origin` "cloud" applies a withdrawal made in the cloud, under the cloud's id."""
    row = get(store, evidence_id)
    held = withdrawal_of(store, evidence_id)
    if held:
        return held
    reason, requester = reason.strip(), requester.strip()
    if len(reason) < 5 or len(requester) < 2:
        raise incidents.TimingError("a withdrawal needs its reason and the requester")
    removed = []
    exports = settings.data_dir / "exports"
    for path in (path_of(settings, row), *sorted(exports.glob(f"fairplay-evidence-{evidence_id}.zip*"))):
        if path.exists():
            path.chmod(0o600)  # clips are made read-only when cut
            path.unlink()
            removed.append(path.relative_to(settings.data_dir).as_posix())
    w = {"id": withdrawal_id or new_id(), "evidence_id": evidence_id, "origin": origin, "reason": reason,
         "requester": requester, "request_ref": request_ref, "clip_sha256": row["sha256"], "clip_bytes": row["bytes"],
         "removed_files": json.dumps(removed), "actor_id": actor.id, "actor_name": actor.name, "created_utc": iso(utcnow())}
    with store.tx() as db:
        db.execute("INSERT INTO withdrawals (id, evidence_id, origin, reason, requester, request_ref, clip_sha256, clip_bytes,"
                   " removed_files, actor_id, actor_name, created_utc) VALUES (:id, :evidence_id, :origin, :reason,"
                   " :requester, :request_ref, :clip_sha256, :clip_bytes, :removed_files, :actor_id, :actor_name,"
                   " :created_utc)", w)
        db.execute("DELETE FROM uploads WHERE evidence_id = ?", (evidence_id,))
        # D13: ids and hashes in the chain; the requester and the reason stay on the withdrawal row.
        audit.append(db, actor, "evidence.withdrawn", "evidence", evidence_id, None,
                     {"withdrawalId": w["id"], "origin": origin, "sha256": row["sha256"], "removedFiles": len(removed)})
        outbox.enqueue(db, "withdrawal", w["id"], 1, {**w, "removed_files": removed})
    return withdrawal_of(store, evidence_id)


def export_package(store: Store, settings: Settings, row: dict, actor: Actor, out_dir: Path) -> tuple[Path, str]:
    """A zip of the clip, its manifest and a SHA256SUMS file, for handing to an organiser."""
    verify_file(store, settings, row)
    clip, manifest = path_of(settings, row), path_of(settings, row, "manifest_rel_path")
    sums = f"{row['sha256']}  clip.mp4\n{row['manifest_sha256']}  manifest.json\n"
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"fairplay-evidence-{row['id']}.zip"
    tmp = target.with_suffix(".zip.part")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED) as z:
        # Fixed dates, so the same evidence always makes byte-identical packages.
        for name, data in (("clip.mp4", clip.read_bytes()), ("manifest.json", manifest.read_bytes()),
                           ("SHA256SUMS", sums.encode())):
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            z.writestr(info, data)
    tmp.replace(target)
    package_sha = sha256_file(target)
    audit.record(store, actor, "evidence.exported", "evidence", row["id"], None,
                 {"incidentId": row["incident_id"], "packageSha256": package_sha, "clipSha256": row["sha256"],
                  "manifestSha256": row["manifest_sha256"]})
    return target, package_sha
