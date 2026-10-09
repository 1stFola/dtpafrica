"""gamestate — every track's foot point on the pitch, in metres, as Parquet chunks.

A CPU stage over a stored track artifact and the camera segments, calibrations
and clock anchors the control plane declared beside it. It places each position through the
calibration of the camera segment covering its moment, under the suppression
rule, chunks the rows by source time, writes each chunk as Parquet and an index
naming them with their coverage. See docs/vision/42-PHASE-5-INCREMENT-5.md.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..config import CONTRACT_VERSION
from ..carried_frames import load as load_carried
from ..gamestate import DEFAULT_CHUNK_MS, build, parse_anchors, parse_segments, parse_tracked_frames
from ..jsonstream import JsonStreamError, fields, items
from ..runner import StageContext, StageRefusal, StageResult, download, upload

log = logging.getLogger(__name__)

INDEX_ROLE = "gamestate"
CHUNK_ROLE = "gamestate_chunk"


def run_gamestate(ctx: StageContext) -> StageResult:
    return _gamestate(ctx)


def _gamestate(ctx: StageContext) -> StageResult:
    inputs = ctx.job.inputs or {}
    params = inputs.get("params") or {}
    source = params.get("tracks") or {}
    key = source.get("key")
    if not isinstance(key, str) or not key:
        raise StageRefusal("gamestate needs params.tracks.key, the track artifact to place")
    raw_segments = params.get("segments")
    if not isinstance(raw_segments, list):
        raise StageRefusal("gamestate needs params.segments, the camera segments with their calibrations; the control plane declares them")
    chunk_ms = params.get("chunkMs", DEFAULT_CHUNK_MS)
    if not isinstance(chunk_ms, int) or isinstance(chunk_ms, bool) or chunk_ms <= 0:
        raise StageRefusal(f"gamestate chunkMs must be a positive whole number of milliseconds; got {chunk_ms!r}")
    segments = parse_segments(raw_segments)
    anchors = parse_anchors(params.get("anchors") or [])
    carried_ids = {s.camera_segment_id for s in segments if s.carried}

    ctx.progress.set("download")
    bytes_read = 0
    carried = None
    if carried_ids:
        # Keyframed segments: every frame's own homography, from the calibrate run the control plane pinned.
        proxy = params.get("proxy") or {}
        try:
            carried, bytes_read = load_carried(ctx, params.get("carried"), carried_ids, proxy.get("fps"), proxy.get("sourceOffsetMs"))
        except ValueError as exc:
            raise StageRefusal(f"carried calibrations: {exc}") from exc
    elif params.get("carried") is not None:
        raise StageRefusal("a calibrate run is pinned but no segment is declared carried")
    tracks_path = ctx.work_dir / "tracks.json"
    bytes_read += download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=key), tracks_path)
    # Two passes over the file, neither holding it: the small keys first, wherever the
    # writer put them, then the tracks one at a time. See jsonstream.
    try:
        artifact = fields(tracks_path, "tracks")
    except JsonStreamError as exc:
        raise StageRefusal(f"track artifact {key} is not readable: {exc}") from exc
    tracker_version_id = artifact.get("trackerVersionId")
    declared_tracker = source.get("trackerVersionId")
    if isinstance(declared_tracker, str) and declared_tracker != tracker_version_id:
        raise StageRefusal(f"the job declared tracker {declared_tracker} but the artifact was made by {tracker_version_id}")

    ctx.progress.set("place")
    out_dir = ctx.work_dir / "gamestate"
    index = build(items(tracks_path, "tracks"), segments, anchors, out_dir, int(chunk_ms), parse_tracked_frames(artifact.get("trackedFrames")), carried)

    ctx.progress.set("upload")
    artifacts: list[dict[str, Any]] = []
    written = 0
    for chunk in index["chunks"]:
        chunk_key = f"{ctx.job.output_prefix}gamestate/{chunk['file']}"
        put_url = ctx.client.presign_output(ctx.job.job_id, chunk_key, "application/vnd.apache.parquet")
        size = upload(ctx, put_url, out_dir / chunk["file"], "application/vnd.apache.parquet")
        written += size
        chunk["key"] = chunk_key
        artifacts.append({"key": chunk_key, "bucket": "derived", "bytes": size, "contentType": "application/vnd.apache.parquet", "role": CHUNK_ROLE})

    index_key = f"{ctx.job.output_prefix}gamestate.json"
    payload = {
        "contractVersion": CONTRACT_VERSION,
        "role": INDEX_ROLE,
        "videoAssetId": inputs.get("videoAssetId"),
        "trackJobId": source.get("jobId"),
        "trackerVersionId": tracker_version_id,
        "tracksKey": key,
        "segments": [{"cameraSegmentId": s.camera_segment_id, "startMs": s.start_ms, "endMs": s.end_ms, "quality": s.quality} for s in segments],
        "anchors": [{"half": a.half, "sourceMs": a.source_ms, "endMs": a.end_ms} for a in anchors],
        **index,
    }
    index_path = ctx.work_dir / "gamestate.json"
    index_path.write_bytes(json.dumps(payload).encode())
    put_url = ctx.client.presign_output(ctx.job.job_id, index_key, "application/json")
    size = upload(ctx, put_url, index_path, "application/json")
    written += size
    artifacts.append({"key": index_key, "bucket": "derived", "bytes": size, "contentType": "application/json", "role": INDEX_ROLE})

    return StageResult(
        artifacts=artifacts,
        summary={
            "trackJobId": source.get("jobId"),
            "trackerVersionId": tracker_version_id,
            "chunkMs": index["chunkMs"],
            "chunks": len(index["chunks"]),
            "tracks": index["tracks"],
            "rows": index["rows"],
            "frames": index["frames"],
            "framesTracked": index["framesTracked"],
            "coverageBasis": index["coverageBasis"],
            "placed": index["placed"],
            "suppressed": index["suppressed"],
            "reasons": index["reasons"],
            "validFrameCoverage": index["validFrameCoverage"],
        },
        bytes_read=bytes_read,
        bytes_written=written,
        class_a_operations=1 + len(index["chunks"]),
        class_b_operations=1,
    )
