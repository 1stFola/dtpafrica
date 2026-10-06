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
