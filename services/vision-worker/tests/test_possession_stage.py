import hashlib
import json

import pytest

from dtp_vision_worker.control_plane import JobSpec
from dtp_vision_worker.config import CONTRACT_VERSION
from dtp_vision_worker.runner import StageContext, StageRefusal
from dtp_vision_worker.stages import possession as stage


def sha(body):
    return hashlib.sha256(body).hexdigest()


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    proxy = {"fps": 25, "sourceOffsetMs": 0}
    segments = [{"cameraSegmentId": "live", "startMs": 0, "endMs": 400, "kind": "live_play"}]
    ball_key, chunk_key, track_key = "inference/ball/1/ball-trajectory.json", "inference/ball/1/ball/000.jsonl", "inference/track/1/tracks.json"
    shared = {"sourceChecksum": "a" * 64, "proxyChecksum": "b" * 64, "detectionsChecksum": "c" * 64, "imageWidth": 1000, "imageHeight": 500, "proxy": proxy}
    balls = [{"frameIndex": i, "sourceTimeMs": i * 40, "cameraSegmentId": "live", "trajectoryId": 1, "state": "observed", "reason": None,
              "point": {"x": .11, "y": .4}, "rawPoint": {"x": .11, "y": .4}, "confidence": .9} for i in range(10)]
    ball_index = {**shared, "role": "ball_trajectory", "calculationVersion": "ball-trajectory/v1", "videoAssetId": "asset", "segments": segments,
                  "detectorJobId": "detect", "detectorVersionId": "detector", "frames": 10, "windowStartMs": 0, "windowEndMs": 400, "observed": 10, "lost": 0,
                  "chunks": [{"key": chunk_key, "rows": 10, "checksumSha256": ""}]}
    tracks = {**shared, "role": "tracks", "videoAssetId": "asset", "trackerVersionId": "tracker", "detectJobId": "detect", "detectorVersionId": "detector", "proxyDurationMs": 440,
              "sampleFps": 25, "cameraCuts": [], "tracks": [{"localTrackId": 1, "class": "player", "confirmed": True,
              "positions": [{"frameIndex": i, "sourceTimeMs": i * 40, "proxyTimeMs": i * 40, "confidence": .8, "box": {"x": 100, "y": 100, "width": 20, "height": 100}} for i in range(11)]}]}
    params = {**shared, "videoAssetId": "asset", "sourceDurationMs": 400, "proxyDurationMs": 440, "segments": segments,
              "detectorJobId": "detect", "detectorVersionId": "detector", "ball": {"jobId": "ball", "key": ball_key, "indexChecksum": "", "chunkKeys": [chunk_key]},
              "tracks": {"jobId": "track", "key": track_key, "trackerVersionId": "tracker", "checksum": ""}}
    job = JobSpec.from_payload({"contractVersion": CONTRACT_VERSION, "jobId": "possession", "type": "possession", "resourceClass": "cpu_small", "attemptNumber": 1,
            "inputs": {"videoAssetId": "asset", "modelVersionIds": [], "params": params}, "outputPrefix": "inference/possession/1/", "budget": {"maxRuntimeSeconds": 60, "maxCostUsdCents": 0}})
    class Client:
        asked = []
        def input_url(self, job_id, role, key=None): self.asked.append((role, key)); return key
        def presign_output(self, job_id, key, content_type): return key
    class Progress:
        def set(self, *_a, **_k): pass
    ctx = StageContext(job=job, work_dir=tmp_path, client=Client(), progress=Progress(), http=None)
    uploads, objects = {}, {}
    def repin():
        objects[chunk_key] = b"".join((json.dumps(row) + "\n").encode() for row in balls)
        ball_index["chunks"][0]["checksumSha256"] = sha(objects[chunk_key])
        objects[ball_key] = json.dumps(ball_index).encode(); params["ball"]["indexChecksum"] = sha(objects[ball_key])
        objects[track_key] = json.dumps(tracks).encode(); params["tracks"]["checksum"] = sha(objects[track_key])
    repin()
    def download(ctx, key, path): path.write_bytes(objects[key]); return len(objects[key])
    def upload(ctx, key, path, content_type): uploads[key] = path.read_bytes(); return path.stat().st_size
    monkeypatch.setattr(stage, "download", download); monkeypatch.setattr(stage, "upload", upload)
    return ctx, params, ball_index, tracks, balls, objects, uploads, repin


def test_cpu_stage_reads_only_declared_objects_and_writes_unreviewed_segments(fixture):
    ctx, params, index, tracks, balls, objects, uploads, repin = fixture
    result = stage.run_possession(ctx)
    assert result.summary["frames"] == 10 and result.summary["candidateFrames"] == 5 and result.summary["unknownFrames"] == 5
    assert result.model_version_ids == [] and result.gpu_seconds is None
    assert result.summary["reviewState"] == "unreviewed" and result.summary["coordinateBasis"] == "image_foot_proximity"
    assert ctx.client.asked == [("declared", params["ball"]["key"]), ("declared", params["tracks"]["key"]), ("declared", params["ball"]["chunkKeys"][0])]
    assert result.bytes_read == sum(len(v) for v in objects.values())
    assert result.bytes_written == sum(len(v) for v in uploads.values())
    saved = json.loads(uploads["inference/possession/1/possession.json"])
    assert saved["tracksChecksum"] == params["tracks"]["checksum"]
    chunk = saved["chunks"][0]
    assert sha(uploads[chunk["key"]]) == chunk["checksumSha256"]
    segments = [json.loads(line) for line in uploads[chunk["key"]].splitlines()]
    assert segments[0]["state"] == "unknown" and segments[1]["state"] == "candidate"
    assert segments[-1]["endMs"] == 400  # excludes the 440 ms proxy tail
    assert all(s["reviewState"] == "unreviewed" for s in segments)


@pytest.mark.parametrize("change", ["index_sha", "track_sha", "chunk_sha", "detector", "source", "geometry", "clock", "camera", "chunk_key", "rows", "ball_gap", "sparse", "tracker", "cuts"])
def test_refuses_corrupt_or_incompatible_evidence_before_upload(fixture, change):
    ctx, params, index, tracks, balls, objects, uploads, repin = fixture
    if change == "detector": tracks["detectJobId"] = "another"
    if change == "source": tracks["sourceChecksum"] = "d" * 64
    if change == "geometry": tracks["imageWidth"] = 2000
    if change == "clock": tracks["proxy"] = {"fps": 25, "sourceOffsetMs": 1000}
    if change == "camera": index["segments"] = []
    if change == "chunk_key": params["ball"]["chunkKeys"] = ["master/not-declared"]
    if change == "rows": index["chunks"][0]["rows"] = 9
    if change == "ball_gap": balls.pop()
    if change == "sparse": tracks["sampleFps"] = 2
    if change == "tracker": tracks["trackerVersionId"] = "other"
    if change == "cuts": tracks["cameraCuts"] = None
    repin()
    if change == "index_sha": objects[params["ball"]["key"]] += b" "
    if change == "track_sha": objects[params["tracks"]["key"]] += b" "
    if change == "chunk_sha": objects[params["ball"]["chunkKeys"][0]] += b" "
    with pytest.raises(StageRefusal): stage.run_possession(ctx)
    assert uploads == {}


def test_all_lost_produces_honest_unknown_not_no_output(fixture):
    ctx, params, index, tracks, balls, objects, uploads, repin = fixture
    for row in balls: row.update(state="lost", reason="no_detection", trajectoryId=None, point=None, rawPoint=None, confidence=None)
    index.update(observed=0, lost=10)
    repin()
    result = stage.run_possession(ctx)
    assert result.summary["candidateFrames"] == 0 and result.summary["unknownFrames"] == 10
    assert result.summary["candidateFrameCoverage"] == 0 and result.summary["reasons"] == {"ball_lost": 10}


def test_bad_configuration_refuses_before_any_read(fixture):
    ctx, params, *_ = fixture
    params["possessionConfig"] = {"minContinuityMs": 0}
    with pytest.raises(StageRefusal): stage.run_possession(ctx)
    assert ctx.client.asked == []


@pytest.mark.parametrize("quality,frames", [("good", 5), (None, 0), ("failed", 0)])
def test_calibrated_handler_pins_geometry_and_preserves_unknown(fixture, quality, frames):
    from test_possession import clock
    from test_possession_constraints import snapshot
    ctx, params, *_ = fixture
    params["constraintMode"] = "calibrated"
    params["calibrationSnapshot"] = snapshot(clock(), quality)
    result = stage.run_possession(ctx)
    assert result.summary["calculationVersion"] == "possession-candidates/v2"
    assert result.summary["candidateFrames"] == frames
    assert result.summary["calibrationSnapshot"] == params["calibrationSnapshot"]
    assert result.summary["footballConfig"]["maxGroundDistanceM"] == 2
    assert result.summary["reviewState"] == "unreviewed"


def test_calibrated_handler_refuses_different_proxy_bytes_before_read(fixture):
    from test_possession import clock
    from test_possession_constraints import snapshot
    ctx, params, *_ = fixture
    params["constraintMode"] = "calibrated"
    params["calibrationSnapshot"] = snapshot(clock())
    params["calibrationSnapshot"]["proxyChecksum"] = "f" * 64
    with pytest.raises(StageRefusal): stage.run_possession(ctx)
    assert ctx.client.asked == []


@pytest.mark.parametrize("camera_cut", [False, True])
def test_real_ball_and_track_handlers_feed_the_possession_handler_without_contract_adapters(fixture, monkeypatch, camera_cut):
    """Integration of the actual three producers, using synthetic detections only."""
    from dtp_vision_worker.stages import ball_trajectory, track
    ctx, params, index, tracks, balls, objects, uploads, repin = fixture
    if camera_cut:
        params["segments"] = [{"cameraSegmentId": "first", "startMs": 0, "endMs": 160, "kind": "live_play"}, {"cameraSegmentId": "second", "startMs": 160, "endMs": 400, "kind": "live_play"}]
    key = "inference/detect/1/detections.json"
    detection = {"role": "detections", "videoAssetId": "asset", "modelVersionId": "detector", "detector": {"weightsSha256": "f" * 64},
                 "proxy": params["proxy"], "sampleFps": 25, "sourceChecksum": params["sourceChecksum"], "proxyChecksum": params["proxyChecksum"],
                 "imageWidth": 1000, "imageHeight": 500, "proxyDurationMs": 440,
                 "frames": [{"frameIndex": i, "proxyTimeMs": i * 40, "sourceTimeMs": i * 40, "detections": [
                     {"class": "player", "confidence": .8, "box": {"x": 100, "y": 100, "width": 20, "height": 100}},
                     {"class": "ball", "confidence": .9, "box": {"x": 105, "y": 195, "width": 10, "height": 10}}]} for i in range(11)]}
    objects[key] = json.dumps(detection).encode()
    def download(context, object_key, path): path.write_bytes(objects[object_key]); return len(objects[object_key])
    def upload(context, object_key, path, content_type): objects[object_key] = path.read_bytes(); return path.stat().st_size
    for module in (ball_trajectory, track):
        monkeypatch.setattr(module, "download", download); monkeypatch.setattr(module, "upload", upload)
    declared = {"jobId": "detect", "key": key, "modelVersionId": "detector", "sampleFps": 25, "weightsChecksum": "f" * 64}
    def context(type, input_params, model_ids):
        spec = JobSpec.from_payload({"contractVersion": CONTRACT_VERSION, "jobId": type, "type": "ball_trajectory" if type == "ball" else type, "resourceClass": "cpu_small", "attemptNumber": 1,
                    "inputs": {"videoAssetId": "asset", "params": input_params, "modelVersionIds": model_ids}, "outputPrefix": f"inference/{type}/1/", "budget": {"maxRuntimeSeconds": 60, "maxCostUsdCents": 0}})
        directory = ctx.work_dir / type
        directory.mkdir()
        return StageContext(job=spec, work_dir=directory, client=ctx.client, progress=ctx.progress, http=None)
    ball_result = ball_trajectory.run_ball_trajectory(context("ball", {**params, "detections": declared}, []))
    track_result = track.run_track(context("track", {"detections": declared, "cuts": [160] if camera_cut else []}, ["tracker"]))
    params["ball"] = {"jobId": "ball", "key": next(a["key"] for a in ball_result.artifacts if a["role"] == "ball_trajectory"),
                      "indexChecksum": ball_result.summary["indexChecksum"], "chunkKeys": [a["key"] for a in ball_result.artifacts if a["role"] == "ball_trajectory_chunk"]}
    params["tracks"] = {"jobId": "track", "key": track_result.artifacts[0]["key"], "trackerVersionId": "tracker", "checksum": track_result.summary["tracksChecksum"]}
    params["detectionsChecksum"] = sha(objects[key])
    result = stage.run_possession(ctx)
    assert result.summary["candidateFrames"] == (1 if camera_cut else 5)
    assert result.summary["unknownFrames"] == (9 if camera_cut else 5)
    assert result.summary["frames"] == 10
    assert track_result.summary["detectionsChecksum"] == ball_result.summary["detectionsChecksum"] == params["detectionsChecksum"]
    assert track_result.summary["cameraCuts"] == ([160] if camera_cut else [])


def carried_run(objects, carried_until=6, frames=11):
    """A calibrate run carrying the proxy's first `carried_until` frames, pinned as the control plane pins it."""
    chunk = b"".join((json.dumps({"f": f, "cameraSegmentId": "live", "H": [.1, 0, 0, 0, .1, 0, 0, 0, 1] if f < carried_until else None,
                                  "quality": "good" if f < carried_until else None}) + "\n").encode() for f in range(frames))
    objects["inference/c/1/c0.jsonl"] = chunk
    objects["inference/c/1/index.json"] = json.dumps({"role": "calibration_frames", "proxy": {"fps": 25, "sourceOffsetMs": 0}, "chunks": [{"key": "inference/c/1/c0.jsonl", "sha256": sha(chunk)}]}).encode()
    return {"jobId": "c", "indexKey": "inference/c/1/index.json", "indexChecksum": sha(objects["inference/c/1/index.json"]), "chunkKeys": ["inference/c/1/c0.jsonl"]}


def test_calibrated_handler_reads_a_moving_cameras_frames_from_the_pinned_run(fixture, monkeypatch):
    from dtp_vision_worker import runner
    from test_possession import clock
    from test_carried_frames import carried_snapshot
    ctx, params, index, tracks, balls, objects, uploads, repin = fixture
    monkeypatch.setattr(runner, "download", lambda ctx, key, path: path.write_bytes(objects[key]) or len(objects[key]))
    snap = carried_snapshot(clock())
    snap["carried"] = carried_run(objects)
    params["constraintMode"], params["calibrationSnapshot"] = "calibrated", snap
    result = stage.run_possession(ctx)
    # Five frames of continuity then one candidate where the camera was carried; Unknown after.
    assert result.summary["candidateFrames"] == 1
    assert result.summary["reasons"]["calibration_unavailable"] == 4
    assert ("declared", "inference/c/1/index.json") in ctx.client.asked and ("declared", "inference/c/1/c0.jsonl") in ctx.client.asked
    assert result.summary["calibrationSnapshot"]["carried"] == snap["carried"]


def test_calibrated_handler_refuses_a_run_other_than_pinned(fixture, monkeypatch):
    from dtp_vision_worker import runner
    from test_possession import clock
    from test_carried_frames import carried_snapshot
    ctx, params, index, tracks, balls, objects, uploads, repin = fixture
    monkeypatch.setattr(runner, "download", lambda ctx, key, path: path.write_bytes(objects[key]) or len(objects[key]))
    snap = carried_snapshot(clock())
    snap["carried"] = carried_run(objects) | {"indexChecksum": "f" * 64}
    params["constraintMode"], params["calibrationSnapshot"] = "calibrated", snap
    with pytest.raises(StageRefusal):
        stage.run_possession(ctx)
    assert not uploads
