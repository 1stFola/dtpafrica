"""Per-frame calibrations of keyframed camera segments, read from a pinned `calibrate` run.

A segment calibrated by keyframes (a moving camera) has no one homography: each frame
has its own, carried from the nearest keyframe along the measured motion
(docs/vision/93). Stages that place things in metres -- possession, carry, game state
-- read them through this, by frame, only for the segments the control plane declared
as carried. The run is pinned by its index checksum; every chunk is checked against
the checksum its index recorded, so the rows read are the rows the run wrote.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable
from typing import Any

PASSING = ("good", "usable")
INDEX_ROLE = "calibration_frames"
MAX_CHUNKS = 6000


def parse_pin(raw: object) -> dict[str, Any]:
    """The control plane's pin of a calibrate run: job, index key and checksum, chunk keys."""
    if not isinstance(raw, dict):
        raise ValueError("carried calibrations need a pinned calibrate run")
    keys = raw.get("chunkKeys")
    if (not isinstance(raw.get("jobId"), str) or not raw["jobId"] or not isinstance(raw.get("indexKey"), str) or not raw["indexKey"]
            or not isinstance(raw.get("indexChecksum"), str) or not re.fullmatch(r"[a-f0-9]{64}", raw["indexChecksum"])
            or not isinstance(keys, list) or not keys or len(keys) > MAX_CHUNKS or any(not isinstance(k, str) or not k for k in keys) or len(set(keys)) != len(keys)):
        raise ValueError("the pinned calibrate run is malformed")
    return raw


class CarriedFrames:
    """Frame -> (segment, homography) for keyframed segments, where the run carried one."""

    def __init__(self, by_frame: dict[int, tuple[str, tuple[float, ...]]], fps: float, offset: int) -> None:
        self._by_frame = by_frame
        self._fps = fps
        self._offset = offset

    @classmethod
    def from_rows(cls, rows: Iterable[dict[str, Any]], segment_ids: set[str], fps: float, offset: int) -> CarriedFrames:
        by_frame: dict[int, tuple[str, tuple[float, ...]]] = {}
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("f"), int) or isinstance(row.get("f"), bool) or row["f"] < 0:
                raise ValueError("a carried calibration row needs its frame")
            sid, h, quality = row.get("cameraSegmentId"), row.get("H"), row.get("quality")
            if sid not in segment_ids or h is None:
                continue
            if quality not in PASSING or not isinstance(h, list) or len(h) != 9 or any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) for v in h):
                raise ValueError(f"carried calibration of frame {row['f']} is not a passing finite homography")
            if row["f"] in by_frame:
                raise ValueError(f"frame {row['f']} is carried twice")
            by_frame[row["f"]] = (sid, tuple(float(v) for v in h))
        return cls(by_frame, fps, offset)

    def frame_of(self, source_ms: int) -> int:
        """The proxy frame starting at a source millisecond, on the pipeline's round-to-even clock."""
        return int(round((source_ms - self._offset) * self._fps / 1000))

    def at(self, frame: int, segment_id: str) -> tuple[float, ...] | None:
        """The frame's carried homography on that segment, or None: no keyframe reached it."""
        found = self._by_frame.get(frame)
        return found[1] if found and found[0] == segment_id else None

    def at_ms(self, source_ms: int, segment_id: str) -> tuple[float, ...] | None:
        return self.at(self.frame_of(source_ms), segment_id)

    def __len__(self) -> int:
        return len(self._by_frame)


def load(ctx: Any, pin: dict[str, Any], segment_ids: set[str], fps: float, offset: int) -> tuple[CarriedFrames, int]:
    """Download and check the pinned run; returns the frames and the bytes read."""
    from .media import sha256_file
    from .runner import download

    pin = parse_pin(pin)
    index_path = ctx.work_dir / "calibration-frames.json"
    read = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=pin["indexKey"]), index_path)
    if sha256_file(index_path) != pin["indexChecksum"]:
        raise ValueError("the carried calibration index is not the one pinned")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    if index.get("role") != INDEX_ROLE or index.get("proxy", {}).get("fps") != fps or index.get("proxy", {}).get("sourceOffsetMs") != offset:
        raise ValueError("the carried calibrations have another role or clock")
    chunks = index.get("chunks")
    if not isinstance(chunks, list) or [c.get("key") if isinstance(c, dict) else None for c in chunks] != pin["chunkKeys"]:
        raise ValueError("the carried calibration chunks differ from the pinned keys")

    def rows() -> Iterable[dict[str, Any]]:
        nonlocal read
        for n, chunk in enumerate(chunks):
            path = ctx.work_dir / f"carried-{n:04d}.jsonl"
            read += download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=chunk["key"]), path)
            if sha256_file(path) != chunk.get("sha256"):
                raise ValueError(f"carried calibration chunk {chunk['key']} changed")
            with path.open("rb") as handle:
                for line in handle:
                    if line.strip():
                        yield json.loads(line)
            path.unlink()

    frames = CarriedFrames.from_rows(rows(), segment_ids, fps, offset)
    return frames, read
