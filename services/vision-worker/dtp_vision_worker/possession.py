"""Unreviewed proximity candidates, not established football possession.

Join observations on disk, never interpolate player positions or bridge a loss.
Only observed ball raw points near one confirmed player's foot are eligible.
"""
from __future__ import annotations

import hashlib
import json
import math
import sqlite3
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator

from .ball_trajectory import LOST_REASONS, Smoother, integer, number

VERSION = "possession-candidates/v1"
INDEX_ROLE = "possession"
CHUNK_ROLE = "possession_chunk"
UNKNOWN_REASONS = ("ball_lost", "weak_ball", "no_player", "no_near_player", "ambiguous_players", "weak_player", "continuity_pending")
MAX_PLAYER_ROWS = 10_000_000
MAX_PLAYERS_PER_FRAME = 100


@dataclass(frozen=True)
class Config:
    minBallConfidence: float = 0.5
    minPlayerConfidence: float = 0.5
    maxFootDistanceHeights: float = 0.25
    minContinuityMs: int = 200

    @classmethod
    def parse(cls, raw: Any) -> Config:
        if raw is None:
            return cls()
        if not isinstance(raw, dict) or set(raw) - set(asdict(cls())):
            raise ValueError("possessionConfig contains unsupported fields")
        config = cls(**raw)
        if not number(config.minBallConfidence) or not 0 <= config.minBallConfidence <= 1 or not number(config.minPlayerConfidence) or not 0 <= config.minPlayerConfidence <= 1 or not number(config.maxFootDistanceHeights) or not 0 < config.maxFootDistanceHeights <= 0.5 or not integer(config.minContinuityMs) or not 80 <= config.minContinuityMs <= 2000:
            raise ValueError("invalid possession confidence, foot distance or continuity configuration")
        return config


class PlayerIndex:
    """Disk-backed exact-frame join with a bounded in-memory result per frame."""
    def __init__(self, path: Path, clock: Smoother, tracks: Iterable[dict[str, Any]]):
        self.db = sqlite3.connect(path)
        try:
            self.db.execute("CREATE TABLE observations (frame INTEGER, track INTEGER, source_ms INTEGER, x REAL, y REAL, height REAL, confidence REAL, confirmed INTEGER, PRIMARY KEY(frame,track))")
            ids: set[int] = set()
            count = 0
            for track in tracks:
                if not isinstance(track, dict) or not integer(track.get("localTrackId")) or track["localTrackId"] < 0 or track["localTrackId"] in ids:
                    raise ValueError("track IDs must be distinct nonnegative integers")
                ids.add(track["localTrackId"])
                if len(ids) > 50_000:
                    raise ValueError("split footage: too many track IDs")
                if track.get("class") not in {"player", "goalkeeper"}:
                    continue  # referee/ball never controls possession
                if not isinstance(track.get("positions"), list) or not isinstance(track.get("confirmed"), bool):
                    raise ValueError("player tracks need explicit positions and confirmation")
                previous = -1
                for row in track["positions"]:
                    frame = row.get("frameIndex") if isinstance(row, dict) else None
                    if not integer(frame) or not previous < frame < clock.proxy_frames:
                        raise ValueError("player observations must be ordered proxy frame indices")
                    previous = frame
                    expected = round(frame * 1000 / clock.fps)
                    if not integer(row.get("proxyTimeMs")) or not integer(row.get("sourceTimeMs")) or row["proxyTimeMs"] != expected or row["sourceTimeMs"] != clock.offset + expected:
                        raise ValueError("player observation does not share the ball source clock")
                    box = row.get("box")
                    score = row.get("confidence")
                    if not isinstance(box, dict) or any(not number(box.get(k)) for k in ("x", "y", "width", "height")) or not number(score) or not 0 <= score <= 1:
                        raise ValueError("invalid player observation geometry/confidence")
                    x, y, w, h = (box[k] for k in ("x", "y", "width", "height"))
                    if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > clock.width or y + h > clock.height:
                        raise ValueError("player box lies outside the detector image")
                    if frame >= clock.frames:
                        continue  # padded proxy tail is never original-footage evidence
                    count += 1
                    if count > MAX_PLAYER_ROWS:
                        raise ValueError("split footage: possession exceeds ten million player observations")
                    self.db.execute("INSERT INTO observations VALUES (?,?,?,?,?,?,?,?)", (frame, track["localTrackId"], row["sourceTimeMs"], x + w / 2, y + h, h, score, int(track["confirmed"])))
            self.db.commit()
        except Exception:
            self.db.close()
            raise

    def at(self, frame: int) -> list[tuple]:
        rows = self.db.execute("SELECT track,x,y,height,confidence,confirmed FROM observations WHERE frame=? ORDER BY track LIMIT ?", (frame, MAX_PLAYERS_PER_FRAME + 1)).fetchall()
        if len(rows) > MAX_PLAYERS_PER_FRAME:
            raise ValueError("too many player observations in a frame")
        return rows

    def close(self) -> None:
        self.db.close()


def rows(clock: Smoother, balls: Iterable[dict[str, Any]], players: PlayerIndex, config: Config = Config(), constraints=None) -> Iterator[dict[str, Any]]:
    pending: tuple[str, int, int] | None = None
    since = 0
    previous_trajectory: int | None = None
    previous_camera: str | None = None
    previous_observed = False
    count = 0
    for ball in balls:
        i = count
        ms = clock.offset + round(i * 1000 / clock.fps)
        if i >= clock.frames or not isinstance(ball, dict) or not integer(ball.get("frameIndex")) or ball["frameIndex"] != i or not integer(ball.get("sourceTimeMs")) or ball["sourceTimeMs"] != ms:
            raise ValueError("ball rows must cover every original frame in order on the source clock")
        count += 1
        camera = clock.at(ms)
        camera_id = camera["cameraSegmentId"] if camera else None
        if ball.get("cameraSegmentId") != camera_id:
            raise ValueError("ball row camera differs from the pinned segment snapshot")
        state = ball.get("state")
        trajectory = ball.get("trajectoryId")
        if state == "lost":
            if ball.get("reason") not in LOST_REASONS or any(ball.get(k) is not None for k in ("point", "rawPoint", "confidence", "trajectoryId")):
                raise ValueError("a lost ball must have a reason and no carried evidence")
            previous_observed = False
        elif state == "observed":
            if not camera or camera["kind"] != "live_play" or not integer(trajectory) or trajectory <= 0 or ball.get("reason") is not None or not number(ball.get("confidence")) or not 0 <= ball["confidence"] <= 1:
                raise ValueError("observed ball lacks valid live-play evidence")
            for name in ("point", "rawPoint"):
                point = ball.get(name)
                if not isinstance(point, dict) or any(not number(point.get(k)) or not 0 <= point[k] <= 1 for k in ("x", "y")):
                    raise ValueError("observed ball needs normalized image points")
            if (not previous_observed or camera_id != previous_camera) and previous_trajectory is not None and trajectory <= previous_trajectory:
                raise ValueError("ball trajectory must reset after a loss or camera change")
            if previous_trajectory is not None and trajectory < previous_trajectory:
                raise ValueError("ball trajectory IDs cannot go backwards")
            previous_observed = True
            previous_trajectory = trajectory
            previous_camera = camera_id
        else:
            raise ValueError("unsupported ball state")
        reason = "ball_lost"
        chosen = None
        confidence = None
        if state == "observed" and ball["confidence"] < config.minBallConfidence:
            reason = "weak_ball"
        elif state == "observed":
            candidates = players.at(i)
            bx, by = ball["rawPoint"]["x"] * clock.width, ball["rawPoint"]["y"] * clock.height
            nearby = [p for p in candidates if math.hypot(bx - p[1], by - p[2]) / p[3] <= config.maxFootDistanceHeights]
            if not candidates:
                reason = "no_player"
            elif not nearby:
                reason = "no_near_player"
            elif len(nearby) != 1:
                reason = "ambiguous_players"  # never nearest wins in a contested picture
            elif not nearby[0][5] or nearby[0][4] < config.minPlayerConfidence:
                reason = "weak_player"
            else:
                chosen = nearby[0][0]
                confidence = min(ball["confidence"], nearby[0][4])
                reason = None
                if constraints:
                    reason = constraints.check(ms, camera_id, trajectory, (bx, by), nearby[0])
                    if reason:
                        chosen, confidence = None, None
        if constraints and chosen is None and reason not in {"metric_distance", "implausible_motion"}:
            constraints.clear()
        if chosen is None:
            pending = None
        else:
            identity = (camera_id, trajectory, chosen)
            if identity != pending:
                pending, since = identity, ms
            if ms - since < config.minContinuityMs:
                chosen = None
                confidence = None
                reason = "continuity_pending"
        yield {"startMs": ms, "endMs": min(clock.end_ms, clock.offset + round((i + 1) * 1000 / clock.fps)), "frames": 1,
               "state": "candidate" if chosen is not None else "unknown", "cameraSegmentId": camera_id, "trajectoryId": trajectory,
               "localTrackId": chosen, "reason": reason, "evidenceConfidence": confidence, "reviewState": "unreviewed"}
    if count != clock.frames:
        raise ValueError("ball artifact ends before the declared original source window")


def build(clock: Smoother, balls: Iterable[dict[str, Any]], players: PlayerIndex, out_dir: Path, config: Config = Config(), chunk_ms: int = 60_000, constraints=None) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=True)
    chunks = []
    reasons: Counter[str] = Counter()
    candidate_frames = 0
    segments = 0
    current = None
    handle = None
    digest = None
    pending = None

    def flush():
        nonlocal pending, segments
        if pending is None:
            return
        body = (json.dumps(pending, separators=(",", ":"), allow_nan=False) + "\n").encode()
        handle.write(body)
        digest.update(body)
        current["segments"] += 1
        segments += 1
        pending = None

    try:
        for row in rows(clock, balls, players, config, constraints):
            bin_ms = row["startMs"] // chunk_ms * chunk_ms
            if current is None or current["binMs"] != bin_ms:
                flush()
                if handle:
                    handle.close()
                    current["checksumSha256"] = digest.hexdigest()
                filename = f"possession-{len(chunks):06d}.jsonl"
                current = {"file": filename, "binMs": bin_ms, "startMs": row["startMs"], "endMs": row["endMs"], "frames": 0, "segments": 0}
                chunks.append(current)
                handle = (out_dir / filename).open("wb")
                digest = hashlib.sha256()
            if pending and all(pending[k] == row[k] for k in ("state", "reason", "cameraSegmentId", "trajectoryId", "localTrackId")):
                pending["endMs"] = row["endMs"]
                pending["frames"] += 1
                if row["evidenceConfidence"] is not None:
                    pending["evidenceConfidence"] = min(pending["evidenceConfidence"], row["evidenceConfidence"])
            else:
                flush()
                pending = dict(row)
            current["frames"] += 1
            current["endMs"] = row["endMs"]
            if row["state"] == "candidate":
                candidate_frames += 1
            else:
                reasons[row["reason"]] += 1
        flush()
    finally:
        if handle:
            handle.close()
            current["checksumSha256"] = digest.hexdigest()
    from .possession_constraints import VERSION as CALIBRATED_VERSION
    return {"calculationVersion": CALIBRATED_VERSION if constraints else VERSION, **(constraints.evidence() if constraints else {}), "frames": clock.frames, "candidateFrames": candidate_frames, "unknownFrames": clock.frames - candidate_frames,
            "candidateFrameCoverage": candidate_frames / clock.frames, "reasons": dict(reasons), "segments": segments,
            "windowStartMs": clock.offset, "windowEndMs": clock.end_ms, "config": asdict(config), "chunkMs": chunk_ms, "chunks": chunks}
