"""identify — which side each track is on, by kit.

A CPU stage. It reads the proxy by role and the one track artifact the control
plane declared, decodes a handful of frames per track, takes a colour histogram
of each torso, clusters the players' kits into two sides per match, and writes
one assignment per track -- with no side at all where the kits were too close to
call. Goalkeepers and referees are never clustered: their kit is different on
purpose.

Jersey numbers are not here. They need a digit model the licence register does
not yet hold, and a number read off one frame is wrong often enough to be worse
than none. See docs/vision/34-PHASE-4-INCREMENT-3.md.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

from ..config import CONTRACT_VERSION
from ..kits import KitTrack, Params, cluster_teams, kit_histogram, mean_feature, sample_frames, torso_region
from ..media import decode_frame
from ..runner import StageContext, StageRefusal, StageResult, download, upload

log = logging.getLogger(__name__)

ARTIFACT_ROLE = "identity"

#: (proxy path, frame index, fps) -> (width, height, rgb bytes). Injected so a test runs without FFmpeg.
FrameDecoder = Callable[[Any, int, float], tuple[int, int, bytes]]


def run_identify(ctx: StageContext) -> StageResult:
    return _identify(ctx, decoder=None)


def _identify(ctx: StageContext, decoder: FrameDecoder | None, params: Params = Params()) -> StageResult:
    inputs = ctx.job.inputs or {}
    job_params = inputs.get("params") or {}
    model_versions = inputs.get("modelVersionIds") or []
    if len(model_versions) != 1:
        raise StageRefusal(f"identify needs exactly one modelVersionId; got {model_versions!r}")
    identify_version_id = model_versions[0]

    source = job_params.get("tracks") or {}
    key = source.get("key")
    if not isinstance(key, str) or not key:
        raise StageRefusal("identify needs params.tracks.key, the track artifact to assign teams on")
    proxy_clock = job_params.get("proxy") or {}
    fps = proxy_clock.get("fps")
    if not isinstance(fps, (int, float)) or isinstance(fps, bool) or fps <= 0:
        raise StageRefusal(f"identify needs params.proxy.fps; got {fps!r}")

    ctx.progress.set("download")
    tracks_path = ctx.work_dir / "tracks.json"
    bytes_read = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=key), tracks_path)
    artifact = json.loads(tracks_path.read_bytes())
    tracker_version_id = artifact.get("trackerVersionId")
    if not isinstance(tracker_version_id, str) or not tracker_version_id:
        raise StageRefusal(f"track artifact {key} names no tracker version")
    declared_tracker = source.get("trackerVersionId")
    if isinstance(declared_tracker, str) and declared_tracker != tracker_version_id:
        raise StageRefusal(f"the job declared tracker {declared_tracker} but the artifact was made by {tracker_version_id}")

    proxy_path = ctx.work_dir / "proxy.mp4"
    bytes_read += download(ctx, ctx.client.input_url(ctx.job.job_id, "proxy"), proxy_path)

    # The track artifact's boxes are in the proxy's own pixels, and the frame is
    # decoded at its native size, so a box reads straight off the frame.
    ctx.progress.set("decode")
    decode = decoder or (lambda path, frame, rate: decode_frame(path, frame, rate))
    tracks = artifact.get("tracks") or []
    wanted: dict[int, list[tuple[int, tuple[float, float, float, float]]]] = {}
    for t in tracks:
        positions = t.get("positions") or []
        frames = [int(p["frameIndex"]) for p in positions]
        by_frame = {int(p["frameIndex"]): p["box"] for p in positions}
        for f in sample_frames(frames, params.samples_per_track):
            b = by_frame[f]
            wanted.setdefault(f, []).append((int(t["localTrackId"]), (float(b["x"]), float(b["y"]), float(b["width"]), float(b["height"]))))

    features: dict[int, list[list[float]]] = {}
    decoded = 0
    for index, frame in enumerate(sorted(wanted)):
        ctx.progress.set("decode", fraction=index / max(1, len(wanted)))
        try:
            width, height, pixels = decode(proxy_path, frame, float(fps))
        except Exception as exc:  # noqa: BLE001 - one undecodable frame must not void a match
            log.warning("could not decode frame %s: %s", frame, exc)
            continue
        decoded += 1
        for local_id, box in wanted[frame]:
            hist = kit_histogram(pixels, width, height, torso_region(box), params)
            if hist is not None:
                features.setdefault(local_id, []).append(hist)

    kit_tracks = [
        KitTrack(int(t["localTrackId"]), str(t["class"]), mean_feature(features[int(t["localTrackId"])]) if int(t["localTrackId"]) in features else None, len(features.get(int(t["localTrackId"]), [])))
        for t in tracks
    ]

    ctx.progress.set("cluster")
    result = cluster_teams(kit_tracks, params)

    ctx.progress.set("upload")
    out_key = f"{ctx.job.output_prefix}identity.json"
    payload: dict[str, Any] = {
        "contractVersion": CONTRACT_VERSION,
        "role": ARTIFACT_ROLE,
        "videoAssetId": inputs.get("videoAssetId"),
        "identifyVersionId": identify_version_id,
        "trackerVersionId": tracker_version_id,
        "trackJobId": source.get("jobId"),
        "tracksKey": key,
        "framesDecoded": decoded,
        "features": {str(t.local_id): t.feature for t in kit_tracks if t.feature is not None},
        **result,
    }
    out_path = ctx.work_dir / "identity.json"
    out_path.write_bytes(json.dumps(payload).encode())
    put_url = ctx.client.presign_output(ctx.job.job_id, out_key, "application/json")
    written = upload(ctx, put_url, out_path, "application/json")

    return StageResult(
        artifacts=[{"key": out_key, "bucket": "derived", "bytes": written, "contentType": "application/json", "role": ARTIFACT_ROLE}],
        summary={
            "identifyVersionId": identify_version_id,
            "trackerVersionId": tracker_version_id,
            "trackJobId": source.get("jobId"),
            "framesDecoded": decoded,
            "kits": result["kits"],
            "kitDistance": result["kitDistance"],
            "clusteredTracks": result["clusteredTracks"],
            "assigned": result["assigned"],
            "unknown": result["unknown"],
            "teamRows": result["rows"],
        },
        model_version_ids=[identify_version_id],
        bytes_read=bytes_read,
        bytes_written=written,
        class_a_operations=1,
        class_b_operations=2,
    )
