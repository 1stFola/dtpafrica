"""cuts — propose camera segments from the proxy's scene changes.

A CPU stage. It reads the proxy by role, asks FFmpeg for every frame whose
scene-change score clears the threshold, turns the moments between them into
segments no shorter than a floor, and writes them as proposals in source time.
The control plane files them beside the segments a person declared, never over
them. See docs/vision/39-PHASE-5-INCREMENT-2.md.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

from ..config import CONTRACT_VERSION
from ..cuts import DEFAULT_MIN_SEGMENT_MS, DEFAULT_THRESHOLD, propose
from ..media import probe, scene_changes
from ..runner import StageContext, StageRefusal, StageResult, download, upload

log = logging.getLogger(__name__)

ARTIFACT_ROLE = "cuts"

#: (proxy path, threshold) -> FFmpeg's stderr with one showinfo line per cut. Injected so a test runs without FFmpeg.
SceneDetector = Callable[[Any, float], str]
#: (proxy path) -> duration in ms. Injected for the same reason.
DurationProbe = Callable[[Any], int]


def run_cuts(ctx: StageContext) -> StageResult:
    return _cuts(ctx, detector=None, duration=None)


def _cuts(ctx: StageContext, detector: SceneDetector | None, duration: DurationProbe | None) -> StageResult:
    inputs = ctx.job.inputs or {}
    params = inputs.get("params") or {}
    proxy_clock = params.get("proxy") or {}
    offset = proxy_clock.get("sourceOffsetMs")
    if not isinstance(offset, int) or isinstance(offset, bool):
        raise StageRefusal(f"cuts needs params.proxy.sourceOffsetMs to place segments in source time; got {offset!r}")
    threshold = params.get("threshold", DEFAULT_THRESHOLD)
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool) or not 0 < threshold < 1:
        raise StageRefusal(f"cuts threshold must be between 0 and 1; got {threshold!r}")
    min_segment_ms = params.get("minSegmentMs", DEFAULT_MIN_SEGMENT_MS)
    if not isinstance(min_segment_ms, int) or isinstance(min_segment_ms, bool) or min_segment_ms < 0:
        raise StageRefusal(f"cuts minSegmentMs must be a whole number of milliseconds; got {min_segment_ms!r}")

    ctx.progress.set("download")
    proxy_path = ctx.work_dir / "proxy.mp4"
    bytes_read = download(ctx, ctx.client.input_url(ctx.job.job_id, "proxy"), proxy_path)

    ctx.progress.set("detect")
    probe_duration = duration or (lambda path: int(probe(path).duration_ms or 0))
    duration_ms = probe_duration(proxy_path)
    if duration_ms <= 0:
        raise StageRefusal("the proxy reports no duration; its segments cannot be bounded")
    detect = detector or (lambda path, t: scene_changes(path, t))
    showinfo = detect(proxy_path, float(threshold))
    result = propose(showinfo, duration_ms, int(offset), int(min_segment_ms))

    ctx.progress.set("upload")
    out_key = f"{ctx.job.output_prefix}cuts.json"
    payload: dict[str, Any] = {
        "contractVersion": CONTRACT_VERSION,
        "role": ARTIFACT_ROLE,
        "videoAssetId": inputs.get("videoAssetId"),
        "threshold": float(threshold),
        "proxy": {"fps": proxy_clock.get("fps"), "sourceOffsetMs": int(offset)},
        **result,
    }
    out_path = ctx.work_dir / "cuts.json"
    out_path.write_bytes(json.dumps(payload).encode())
    put_url = ctx.client.presign_output(ctx.job.job_id, out_key, "application/json")
    written = upload(ctx, put_url, out_path, "application/json")

    return StageResult(
        artifacts=[{"key": out_key, "bucket": "derived", "bytes": written, "contentType": "application/json", "role": ARTIFACT_ROLE}],
        summary={
            "threshold": float(threshold),
            "minSegmentMs": int(min_segment_ms),
            "durationMs": duration_ms,
            "cuts": len(result["cuts"]),
            "segments": result["segments"],
        },
        bytes_read=bytes_read,
        bytes_written=written,
        class_a_operations=1,
        class_b_operations=1,
    )
