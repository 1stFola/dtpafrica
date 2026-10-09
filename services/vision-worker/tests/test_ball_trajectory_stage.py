import hashlib
import json

import pytest

from dtp_vision_worker.config import CONTRACT_VERSION
from dtp_vision_worker.control_plane import JobSpec
from dtp_vision_worker.runner import StageContext, StageRefusal
from dtp_vision_worker.stages import ball_trajectory as stage

KEY = "inference/detect-job/1/detections.json"


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    params = {"videoAssetId": "asset", "proxy": {"fps": 25, "sourceOffsetMs": 0}, "sourceChecksum": "a" * 64, "proxyChecksum": "b" * 64,
              "sourceDurationMs": 200, "proxyDurationMs": 240, "imageWidth": 1280, "imageHeight": 720,
              "detections": {"jobId": "detect-job", "key": KEY, "modelVersionId": "detector", "sampleFps": 25, "weightsChecksum": "c" * 64},
              "segments": [{"cameraSegmentId": "live", "startMs": 0, "endMs": 200, "kind": "live_play"}]}
    frames = [{"frameIndex": i, "proxyTimeMs": i * 40, "sourceTimeMs": i * 40, "detections": [{"class": "ball", "confidence": 0.9, "box": {"x": 100, "y": 100, "width": 10, "height": 10}}]} for i in range(6)]
    artifact = {"role": "detections", "videoAssetId": "asset", "modelVersionId": "detector", "proxy": params["proxy"], "sampleFps": 25,
                "detector": {"weightsSha256": "c" * 64}, "sourceChecksum": "a" * 64, "proxyChecksum": "b" * 64, "proxyDurationMs": 240,
                "imageWidth": 1280, "imageHeight": 720, "frames": frames}
    inputs = {"videoAssetId": "asset", "params": params, "modelVersionIds": []}
    job = JobSpec.from_payload({"contractVersion": CONTRACT_VERSION, "jobId": "ball-job", "type": "ball_trajectory", "resourceClass": "cpu_small", "attemptNumber": 1,
                                "inputs": inputs, "outputPrefix": "inference/ball-job/1/", "budget": {"maxRuntimeSeconds": 60, "maxCostUsdCents": 0}})
    class Client:
        asked = []
        def input_url(self, job_id, role, key=None):
            self.asked.append((role, key)); return "https://storage.test/input"
        def presign_output(self, job_id, key, content_type): return key
    class Progress:
        def set(self, *_a, **_k): pass
    context = StageContext(job=job, work_dir=tmp_path, client=Client(), progress=Progress(), http=None)
    uploads = {}
    def download(ctx, url, path):
        body = json.dumps(artifact).encode(); path.write_bytes(body); return len(body)
    def upload(ctx, key, path, content_type):
        uploads[key] = path.read_bytes(); return path.stat().st_size
    monkeypatch.setattr(stage, "download", download); monkeypatch.setattr(stage, "upload", upload)
    return context, params, artifact, uploads


def test_processes_stored_detections_on_cpu_and_pins_chunk_and_input_checksums(fixture):
    context, params, artifact, uploads = fixture
    result = stage.run_ball_trajectory(context)
    assert result.summary["frames"] == 5 and result.summary["observed"] == 5 and result.summary["lost"] == 0
    assert result.model_version_ids == [] and result.gpu_seconds is None
    assert context.client.asked == [("declared", KEY)]
    index = json.loads(uploads["inference/ball-job/1/ball-trajectory.json"])
    chunk = index["chunks"][0]
    assert index["detectorVersionId"] == "detector" and index["calculationVersion"] == "ball-trajectory/v1"
    assert index["proxyChecksum"] == params["proxyChecksum"]
    assert index["detectionsChecksum"] == hashlib.sha256((context.work_dir / "detections.json").read_bytes()).hexdigest()
    assert chunk["checksumSha256"] == hashlib.sha256(uploads[chunk["key"]]).hexdigest()
    assert len(uploads[chunk["key"]].splitlines()) == 5
    assert result.bytes_written == sum(len(body) for body in uploads.values())
    assert all(row["bucket"] == "derived" for row in result.artifacts)


@pytest.mark.parametrize("change", ["detector", "weights", "asset", "clock", "sparse", "geometry", "proxy", "source", "frames"])
def test_refuses_incompatible_or_unattributable_upstream_evidence_before_upload(fixture, change):
    context, params, artifact, uploads = fixture
    if change == "detector": artifact["modelVersionId"] = "other"
    if change == "weights": artifact["detector"]["weightsSha256"] = "d" * 64
    if change == "asset": artifact["videoAssetId"] = "other"
    if change == "clock": artifact["proxy"] = {"fps": 25, "sourceOffsetMs": 1000}
    if change == "sparse": artifact["sampleFps"] = 2
    if change == "geometry": artifact["imageWidth"] = 1920
    if change == "proxy": artifact["proxyChecksum"] = "d" * 64
    if change == "source": artifact["sourceChecksum"] = "d" * 64
    if change == "frames": artifact["frames"][1]["sourceTimeMs"] = 999
    with pytest.raises(StageRefusal): stage.run_ball_trajectory(context)
    assert uploads == {}


def test_no_segments_means_explicit_unknown_not_an_assumed_live_camera(fixture):
    context, params, artifact, uploads = fixture
    params["segments"] = []
    result = stage.run_ball_trajectory(context)
    assert result.summary["observed"] == 0 and result.summary["lost"] == 5
    assert result.summary["reasons"] == {"camera_unknown": 5}


def test_bad_configuration_is_refused_before_any_download(fixture):
    context, params, artifact, uploads = fixture
    params["trajectoryConfig"] = {"smoothingMs": True}
    with pytest.raises(StageRefusal): stage.run_ball_trajectory(context)
    assert context.client.asked == []


# ── Ball-tiles/v2: tiled balls parked on one spot of the ground (docs/vision/95) ──

V2 = "builtin/torchvision/fasterrcnn_resnet50_fpn/COCO_V1+ball-tiles/v2"


def panning(tmp_path, monkeypatch, *, frames=100, config=V2, pin=True, tamper=False):
    """A camera panning 2 px a frame. A plain match ball runs across the picture; a tiled
    spare ball stays on one ground spot, so in the picture it drifts with the pan."""
    sha = lambda b: hashlib.sha256(b).hexdigest()
    ms = lambda i: i * 40
    rows = [{"f": 0, "status": "start", "H": None}] + [{"f": i, "status": "tracked", "H": [1, 0, -2, 0, 1, 0, 0, 0, 1]} for i in range(1, frames)]
    chunk = b"".join((json.dumps(r) + "\n").encode() for r in rows)
    index = json.dumps({"role": "camera_motion", "proxyChecksum": "b" * 64, "proxy": {"fps": 25, "sourceOffsetMs": 0},
                        "chunks": [{"key": "motion/0.jsonl", "sha256": sha(chunk), "rows": frames}]}).encode()
    det = [{"frameIndex": i, "proxyTimeMs": ms(i), "sourceTimeMs": ms(i), "detections": [
        {"class": "ball", "confidence": 0.9, "box": {"x": 300 + 3 * i, "y": 400, "width": 12, "height": 12}},
        {"class": "ball", "confidence": 0.95, "box": {"x": 900 - 2 * i, "y": 200, "width": 12, "height": 12}, "source": "ball_tiles"}]} for i in range(frames)]
    artifact = json.dumps({"role": "detections", "videoAssetId": "asset", "modelVersionId": "detector", "proxy": {"fps": 25, "sourceOffsetMs": 0}, "sampleFps": 25,
                           "detector": {"weightsSha256": "c" * 64}, "detectorConfig": config, "sourceChecksum": "a" * 64, "proxyChecksum": "b" * 64,
                           "proxyDurationMs": ms(frames), "imageWidth": 1280, "imageHeight": 720, "frames": det}).encode()
    objects = {KEY: artifact, "motion/index.json": index, "motion/0.jsonl": chunk + (b"x" if tamper else b"")}
    params = {"videoAssetId": "asset", "proxy": {"fps": 25, "sourceOffsetMs": 0}, "sourceChecksum": "a" * 64, "proxyChecksum": "b" * 64,
              "sourceDurationMs": ms(frames), "proxyDurationMs": ms(frames), "imageWidth": 1280, "imageHeight": 720,
              "detections": {"jobId": "detect-job", "key": KEY, "modelVersionId": "detector", "sampleFps": 25, "weightsChecksum": "c" * 64},
              "segments": [{"cameraSegmentId": "live", "startMs": 0, "endMs": ms(frames), "kind": "live_play"}]}
    if pin:
        params["cameraMotion"] = {"jobId": "motion", "indexKey": "motion/index.json", "indexChecksum": sha(index)}
    job = JobSpec.from_payload({"contractVersion": CONTRACT_VERSION, "jobId": "ball-job", "type": "ball_trajectory", "resourceClass": "cpu_small", "attemptNumber": 1,
                                "inputs": {"videoAssetId": "asset", "params": params, "modelVersionIds": []}, "outputPrefix": "inference/ball-job/1/",
                                "budget": {"maxRuntimeSeconds": 60, "maxCostUsdCents": 0}})
    class Client:
        asked = []
        def input_url(self, job_id, role, key=None): self.asked.append(key); return key
        def presign_output(self, job_id, key, content_type): return key
    class Progress:
        def set(self, *_a, **_k): pass
    uploads = {}
    monkeypatch.setattr(stage, "download", lambda ctx, key, path: path.write_bytes(objects[key]) or len(objects[key]))
    monkeypatch.setattr(stage, "upload", lambda ctx, key, path, ct: uploads.__setitem__(key, path.read_bytes()) or path.stat().st_size)
    return StageContext(job=job, work_dir=tmp_path, client=Client(), progress=Progress(), http=None), uploads


def test_a_parked_tiled_ball_is_dropped_and_the_match_ball_followed(tmp_path, monkeypatch):
    ctx, uploads = panning(tmp_path, monkeypatch)
    result = stage.run_ball_trajectory(ctx)
    # Without the parked ball every frame would be ambiguous; with it gone, all 100 follow the match ball.
    assert result.summary["observed"] == 100 and result.summary["parkedTileBalls"] == 100
    index = json.loads(uploads["inference/ball-job/1/ball-trajectory.json"])
    assert index["cameraMotion"]["jobId"] == "motion" and index["parked"] == {"minFrames": 60, "radiusPx": 6.0}
    rows = [json.loads(line) for line in uploads[index["chunks"][0]["key"]].splitlines()]
    assert all(abs(r["rawPoint"]["y"] - 406 / 720) < 1e-9 for r in rows)
    assert ctx.client.asked == [KEY, "motion/index.json", "motion/0.jsonl"]


def test_a_tiled_ball_seen_for_less_than_the_dwell_is_kept(tmp_path, monkeypatch):
    ctx, _ = panning(tmp_path, monkeypatch, frames=50)
    result = stage.run_ball_trajectory(ctx)
    assert result.summary["parkedTileBalls"] == 0 and result.summary["reasons"] == {"ambiguous": 50}


@pytest.mark.parametrize("change", ["no pin for tiled", "pin for plain", "motion changed"])
def test_refuses_tiled_detections_and_camera_motion_that_do_not_belong_together(tmp_path, monkeypatch, change):
    ctx, uploads = panning(tmp_path, monkeypatch, pin=change != "no pin for tiled", config=None if change == "pin for plain" else V2, tamper=change == "motion changed")
    with pytest.raises(StageRefusal):
        stage.run_ball_trajectory(ctx)
    assert not uploads
