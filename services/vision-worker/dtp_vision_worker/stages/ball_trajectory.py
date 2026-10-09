"""CPU trajectory over a declared detection artifact. No model loads or video reads."""
from __future__ import annotations

import json
import math
import re

from ..ball_trajectory import CHUNK_ROLE, INDEX_ROLE, PARKED_MIN_FRAMES, PARKED_RADIUS_PX, Config, Smoother, build, parked_tile_balls, without
from ..config import CONTRACT_VERSION
from ..jsonstream import JsonStreamError, fields, items
from ..media import sha256_file
from ..motion_pin import load_camera_motion
from ..runner import StageContext, StageRefusal, StageResult, download, upload

#: Detections from this detector carry tiled balls marked for the parked check (docs/vision/95).
TILED_DETECTOR = "builtin/torchvision/fasterrcnn_resnet50_fpn/COCO_V1+ball-tiles/v2"


def run_ball_trajectory(ctx: StageContext) -> StageResult:
    inputs = ctx.job.inputs or {}
    params = inputs.get("params") or {}
    declared = params.get("detections") or {}
    key = declared.get("key")
    if not isinstance(key, str) or not key or inputs.get("modelVersionIds"):
        raise StageRefusal("ball_trajectory needs one declared detection key and loads no model of its own")
    for checksum in (params.get("sourceChecksum"), params.get("proxyChecksum"), declared.get("weightsChecksum")):
        if not isinstance(checksum, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", checksum):
            raise StageRefusal("ball_trajectory needs pinned source and detector weights checksums")
    proxy = params.get("proxy") or {}
    chunk_ms = params.get("chunkMs", 60_000)
    if not isinstance(chunk_ms, int) or isinstance(chunk_ms, bool) or not 10_000 <= chunk_ms <= 600_000:
        raise StageRefusal("ball trajectory chunkMs must be between 10000 and 600000 milliseconds")
    try:
        smoother = Smoother(fps=proxy.get("fps"), source_offset_ms=proxy.get("sourceOffsetMs"), source_duration_ms=params.get("sourceDurationMs"),
                            proxy_duration_ms=params.get("proxyDurationMs"), width=params.get("imageWidth"), height=params.get("imageHeight"),
                            segments=params.get("segments"), config=Config.parse(params.get("trajectoryConfig")))
    except (TypeError, ValueError) as exc:
        raise StageRefusal(str(exc)) from exc
    ctx.progress.set("download")
    source = ctx.work_dir / "detections.json"
    bytes_read = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=key), source)
    try:
        header = fields(source, "frames")
        artifact_proxy = header.get("proxy") or {}
        detector = header.get("detector") or {}
        sample_fps = header.get("sampleFps")
        if header.get("role") != "detections" or header.get("videoAssetId") != inputs.get("videoAssetId") or header.get("modelVersionId") != declared.get("modelVersionId"):
            raise StageRefusal("detection artifact differs from the declared asset, detector or role")
        if detector.get("weightsSha256") != declared["weightsChecksum"]:
            raise StageRefusal("detector weights differ from the pinned detection completion")
        if header.get("sourceChecksum") != params["sourceChecksum"] or header.get("proxyChecksum") != params["proxyChecksum"] or header.get("proxyDurationMs") != params["proxyDurationMs"] or header.get("imageWidth") != smoother.width or header.get("imageHeight") != smoother.height:
            raise StageRefusal("detection source, proxy checksum or image geometry differs from the declared input")
        if not isinstance(sample_fps, (int, float)) or isinstance(sample_fps, bool) or not math.isfinite(sample_fps) or not math.isclose(sample_fps, smoother.fps, abs_tol=1e-6):
            raise StageRefusal("ball trajectory needs full-rate detections at the proxy frame rate")
        if sample_fps != declared.get("sampleFps") or artifact_proxy.get("fps") != proxy.get("fps") or artifact_proxy.get("sourceOffsetMs") != proxy.get("sourceOffsetMs"):
            raise StageRefusal("detect and trajectory clocks disagree")
        # Tiled balls are tested for being parked along the camera motion pinned with them;
        # a pin with plain detections, or tiled ones without a pin, is a wiring fault.
        tiled = header.get("detectorConfig") == TILED_DETECTOR
        motion = params.get("cameraMotion")
        if tiled != (motion is not None):
            raise StageRefusal("ball-tiles/v2 detections need the pinned camera motion, and only they use it")
        parked: set[tuple[int, int]] = set()
        if tiled:
            ctx.progress.set("camera motion")
            transforms, shot, motion_read, _ = load_camera_motion(ctx, motion, params["proxyChecksum"], proxy.get("fps"), proxy.get("sourceOffsetMs"), download)
            bytes_read += motion_read
            parked = parked_tile_balls(items(source, "frames"), transforms, shot)
        ctx.progress.set("smooth")
        out_dir = ctx.work_dir / "ball"
        index = build(smoother, without(items(source, "frames"), parked), out_dir, chunk_ms)
    except (JsonStreamError, TypeError, ValueError, AttributeError) as exc:
        raise StageRefusal(f"invalid ball trajectory input: {exc}") from exc
    if tiled:
        index |= {"parkedTileBalls": len(parked), "parked": {"minFrames": PARKED_MIN_FRAMES, "radiusPx": PARKED_RADIUS_PX},
                  "cameraMotion": {"jobId": motion.get("jobId"), "indexKey": motion["indexKey"], "indexChecksum": motion["indexChecksum"].lower()}}
    ctx.progress.set("upload")
    artifacts = []
    written = 0
    for chunk in index["chunks"]:
        chunk_key = f"{ctx.job.output_prefix}ball/{chunk['file']}"
        size = upload(ctx, ctx.client.presign_output(ctx.job.job_id, chunk_key, "application/x-ndjson"), out_dir / chunk["file"], "application/x-ndjson")
        written += size; chunk["key"] = chunk_key
        artifacts.append({"key": chunk_key, "bucket": "derived", "bytes": size, "contentType": "application/x-ndjson", "role": CHUNK_ROLE})
    payload = {"contractVersion": CONTRACT_VERSION, "role": INDEX_ROLE, "videoAssetId": inputs.get("videoAssetId"), "sourceChecksum": params["sourceChecksum"],
               "detectorJobId": declared.get("jobId"), "detectorVersionId": declared.get("modelVersionId"), "detectorWeightsChecksum": declared["weightsChecksum"],
               "detectionsKey": key, "detectionsChecksum": sha256_file(source), "proxy": proxy, "imageWidth": smoother.width, "imageHeight": smoother.height,
               "proxyChecksum": params["proxyChecksum"], "segments": smoother.segments, **index}
    path = ctx.work_dir / "ball-trajectory.json"
    path.write_text(json.dumps(payload, allow_nan=False), encoding="utf-8")
    index_key = f"{ctx.job.output_prefix}ball-trajectory.json"
    size = upload(ctx, ctx.client.presign_output(ctx.job.job_id, index_key, "application/json"), path, "application/json")
    written += size
    artifacts.append({"key": index_key, "bucket": "derived", "bytes": size, "contentType": "application/json", "role": INDEX_ROLE})
    return StageResult(artifacts=artifacts, summary={k: index[k] for k in ("calculationVersion", "frames", "observed", "lost", "observedFrameCoverage", "reasons", "windowStartMs", "windowEndMs")} | {
        "chunks": len(index["chunks"]), "detectorJobId": declared.get("jobId"), "detectorVersionId": declared.get("modelVersionId"),
        "sourceChecksum": params["sourceChecksum"], "indexChecksum": sha256_file(path), "detectionsChecksum": payload["detectionsChecksum"],
        **({"parkedTileBalls": index["parkedTileBalls"], "cameraMotionIndexChecksum": index["cameraMotion"]["indexChecksum"]} if tiled else {})},
        bytes_read=bytes_read, bytes_written=written, class_a_operations=len(artifacts), class_b_operations=1)
