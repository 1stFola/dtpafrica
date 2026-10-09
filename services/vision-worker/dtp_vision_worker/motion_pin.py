"""The camera motion a stage was pinned to, downloaded and checked, and chained per shot.

Shared by `calibrate` (carrying keyframes along the motion) and `ball_trajectory`
(finding a tiled ball that stays on one spot of the ground). The index must be the one
the control plane pinned, measured on the same proxy bytes and clock, and every chunk
must match the checksum its index recorded. The caller passes its own `download`, so a
stage's tests stub one function.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import numpy as np

from .calibration_propagation import chain
from .camera_motion import INDEX_ROLE as MOTION_INDEX_ROLE
from .media import sha256_file
from .runner import StageContext, StageRefusal


def _hash(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdefABCDEF" for c in value)


def load_camera_motion(ctx: StageContext, pin: Any, proxy_checksum: str, fps: float, offset: int,
                       fetch: Callable[[StageContext, str, Path], int]) -> tuple[np.ndarray, np.ndarray, int, int]:
    """(transforms, shot, bytes read, chunks read): per frame, the transform from its shot's first frame, and its shot number."""
    if not isinstance(pin, dict) or not isinstance(pin.get("indexKey"), str) or not _hash(pin.get("indexChecksum")) or not _hash(proxy_checksum):
        raise StageRefusal("the pinned camera motion index and proxy checksum are required")
    index_path = ctx.work_dir / "camera-motion.json"
    bytes_read = fetch(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=pin["indexKey"]), index_path)
    if sha256_file(index_path).lower() != pin["indexChecksum"].lower():
        raise StageRefusal("the camera motion index is not the one pinned at queue time")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    if index.get("role") != MOTION_INDEX_ROLE or str(index.get("proxyChecksum", "")).lower() != proxy_checksum.lower():
        raise StageRefusal("the camera motion was measured on another proxy")
    if index.get("proxy", {}).get("fps") != fps or index.get("proxy", {}).get("sourceOffsetMs") != offset:
        raise StageRefusal("the camera motion and the proxy clock disagree")
    chunk_paths = []
    for i, chunk in enumerate(index.get("chunks") or []):
        if not isinstance(chunk, dict) or not isinstance(chunk.get("key"), str) or not _hash(chunk.get("sha256")):
            raise StageRefusal("the camera motion index names a malformed chunk")
        path = ctx.work_dir / f"motion-{i:04d}.jsonl"
        bytes_read += fetch(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=chunk["key"]), path)
        if sha256_file(path).lower() != chunk["sha256"].lower():
            raise StageRefusal(f"camera motion chunk {chunk['key']} does not match its checksum")
        chunk_paths.append(path)
    n_frames = sum(int(c.get("rows", 0)) for c in index["chunks"])
    if n_frames < 1:
        raise StageRefusal("the camera motion covers no frames")

    def rows() -> Iterator[dict]:
        for path in chunk_paths:
            with path.open("rb") as handle:
                for line in handle:
                    if line.strip():
                        yield json.loads(line)

    try:
        transforms, shot = chain(rows(), n_frames)
    except ValueError as exc:
        raise StageRefusal(f"cannot chain the camera motion: {exc}") from exc
    return transforms, shot, bytes_read, len(chunk_paths)
