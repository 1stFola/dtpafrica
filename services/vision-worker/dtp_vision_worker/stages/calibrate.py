"""calibrate — every frame's pitch calibration, carried from a person's keyframes along camera motion.

A CPU stage; no model and no video read. It reads the `camera_motion` artifact the
control plane pinned (index and chunks, each checked against the checksums the index
and the queue recorded) and the segments with their current calibrations, as they
stood at queue time. Each frame gets its segment's whole-segment calibration, or its
nearest keyframe in the same shot carried along the measured motion, or a reason it
has none. Rows go to one-minute JSONL chunks; the index carries coverage, reasons and
the drift measured between keyframes that share a shot. See docs/vision/93.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Iterator
from typing import Any

from ..calibration_propagation import CALCULATION_VERSION, CHUNK_ROLE, INDEX_ROLE, chain, check_keyframes, drifts, parse_segments, propagate
from ..camera_motion import INDEX_ROLE as MOTION_INDEX_ROLE
from ..config import CONTRACT_VERSION
from ..media import sha256_file
from ..runner import StageContext, StageRefusal, StageResult, download, upload


def _whole(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _hash(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdefABCDEF" for c in value)


def run_calibrate(ctx: StageContext) -> StageResult:
    inputs = ctx.job.inputs or {}
    params = inputs.get("params") or {}
    if inputs.get("modelVersionIds"):
        raise StageRefusal("calibrate carries a person's calibrations and loads no model")
    clock = params.get("proxy") or {}
    fps, offset = clock.get("fps"), clock.get("sourceOffsetMs")
    if not isinstance(fps, (int, float)) or isinstance(fps, bool) or not 1 <= fps <= 120 or not _whole(offset) or offset < 0:
        raise StageRefusal("calibrate needs the proxy clock (fps, sourceOffsetMs)")
    motion = params.get("cameraMotion") or {}
    if not isinstance(motion.get("indexKey"), str) or not _hash(motion.get("indexChecksum")) or not _hash(params.get("proxyChecksum")):
        raise StageRefusal("calibrate needs the pinned camera motion index and proxy checksum")
    reach_ms = params.get("reachMs", 10_000)
    chunk_ms = params.get("chunkMs", 60_000)
    if not _whole(reach_ms) or not 1_000 <= reach_ms <= 120_000 or not _whole(chunk_ms) or not 10_000 <= chunk_ms <= 600_000:
        raise StageRefusal("calibrate reachMs must be 1000-120000 and chunkMs 10000-600000 milliseconds")
    try:
        segments = parse_segments(params.get("segments"))
    except ValueError as exc:
        raise StageRefusal(f"invalid calibrations: {exc}") from exc

    ctx.progress.set("download")
    index_path = ctx.work_dir / "camera-motion.json"
    bytes_read = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=motion["indexKey"]), index_path)
    if sha256_file(index_path).lower() != motion["indexChecksum"].lower():
        raise StageRefusal("the camera motion index is not the one pinned at queue time")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    if index.get("role") != MOTION_INDEX_ROLE or str(index.get("proxyChecksum", "")).lower() != params["proxyChecksum"].lower():
        raise StageRefusal("the camera motion was measured on another proxy")
    if index.get("proxy", {}).get("fps") != fps or index.get("proxy", {}).get("sourceOffsetMs") != offset:
        raise StageRefusal("the camera motion and the proxy clock disagree")
    chunk_paths = []
    for i, chunk in enumerate(index.get("chunks") or []):
        if not isinstance(chunk, dict) or not isinstance(chunk.get("key"), str) or not _hash(chunk.get("sha256")):
            raise StageRefusal("the camera motion index names a malformed chunk")
        path = ctx.work_dir / f"motion-{i:04d}.jsonl"
        bytes_read += download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=chunk["key"]), path)
        if sha256_file(path).lower() != chunk["sha256"].lower():
            raise StageRefusal(f"camera motion chunk {chunk['key']} does not match its checksum")
        chunk_paths.append(path)
    n_frames = sum(int(c.get("rows", 0)) for c in index["chunks"])
    if n_frames < 1:
        raise StageRefusal("the camera motion covers no frames")

    ctx.progress.set("chain")

    def motion_rows() -> Iterator[dict]:
        for path in chunk_paths:
            with path.open("rb") as handle:
                for line in handle:
                    if line.strip():
                        yield json.loads(line)

    try:
        transforms, shot = chain(motion_rows(), n_frames)
        check_keyframes(segments, n_frames, float(fps), int(offset))
    except ValueError as exc:
        raise StageRefusal(f"cannot carry calibrations: {exc}") from exc
    reach_frames = max(1, int(reach_ms * fps / 1000))

    ctx.progress.set("carry")
    out_dir = ctx.work_dir / "frames"
    out_dir.mkdir(parents=True, exist_ok=True)
    frames_per_chunk = max(1, int(chunk_ms * fps / 1000))
    chunks: list[dict[str, Any]] = []
    reasons: Counter[str] = Counter()
    covered = 0
    per_segment: dict[str, dict[str, int]] = {}
    handle = None
    digest = None
    for row in propagate(transforms, shot, segments, float(fps), int(offset), reach_frames):
        if row["f"] % frames_per_chunk == 0:
            if handle is not None:
                handle.close()
                chunks[-1]["sha256"] = digest.hexdigest()
            name = f"frames-{len(chunks):04d}.jsonl"
            chunks.append({"file": name, "firstFrame": row["f"], "lastFrame": row["f"], "rows": 0})
            handle = (out_dir / name).open("wb")
            digest = hashlib.sha256()
        line = (json.dumps(row, allow_nan=False, separators=(",", ":")) + "\n").encode()
        handle.write(line)
        digest.update(line)
        chunks[-1]["lastFrame"] = row["f"]
        chunks[-1]["rows"] += 1
        if row["H"] is not None:
            covered += 1
        else:
            reasons[row["reason"]] += 1
        sid = row["cameraSegmentId"]
        if sid is not None:
            seg_counts = per_segment.setdefault(sid, {"frames": 0, "covered": 0})
            seg_counts["frames"] += 1
            seg_counts["covered"] += 1 if row["H"] is not None else 0
    handle.close()
    chunks[-1]["sha256"] = digest.hexdigest()
    measured = drifts(transforms, shot, segments)

    ctx.progress.set("upload")
    artifacts = []
    written = 0
    for chunk in chunks:
        key = f"{ctx.job.output_prefix}frames/{chunk['file']}"
        size = upload(ctx, ctx.client.presign_output(ctx.job.job_id, key, "application/x-ndjson"), out_dir / chunk["file"], "application/x-ndjson")
        written += size
        chunk["key"] = key
        artifacts.append({"key": key, "bucket": "derived", "bytes": size, "contentType": "application/x-ndjson", "role": CHUNK_ROLE})
    segment_rows = [{"cameraSegmentId": s.segment_id, "startMs": s.start_ms, "endMs": s.end_ms,
                     "mode": "whole" if s.whole else ("keyframes" if s.keyframes else "none"),
                     "calibrationIds": [s.whole.calibration_id] if s.whole else [k.calibration_id for k in s.keyframes],
                     **per_segment.get(s.segment_id, {"frames": 0, "covered": 0}), "drift": measured.get(s.segment_id, [])} for s in segments]
    stats = {"frames": n_frames, "covered": covered, "coverage": round(covered / n_frames, 4), "reasons": dict(sorted(reasons.items())),
             "reachMs": reach_ms, "shots": int(shot.max()) + 1}
    payload = {"contractVersion": CONTRACT_VERSION, "role": INDEX_ROLE, "calculationVersion": CALCULATION_VERSION,
               "videoAssetId": inputs.get("videoAssetId"), "proxy": {"fps": fps, "sourceOffsetMs": offset},
               "proxyChecksum": params["proxyChecksum"].lower(), "cameraMotion": {"jobId": motion.get("jobId"), "indexKey": motion["indexKey"], "indexChecksum": motion["indexChecksum"].lower()},
               "homography": "row-major 3x3, proxy pixel of that frame -> pitch metres; null with a reason where none",
               "stats": stats, "segments": segment_rows, "chunks": chunks}
    out_index = ctx.work_dir / "calibration-frames.json"
    out_index.write_text(json.dumps(payload, allow_nan=False), encoding="utf-8")
    index_key = f"{ctx.job.output_prefix}calibration-frames.json"
    size = upload(ctx, ctx.client.presign_output(ctx.job.job_id, index_key, "application/json"), out_index, "application/json")
    written += size
    artifacts.append({"key": index_key, "bucket": "derived", "bytes": size, "contentType": "application/json", "role": INDEX_ROLE})
    return StageResult(
        artifacts=artifacts,
        summary={"calculationVersion": CALCULATION_VERSION, **stats, "chunks": len(chunks), "segments": segment_rows,
                 "proxyChecksum": params["proxyChecksum"].lower(), "cameraMotionIndexChecksum": motion["indexChecksum"].lower(),
                 "indexChecksum": sha256_file(out_index)},
        bytes_read=bytes_read, bytes_written=written, class_a_operations=len(artifacts), class_b_operations=1 + len(chunk_paths),
    )
