"""hard_frames -- the frames worth labelling, with the detector's boxes as pre-labels.

A CPU stage over a pinned detect run and the ball trajectory over it. No model loads and
no video is read. See ``dtp_vision_worker.hard_frames`` and docs/vision/99.
"""
from __future__ import annotations

import json
import re

from ..config import CONTRACT_VERSION
from ..hard_frames import MAX_FRAMES, ROLE, VERSION, attach_boxes, choose
from ..jsonstream import JsonStreamError, fields, items
from ..media import sha256_file
from ..runner import StageContext, StageRefusal, StageResult, download, upload

_HASH = re.compile(r"[a-fA-F0-9]{64}")


def _whole(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def run_hard_frames(ctx: StageContext) -> StageResult:
    inputs = ctx.job.inputs or {}
    params = inputs.get("params") or {}
    det, ball, proxy = params.get("detections") or {}, params.get("ball") or {}, params.get("proxy") or {}
    if inputs.get("modelVersionIds"):
        raise StageRefusal("hard_frames reads stored output and loads no model")
    if not isinstance(det.get("key"), str) or not det["key"] or not isinstance(det.get("modelVersionId"), str) or not isinstance(ball.get("key"), str):
        raise StageRefusal("hard_frames needs a pinned detect run and ball trajectory")
    for digest in (det.get("checksum"), ball.get("indexChecksum"), params.get("sourceChecksum")):
        if not isinstance(digest, str) or not _HASH.fullmatch(digest):
            raise StageRefusal("hard_frames needs pinned detection, ball and source checksums")
    width, height, fps = params.get("imageWidth"), params.get("imageHeight"), proxy.get("fps")
    if not _whole(width) or not _whole(height) or width <= 0 or height <= 0 or not isinstance(fps, (int, float)) or not 1 <= fps <= 120:
        raise StageRefusal("hard_frames needs the proxy clock and image size")
    max_frames, random_share, min_gap_ms = params.get("maxFrames", 200), params.get("randomShare", 1 / 3), params.get("minGapMs", 1000)
    if not _whole(max_frames) or not 1 <= max_frames <= MAX_FRAMES or isinstance(random_share, bool) or not isinstance(random_share, (int, float)) or not 0 <= random_share <= 1 or not _whole(min_gap_ms) or not 0 <= min_gap_ms <= 60_000:
        raise StageRefusal(f"hard_frames needs 1-{MAX_FRAMES} frames, a random share in 0-1 and a gap of 0-60000 ms")

    ctx.progress.set("download")
    source = ctx.work_dir / "detections.json"
    bytes_read = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=det["key"]), source)
    if sha256_file(source).lower() != det["checksum"].lower():
        raise StageRefusal("the detection artifact is not the one pinned at queue time")
    index_path = ctx.work_dir / "ball-trajectory.json"
    bytes_read += download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=ball["key"]), index_path)
    if sha256_file(index_path).lower() != ball["indexChecksum"].lower():
        raise StageRefusal("the ball trajectory index is not the one pinned at queue time")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    chunks = index.get("chunks") or []
    if [c.get("key") for c in chunks] != list(ball.get("chunkKeys") or []):
        raise StageRefusal("the ball trajectory chunks differ from the pinned ones")
    rows: list[dict] = []
    for i, chunk in enumerate(chunks):
        path = ctx.work_dir / f"ball-{i:04d}.jsonl"
        bytes_read += download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=chunk["key"]), path)
        if sha256_file(path).lower() != str(chunk.get("checksumSha256", "")).lower():
            raise StageRefusal(f"ball trajectory chunk {i} changed after its index was written")
        rows += [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    try:
        header = fields(source, "frames")
        if header.get("role") != "detections" or header.get("videoAssetId") != inputs.get("videoAssetId") or header.get("modelVersionId") != det["modelVersionId"]:
            raise StageRefusal("the detection artifact differs from the declared asset or detector")
        if header.get("sourceChecksum") != params["sourceChecksum"] or header.get("imageWidth") != width or header.get("imageHeight") != height:
            raise StageRefusal("the detection source or image size differs from the declared input")
        if index.get("detectorJobId") != det.get("jobId") or index.get("detectionsChecksum") != det["checksum"].lower():
            raise StageRefusal("the ball trajectory was not built from the pinned detections")
        ctx.progress.set("choose")
        picks = choose(items(source, "frames"), rows, max_frames=max_frames, random_share=float(random_share), min_gap_ms=min_gap_ms, seed=params["sourceChecksum"])
        ctx.progress.set("boxes")
        frames = attach_boxes(items(source, "frames"), picks, width=width, height=height)
    except (JsonStreamError, TypeError, ValueError, AttributeError, KeyError) as exc:
        raise StageRefusal(f"invalid hard_frames input: {exc}") from exc

    ctx.progress.set("upload")
    payload = {"contractVersion": CONTRACT_VERSION, "role": ROLE, "calculationVersion": VERSION, "videoAssetId": inputs.get("videoAssetId"),
               "sourceChecksum": params["sourceChecksum"], "detectJobId": det.get("jobId"), "detectorVersionId": det["modelVersionId"],
               "ballJobId": ball.get("jobId"), "frameDurationMs": max(1, round(1000 / fps)), "frames": frames}
    out = ctx.work_dir / "hard-frames.json"
    out.write_text(json.dumps(payload, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    key = f"{ctx.job.output_prefix}hard-frames.json"
    written = upload(ctx, ctx.client.presign_output(ctx.job.job_id, key, "application/json"), out, "application/json")
    causes: dict[str, int] = {}
    for f in frames:
        causes[f["cause"]] = causes.get(f["cause"], 0) + 1
    return StageResult(
        artifacts=[{"key": key, "bucket": "derived", "bytes": written, "contentType": "application/json", "role": ROLE}],
        summary={"calculationVersion": VERSION, "frames": len(frames), "causes": dict(sorted(causes.items())), "boxes": sum(len(f["boxes"]) for f in frames),
                 "detectJobId": det.get("jobId"), "detectorVersionId": det["modelVersionId"], "ballJobId": ball.get("jobId"),
                 "sourceChecksum": params["sourceChecksum"], "artifactChecksum": sha256_file(out)},
        bytes_read=bytes_read, bytes_written=written, class_a_operations=1, class_b_operations=2 + len(chunks))
