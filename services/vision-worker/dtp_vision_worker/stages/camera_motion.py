"""camera_motion — how the picture moves from frame to frame, and the shots it falls into.

A CPU stage over the review proxy; no model. The proxy is checked against the
checksum the control plane pinned, so the motion belongs to exactly the frames a
person calibrates on. Two passes of one streamed decode each: a frame a second to
find any static overlay, then every frame for the pair-by-pair motion. Rows go to
one-minute JSONL chunks; the index names the chunks with their checksums, and the
shots, which the control plane proposes as camera segments. See docs/vision/92.
"""

from __future__ import annotations

import hashlib
import json
import statistics
from typing import Any

import numpy as np

from ..camera_motion import ALGORITHM_VERSION, CHUNK_ROLE, INDEX_ROLE, Config, estimate, shots, static_mask, work_size
from ..config import CONTRACT_VERSION
from ..media import gray_frames, probe, sha256_file
from ..runner import StageContext, StageRefusal, StageResult, download, upload

#: Frames sampled for the overlay mask, spread evenly across the clip.
MAX_MASK_SAMPLES = 120


def _whole(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def run_camera_motion(ctx: StageContext) -> StageResult:
    inputs = ctx.job.inputs or {}
    params = inputs.get("params") or {}
    if inputs.get("modelVersionIds"):
        raise StageRefusal("camera_motion loads no model")
    proxy_clock = params.get("proxy") or {}
    fps, offset = proxy_clock.get("fps"), proxy_clock.get("sourceOffsetMs")
    if not isinstance(fps, (int, float)) or isinstance(fps, bool) or not 1 <= fps <= 120 or not _whole(offset) or offset < 0:
        raise StageRefusal("camera_motion needs the proxy clock (fps, sourceOffsetMs) to place frames in source time")
    checksum = params.get("proxyChecksum")
    if not isinstance(checksum, str) or len(checksum) != 64:
        raise StageRefusal("camera_motion needs the pinned proxy checksum")
    source_duration = params.get("sourceDurationMs")
    if not _whole(source_duration) or source_duration <= offset:
        raise StageRefusal("camera_motion needs the source duration, beyond the proxy's offset")
    chunk_ms = params.get("chunkMs", 60_000)
    if not _whole(chunk_ms) or not 10_000 <= chunk_ms <= 600_000:
        raise StageRefusal("camera motion chunkMs must be between 10000 and 600000 milliseconds")
    try:
        config = Config.parse(params.get("cameraMotionConfig"))
    except ValueError as exc:
        raise StageRefusal(str(exc)) from exc

    ctx.progress.set("download")
    proxy_path = ctx.work_dir / "proxy.mp4"
    bytes_read = download(ctx, ctx.client.input_url(ctx.job.job_id, "proxy"), proxy_path)
    if sha256_file(proxy_path).lower() != checksum.lower():
        raise StageRefusal("the proxy read is not the one pinned at queue time; queue camera_motion again against the current proxy")
    probed = probe(proxy_path)
    if not probed.width or not probed.height:
        raise StageRefusal("the proxy reports no frame size")
    width, height = int(probed.width), int(probed.height)
    expected_frames = max(1, int((probed.duration_ms or 0) * fps / 1000))
    small_w, small_h = work_size(width, height, config)
    scale = small_w / width

    ctx.progress.set("mask")
    step = max(1, round(fps))
    samples = [np.frombuffer(b, np.uint8).reshape(small_h, small_w) for b in gray_frames(proxy_path, small_w, small_h, every=step)]
    if len(samples) > MAX_MASK_SAMPLES:
        samples = [samples[int(i * len(samples) / MAX_MASK_SAMPLES)] for i in range(MAX_MASK_SAMPLES)]
    if not samples:
        raise StageRefusal("the proxy decoded to no frames")
    mask, mask_fraction = static_mask(samples, config)
    del samples

    ctx.progress.set("motion")
    out_dir = ctx.work_dir / "motion"
    out_dir.mkdir(parents=True, exist_ok=True)
    frames_per_chunk = max(1, int(chunk_ms * fps / 1000))
    chunks: list[dict[str, Any]] = []
    statuses: list[dict[str, Any]] = []
    inliers: list[int] = []
    residuals: list[float] = []
    handle = None
    digest = None
    frames = (np.frombuffer(b, np.uint8).reshape(small_h, small_w) for b in gray_frames(proxy_path, small_w, small_h))
    for row in estimate(frames, mask, scale, config):
        if row["f"] % frames_per_chunk == 0:
            if handle is not None:
                handle.close()
                chunks[-1]["sha256"] = digest.hexdigest()
            name = f"motion-{len(chunks):04d}.jsonl"
            chunks.append({"file": name, "firstFrame": row["f"], "lastFrame": row["f"], "rows": 0})
            # Binary: the bytes uploaded must be the bytes hashed, on any platform.
            handle = (out_dir / name).open("wb")
            digest = hashlib.sha256()
        line = (json.dumps(row, allow_nan=False, separators=(",", ":")) + "\n").encode()
        handle.write(line)
        digest.update(line)
        chunks[-1]["lastFrame"] = row["f"]
        chunks[-1]["rows"] += 1
        statuses.append({"f": row["f"], "status": row["status"]})
        if row["status"] == "tracked":
            inliers.append(row["inliers"])
            if row["residualPx"] is not None:
                residuals.append(row["residualPx"])
        if row["f"] % 250 == 0:
            ctx.progress.set("motion", min(1.0, row["f"] / expected_frames))
    if handle is None:
        raise StageRefusal("the proxy decoded to no frames")
    handle.close()
    chunks[-1]["sha256"] = digest.hexdigest()

    found = shots(statuses, float(fps), int(offset), int(source_duration), config)
    counts = {s: sum(1 for r in statuses if r["status"] == s) for s in ("tracked", "bridged", "break")}

    ctx.progress.set("upload")
    artifacts = []
    written = 0
    for chunk in chunks:
        key = f"{ctx.job.output_prefix}motion/{chunk['file']}"
        size = upload(ctx, ctx.client.presign_output(ctx.job.job_id, key, "application/x-ndjson"), out_dir / chunk["file"], "application/x-ndjson")
        written += size
        chunk["key"] = key
        artifacts.append({"key": key, "bucket": "derived", "bytes": size, "contentType": "application/x-ndjson", "role": CHUNK_ROLE})
    stats = {
        "frames": len(statuses), **counts,
        "medianInliers": int(statistics.median(inliers)) if inliers else None,
        "medianResidualPx": round(statistics.median(residuals), 4) if residuals else None,
        "overlayMaskedFraction": round(mask_fraction, 4),
    }
    payload = {
        "contractVersion": CONTRACT_VERSION, "role": INDEX_ROLE, "calculationVersion": ALGORITHM_VERSION,
        "videoAssetId": inputs.get("videoAssetId"), "proxy": {"fps": fps, "sourceOffsetMs": offset},
        "proxyChecksum": checksum.lower(), "proxyWidth": width, "proxyHeight": height,
        "sourceDurationMs": source_duration, "workWidth": small_w, "workHeight": small_h,
        "config": config.public(), "homography": "row-major 3x3, proxy pixel in frame f-1 -> proxy pixel in frame f",
        "stats": stats, "shots": found, "chunks": chunks,
    }
    index_path = ctx.work_dir / "camera-motion.json"
    index_path.write_text(json.dumps(payload, allow_nan=False), encoding="utf-8")
    index_key = f"{ctx.job.output_prefix}camera-motion.json"
    size = upload(ctx, ctx.client.presign_output(ctx.job.job_id, index_key, "application/json"), index_path, "application/json")
    written += size
    artifacts.append({"key": index_key, "bucket": "derived", "bytes": size, "contentType": "application/json", "role": INDEX_ROLE})
    return StageResult(
        artifacts=artifacts,
        summary={"calculationVersion": ALGORITHM_VERSION, **stats, "shots": found, "chunks": len(chunks),
                 "proxyChecksum": checksum.lower(), "proxyWidth": width, "proxyHeight": height,
                 "sourceDurationMs": source_duration, "indexChecksum": sha256_file(index_path)},
        bytes_read=bytes_read, bytes_written=written, class_a_operations=len(artifacts), class_b_operations=1,
    )
