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
from ..jsonstream import JsonStreamError, fields, items
from ..tracking import MIN_TRACK_SAMPLE_FPS, Linker, Params, Track, record, summary_row

log = logging.getLogger(__name__)

ARTIFACT_ROLE = "tracks"


def run_track(ctx: StageContext) -> StageResult:
    return _track(ctx)


def _cuts(raw: Any) -> list[int]:
    """`params.cuts`: camera cuts in source milliseconds, as the control plane declares them."""
    if raw is None:
        return []
    if not isinstance(raw, list) or any(not isinstance(c, int) or isinstance(c, bool) or c < 0 for c in raw):
        raise StageRefusal(f"track params.cuts must be a list of source milliseconds; got {raw!r}")
    return raw


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
    cuts = _cuts(job_params.get("cuts"))

    ctx.progress.set("download")
    path = ctx.work_dir / "detections.json"
    bytes_read = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=key), path)
    # A match's detections are a hundred and forty thousand frames. The file is walked
    # twice and never held: once for the small keys, which decide whether to link at
    # all, then frame by frame. See jsonstream.
    try:
        artifact = fields(path, "frames")
    except JsonStreamError as exc:
        raise StageRefusal(f"detect artifact {key} is not readable: {exc}") from exc

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
    linker = Linker(params, cuts)
    # Each track is written to a spill file as it ends, so only the live ones are held.
    spill = ctx.work_dir / "tracks.spill.jsonl"
    where: list[tuple[int, int, int]] = []  # (local id, offset, length)
    rows: dict[int, dict[str, Any]] = {}

    def keep(finished: list[Track], handle: Any) -> None:
        for t in finished:
            line = json.dumps(record(t)).encode()
            where.append((t.local_id, handle.tell(), len(line)))
            handle.write(line)
            rows[t.local_id] = summary_row(t)

    with spill.open("wb") as handle:
        try:
            for frame in items(path, "frames"):
                keep(linker.feed(frame), handle)
        except ValueError as exc:  # frames out of order, or JSON that stops being JSON
            raise StageRefusal(f"detect artifact {key} cannot be linked: {exc}") from exc
        keep(linker.close(), handle)
    stats = linker.stats()
    where.sort()

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
        **{k: v for k, v in stats.items() if k != "tracks"},
        "trackCount": stats["tracks"],
        # Every frame the tracker was given, with or without a track on it: what a
        # reader needs to say what share of the footage anything covers.
        "trackedFrames": [list(f) for f in linker.frames],
    }
    out_path = ctx.work_dir / "tracks.json"
    # The small keys first, then the tracks in id order, copied from the spill one at a time.
    head = json.dumps(payload).encode()
    with out_path.open("wb") as out, spill.open("rb") as spilled:
        out.write(head[:-1])
        out.write(b', "tracks": [')
        for n, (_local_id, offset, length) in enumerate(where):
            if n:
                out.write(b", ")
            spilled.seek(offset)
            out.write(spilled.read(length))
        out.write(b"]}")
    spill.unlink()
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
            "trackRows": [rows[local_id] for local_id, _o, _l in where],
        },
        model_version_ids=[tracker_version_id],
        bytes_read=bytes_read,
        bytes_written=written,
        class_a_operations=1,
        class_b_operations=1,
    )
