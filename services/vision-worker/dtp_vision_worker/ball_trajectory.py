"""Causal image-space ball smoothing. Lost frames never carry a coordinate.

No learned model, pitch projection, interpolation, identity or possession claim.
Only one sufficiently confident, geometrically valid ball in declared live play
is an observation. Every missing frame and every abstention resets the smoother.
"""
from __future__ import annotations

import bisect
import hashlib
import json
import math
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

VERSION = "ball-trajectory/v1"
INDEX_ROLE = "ball_trajectory"
CHUNK_ROLE = "ball_trajectory_chunk"
LOST_REASONS = ("missing_frame", "no_detection", "low_confidence", "ambiguous", "invalid_detection", "motion_jump", "camera_unknown", "camera_cut", "non_play")
SEGMENT_KINDS = {"live_play", "replay", "intro", "halftime", "camera_cut", "unknown"}
MAX_FRAMES = 1_000_000


def number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


@dataclass(frozen=True)
class Config:
    minConfidence: float = 0.5
    smoothingMs: float = 120.0
    maxImageSpeedPerSecond: float = 2.0

    @classmethod
    def parse(cls, raw: Any) -> Config:
        if raw is None:
            return cls()
        if not isinstance(raw, dict) or set(raw) - set(asdict(cls())):
            raise ValueError("trajectoryConfig must contain only the supported configuration fields")
        config = cls(**raw)
        if any(not number(v) for v in asdict(config).values()) or not 0 <= config.minConfidence <= 1 or not 0 <= config.smoothingMs <= 1000 or not 0 < config.maxImageSpeedPerSecond <= 100:
            raise ValueError("invalid ball trajectory confidence, smoothing or image speed configuration")
        return config


class Smoother:
    def __init__(self, *, fps: float, source_offset_ms: int, source_duration_ms: int, proxy_duration_ms: int, width: int, height: int, segments: list[dict[str, Any]], config: Config = Config()):
        if not number(fps) or not 10 <= fps <= 120 or any(not integer(v) or v <= 0 for v in (source_duration_ms, proxy_duration_ms, width, height)):
            raise ValueError("ball trajectory needs a valid proxy clock, duration and dimensions")
        if not integer(source_offset_ms) or not 0 <= source_offset_ms < source_duration_ms:
            raise ValueError("proxy source offset must be inside the original footage")
        self.fps, self.offset, self.width, self.height, self.config = fps, source_offset_ms, width, height, config
        self.end_ms = min(source_duration_ms, source_offset_ms + proxy_duration_ms)
        self.frames = math.ceil((self.end_ms - self.offset) * fps / 1000)
        self.proxy_frames = math.ceil(proxy_duration_ms * fps / 1000)
        if self.proxy_frames > MAX_FRAMES:
            raise ValueError("split the footage: ball trajectory supports at most one million proxy frames")
        if not isinstance(segments, list):
            raise ValueError("segments must be an explicit list")
        seen: set[str] = set()
        for segment in segments:
            if not isinstance(segment, dict) or not isinstance(segment.get("cameraSegmentId"), str) or not segment["cameraSegmentId"] or segment["cameraSegmentId"] in seen:
                raise ValueError("camera segment IDs must be distinct nonempty strings")
            seen.add(segment["cameraSegmentId"])
            if not integer(segment.get("startMs")) or not integer(segment.get("endMs")) or not 0 <= segment["startMs"] < segment["endMs"] <= source_duration_ms or segment.get("kind") not in SEGMENT_KINDS:
                raise ValueError("camera segments need supported kinds and bounded source windows")
        self.segments = sorted(segments, key=lambda s: s["startMs"])
        if any(b["startMs"] < a["endMs"] for a, b in zip(self.segments, self.segments[1:])):
            raise ValueError("camera segments must not overlap")
        self.starts = [s["startMs"] for s in self.segments]
        self.previous: tuple[int, float, float, float, float] | None = None
        self.camera: str | None = None
        self.trajectory_id = 0

    def at(self, ms: int) -> dict[str, Any] | None:
        index = bisect.bisect_right(self.starts, ms) - 1
        return self.segments[index] if index >= 0 and ms < self.segments[index]["endMs"] else None

    def row(self, index: int, frame: dict[str, Any] | None) -> dict[str, Any]:
        ms = self.offset + round(index * 1000 / self.fps)
        segment = self.at(ms)
        camera = segment["cameraSegmentId"] if segment else None
        if camera != self.camera:
            self.previous = None
        self.camera = camera
        result = {"frameIndex": index, "sourceTimeMs": ms, "cameraSegmentId": camera, "trajectoryId": None,
                  "state": "lost", "reason": None, "point": None, "rawPoint": None, "confidence": None}
        reason: str | None = None
        if frame is None:
            reason = "missing_frame"
        elif not segment or segment["kind"] == "unknown":
            reason = "camera_unknown"
        elif segment["kind"] == "camera_cut":
            reason = "camera_cut"
        elif segment["kind"] != "live_play":
            reason = "non_play"
        else:
            balls = [d for d in frame["detections"] if isinstance(d, dict) and d.get("class") == "ball"]
            valid: list[tuple[float, float, float]] = []
            for ball in balls:
                box = ball.get("box")
                score = ball.get("confidence")
                if not number(score) or not 0 <= score <= 1 or not isinstance(box, dict) or any(not number(box.get(k)) for k in ("x", "y", "width", "height")):
                    reason = "invalid_detection"; break
                if box["x"] < 0 or box["y"] < 0 or box["width"] <= 0 or box["height"] <= 0 or box["x"] + box["width"] > self.width or box["y"] + box["height"] > self.height:
                    reason = "invalid_detection"; break
                if score >= self.config.minConfidence:
                    valid.append(((box["x"] + box["width"] / 2) / self.width, (box["y"] + box["height"] / 2) / self.height, score))
            if reason is None:
                if not balls: reason = "no_detection"
                elif not valid: reason = "low_confidence"
                elif len(valid) != 1: reason = "ambiguous"
                else:
                    x, y, score = valid[0]
                    if self.previous:
                        previous_ms, raw_x, raw_y, filtered_x, filtered_y = self.previous
                        elapsed = ms - previous_ms
                        if math.hypot(x - raw_x, y - raw_y) * 1000 / elapsed > self.config.maxImageSpeedPerSecond:
                            reason = "motion_jump"
                        else:
                            alpha = 1 - math.exp(-elapsed / self.config.smoothingMs) if self.config.smoothingMs else 1
                            filtered_x += alpha * (x - filtered_x); filtered_y += alpha * (y - filtered_y)
                    else:
                        self.trajectory_id += 1
                        filtered_x, filtered_y = x, y
                    if reason is None:
                        self.previous = (ms, x, y, filtered_x, filtered_y)
                        result.update(state="observed", trajectoryId=self.trajectory_id, point={"x": filtered_x, "y": filtered_y}, rawPoint={"x": x, "y": y}, confidence=score)
        if reason:
            self.previous = None
            result["reason"] = reason
        return result

    def rows(self, frames: Iterable[dict[str, Any]]) -> Iterator[dict[str, Any]]:
        next_index, last_seen = 0, -1
        for frame in frames:
            if not isinstance(frame, dict) or not integer(frame.get("frameIndex")):
                raise ValueError("detect frames must name integer frame indices")
            index = frame["frameIndex"]
            if not last_seen < index < self.proxy_frames:
                raise ValueError("detect frame indices must increase without duplicates and stay inside the proxy")
            last_seen = index
            expected_ms = round(index * 1000 / self.fps)
            if not integer(frame.get("sourceTimeMs")) or not integer(frame.get("proxyTimeMs")) or abs(frame["proxyTimeMs"] - expected_ms) > 1 or frame["sourceTimeMs"] != frame["proxyTimeMs"] + self.offset:
                raise ValueError("detect source and proxy timestamps disagree with the declared frame clock")
            if not isinstance(frame.get("detections"), list) or any(not isinstance(d, dict) for d in frame["detections"]):
                raise ValueError("each detect frame must contain an explicit detections array")
            if index >= self.frames:  # Ignore padded proxy tail beyond the original source.
                continue
            while next_index < index:
                yield self.row(next_index, None); next_index += 1
            yield self.row(index, frame); next_index = index + 1
        while next_index < self.frames:
            yield self.row(next_index, None); next_index += 1


def build(smoother: Smoother, frames: Iterable[dict[str, Any]], out_dir: Path, chunk_ms: int = 60_000) -> dict[str, Any]:
    if not integer(chunk_ms) or chunk_ms <= 0:
        raise ValueError("chunkMs must be a positive integer")
    out_dir.mkdir(parents=True, exist_ok=True)
    chunks: list[dict[str, Any]] = []
    reasons: Counter[str] = Counter()
    observed = 0
    handle = None
    current = None
    digest = None
    try:
        for row in smoother.rows(frames):
            bin_ms = row["sourceTimeMs"] // chunk_ms * chunk_ms
            if current is None or current["binMs"] != bin_ms:
                if handle:
                    handle.close(); current["checksumSha256"] = digest.hexdigest()
                filename = f"ball-{len(chunks):06d}.jsonl"
                current = {"file": filename, "binMs": bin_ms, "startMs": row["sourceTimeMs"], "endMs": row["sourceTimeMs"], "rows": 0}
                chunks.append(current); handle = (out_dir / filename).open("wb"); digest = hashlib.sha256()
            body = (json.dumps(row, separators=(",", ":"), allow_nan=False) + "\n").encode()
            handle.write(body); digest.update(body)
            current["rows"] += 1
            current["endMs"] = min(smoother.end_ms, smoother.offset + round((row["frameIndex"] + 1) * 1000 / smoother.fps))
            if row["state"] == "observed": observed += 1
            else: reasons[row["reason"]] += 1
    finally:
        if handle:
            handle.close(); current["checksumSha256"] = digest.hexdigest()
    return {"calculationVersion": VERSION, "frames": smoother.frames, "observed": observed, "lost": smoother.frames - observed,
            "observedFrameCoverage": observed / smoother.frames, "reasons": dict(reasons), "chunkMs": chunk_ms, "chunks": chunks,
            "windowStartMs": smoother.offset, "windowEndMs": smoother.end_ms, "config": asdict(smoother.config)}
