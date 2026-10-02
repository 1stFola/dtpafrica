"""track — link a detect artifact's boxes across frames.

A CPU stage over stored detections, like `benchmark`: the boxes needed a card, the
linking does not. It reads the one detect artifact the control plane declared,
refuses it if it was sampled too sparsely to link, and writes one artifact of tracks
whose provenance names both models involved -- the tracker version this job runs
and the detector version that produced the boxes.

See docs/vision/32-PHASE-4-INCREMENT-1.md.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..config import CONTRACT_VERSION
from ..runner import StageContext, StageRefusal, StageResult, download, upload
from ..tracking import MIN_TRACK_SAMPLE_FPS, Params, record, summary_row, track

log = logging.getLogger(__name__)

ARTIFACT_ROLE = "tracks"


def run_track(ctx: StageContext) -> StageResult:
    return _track(ctx)


def _track(ctx: StageContext, params: Params = Params()) -> StageResult:
    inputs = ctx.job.inputs or {}
    job_params = inputs.get("params") or {}
    model_versions = inputs.get("modelVersionIds") or []
    if len(model_versions) != 1:
        raise StageRefusal(f"track needs exactly one modelVersionId (the tracker); got {model_versions!r}")
    tracker_version_id = model_versions[0]

    source = job_params.get("detections") or {}
    key = source.get("key")
    if not isinstance(key, str) or not key:
        raise StageRefusal("track needs params.detections.key, the detect artifact to link")

    ctx.progress.set("download")
    path = ctx.work_dir / "detections.json"
    bytes_read = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=key), path)
    artifact = json.loads(path.read_bytes())

    detector_version_id = artifact.get("modelVersionId")
    if not isinstance(detector_version_id, str) or not detector_version_id:
        raise StageRefusal(f"detect artifact {key} names no model version; its boxes cannot be attributed")
    declared_detector = source.get("modelVersionId")
    if isinstance(declared_detector, str) and declared_detector != detector_version_id:
        raise StageRefusal(
            f"the job declared detector {declared_detector} but the artifact was produced by {detector_version_id}"
        )
    fps = float(artifact.get("sampleFps") or 0)
    if fps < MIN_TRACK_SAMPLE_FPS:
        raise StageRefusal(
            f"detections were sampled at {fps} fps; tracking needs at least {MIN_TRACK_SAMPLE_FPS}. "
            "Run detect at the proxy's full rate for this asset first."
        )

    ctx.progress.set("link")
    tracks, stats = track(artifact.get("frames") or [], params)

    ctx.progress.set("upload")
    out_key = f"{ctx.job.output_prefix}tracks.json"
    payload: dict[str, Any] = {
        "contractVersion": CONTRACT_VERSION,
        "role": ARTIFACT_ROLE,
        "videoAssetId": inputs.get("videoAssetId"),
        "trackerVersionId": tracker_version_id,
        "detectorVersionId": detector_version_id,
        "detectJobId": source.get("jobId"),
        "detectionsKey": key,
        "sampleFps": fps,
        "proxy": artifact.get("proxy"),
        "tracks": [record(t) for t in tracks],
        **{k: v for k, v in stats.items() if k != "tracks"},
        "trackCount": stats["tracks"],
    }
    out_path = ctx.work_dir / "tracks.json"
    out_path.write_bytes(json.dumps(payload).encode())
    put_url = ctx.client.presign_output(ctx.job.job_id, out_key, "application/json")
    written = upload(ctx, put_url, out_path, "application/json")

    return StageResult(
        artifacts=[
            {"key": out_key, "bucket": "derived", "bytes": written, "contentType": "application/json", "role": ARTIFACT_ROLE}
        ],
        summary={
            "trackerVersionId": tracker_version_id,
            "detectorVersionId": detector_version_id,
            "detectJobId": source.get("jobId"),
            "sampleFps": fps,
            **stats,
            # The compact index the control plane turns into rows; positions stay in the artifact.
            "trackRows": [summary_row(t) for t in tracks],
        },
        model_version_ids=[tracker_version_id],
        bytes_read=bytes_read,
        bytes_written=written,
        class_a_operations=1,
        class_b_operations=1,
    )
