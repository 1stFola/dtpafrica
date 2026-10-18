"""The frames worth a person's time, picked from stored detections and ball rows.

No model and no video: a detect run's boxes and the ball trajectory over them are read,
frames where the detector most likely failed are ranked first, a share of ordinary live
play is mixed in, and each picked frame carries the detector's boxes for that frame as
pre-labels (docs/vision/98, /99).

Causes, strongest first:
- ``ball_missed_between_sightings``: the ball was observed within ``BRACKET_FRAMES`` before
  and after in the same camera segment, but this frame has no ball detection at all. On the
  1XCup clip most such frames show the ball plainly (docs/vision/97).
- ``ball_low_confidence``: a ball box under the trajectory's bar (detect keeps boxes from
  0.30; the trajectory observes from 0.5).
- ``tile_only_ball``: the only ball is one the tiled pass found (``source: ball_tiles``).
- ``random_live_play``: any other live-play frame, chosen by a seeded draw.

Picks are spread: no two within ``min_gap_ms``, so one moment is not labelled ten times.
"""
from __future__ import annotations

import hashlib
import math
from collections.abc import Iterable
from typing import Any

VERSION = "hard-frames/v1"
ROLE = "hard_frames"
BRACKET_FRAMES = 8
TRAJECTORY_MIN_CONFIDENCE = 0.5
TILE_SOURCE = "ball_tiles"
REASON = {"ball_missed_between_sightings": "stage_disagreement", "ball_low_confidence": "low_confidence",
          "tile_only_ball": "stage_disagreement", "random_live_play": "uniform_random"}
SCORE = {"ball_missed_between_sightings": 0.9, "ball_low_confidence": 0.7, "tile_only_ball": 0.6, "random_live_play": 0.1}
MAX_FRAMES = 500
MAX_BOXES = 60
CLASSES = ("player", "goalkeeper", "referee", "ball")


def _number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def boxes_of(frame: dict, width: int, height: int) -> list[dict]:
    """The frame's detections as annotation geometry: normalised top-left and size, clipped to the frame."""
    out = []
    for d in frame.get("detections") or []:
        box = d.get("box") if isinstance(d, dict) else None
        if not isinstance(box, dict) or d.get("class") not in CLASSES or not _number(d.get("confidence")):
            continue
        if not all(_number(box.get(k)) for k in ("x", "y", "width", "height")) or box["width"] <= 0 or box["height"] <= 0:
            continue
        x0, y0 = max(0.0, box["x"] / width), max(0.0, box["y"] / height)
        x1, y1 = min(1.0, (box["x"] + box["width"]) / width), min(1.0, (box["y"] + box["height"]) / height)
        if x1 <= x0 or y1 <= y0:
            continue
        row = {"class": d["class"], "x": round(x0, 6), "y": round(y0, 6), "width": round(x1 - x0, 6), "height": round(y1 - y0, 6), "confidence": round(float(d["confidence"]), 4)}
        if d.get("source"):
            row["source"] = str(d["source"])
        out.append(row)
    out.sort(key=lambda b: (b["class"] != "ball", -b["confidence"]))  # the ball first, then the most confident
    return out[:MAX_BOXES]


def _draw(seed: str, frame: int) -> int:
    return int.from_bytes(hashlib.sha256(f"{seed}:{frame}".encode()).digest()[:8], "big")


def choose(frames: Iterable[dict], ball_rows: list[dict], *, max_frames: int = 200,
           random_share: float = 1 / 3, min_gap_ms: int = 1000, seed: str = "") -> list[dict]:
    """First pass: which frames, and why. Keeps only frame numbers, so a full match fits in memory."""
    if not 1 <= max_frames <= MAX_FRAMES or not 0 <= random_share <= 1 or not 0 <= min_gap_ms <= 60_000:
        raise ValueError("hard frames need 1-500 frames, a random share in 0-1 and a gap of 0-60000 ms")
    rows = {r["frameIndex"]: r for r in ball_rows}
    observed = {f for f, r in rows.items() if r.get("state") == "observed"}

    def bracketed(f: int, camera: Any) -> bool:
        before = any(g in observed and rows[g].get("cameraSegmentId") == camera for g in range(f - BRACKET_FRAMES, f))
        after = any(g in observed and rows[g].get("cameraSegmentId") == camera for g in range(f + 1, f + BRACKET_FRAMES + 1))
        return before and after

    candidates: list[dict] = []
    live: list[dict] = []
    for frame in frames:
        f = frame.get("frameIndex")
        row = rows.get(f)
        # Only live play: a ball row lost as non_play, camera_cut or camera_unknown is not footage to learn the ball from.
        if row is None or (row.get("state") == "lost" and row.get("reason") in ("non_play", "camera_cut", "camera_unknown")):
            continue
        balls = [d for d in frame.get("detections") or [] if isinstance(d, dict) and d.get("class") == "ball" and _number(d.get("confidence"))]
        cause = None
        if not balls and row.get("reason") == "no_detection" and bracketed(f, row.get("cameraSegmentId")):
            cause = "ball_missed_between_sightings"
        elif balls and max(d["confidence"] for d in balls) < TRAJECTORY_MIN_CONFIDENCE:
            cause = "ball_low_confidence"
        elif balls and all(d.get("source") == TILE_SOURCE for d in balls):
            cause = "tile_only_ball"
        entry = {"frameIndex": f, "sourceTimeMs": frame.get("sourceTimeMs")}
        if cause:
            candidates.append(entry | {"cause": cause})
        else:
            live.append(entry)

    hard = sorted(candidates, key=lambda c: (-SCORE[c["cause"]], c["frameIndex"]))
    rand = [c | {"cause": "random_live_play"} for c in sorted(live, key=lambda c: _draw(seed, c["frameIndex"]))]

    def place(pool: list[dict], taken: list[dict], limit: int) -> list[dict]:
        """Greedy, in pool order: each frame at least min_gap_ms from every frame already taken."""
        out: list[dict] = []
        times = [t["sourceTimeMs"] for t in taken]
        for c in pool:
            if len(out) >= limit:
                break
            if all(abs(c["sourceTimeMs"] - t) >= min_gap_ms for t in times):
                times.append(c["sourceTimeMs"]); out.append(c)
        return out

    # The gap bounds how many frames a clip can give, so the random share is of that room,
    # not of max_frames: measure the room with every hard frame placed, keep the best-ranked
    # hard frames for their share, give random play the rest, and top up with hard frames
    # if ordinary play runs short.
    every_hard = place(hard, [], max_frames)
    room = min(max_frames, len(every_hard) + len(place(rand, every_hard, max_frames)))
    picked = every_hard[: room - round(room * random_share)]
    picked += place(rand, picked, room - len(picked))
    picked += place(hard, picked, room - len(picked))
    out = [{"frameIndex": c["frameIndex"], "sourceTimeMs": c["sourceTimeMs"], "cause": c["cause"], "reason": REASON[c["cause"]],
            "score": SCORE[c["cause"]]} for c in picked]
    return sorted(out, key=lambda r: r["frameIndex"])


def attach_boxes(frames: Iterable[dict], picks: list[dict], *, width: int, height: int) -> list[dict]:
    """Second pass: the detector's boxes for each picked frame, as pre-labels."""
    wanted = {p["frameIndex"]: p for p in picks}
    found: dict[int, list[dict]] = {}
    for frame in frames:
        if frame.get("frameIndex") in wanted:
            found[frame["frameIndex"]] = boxes_of(frame, width, height)
    return [p | {"boxes": found.get(p["frameIndex"], [])} for p in picks]
