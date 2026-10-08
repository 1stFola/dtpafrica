"""The camera_motion stage: pinned proxy, chunked rows, shots, and refusals before any upload."""

from __future__ import annotations

import hashlib
import json
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from dtp_vision_worker.config import CONTRACT_VERSION
from dtp_vision_worker.control_plane import JobSpec
from dtp_vision_worker.runner import StageContext, StageRefusal
from dtp_vision_worker.stages import camera_motion as stage

PROXY_BYTES = b"the pinned proxy"
W, H = 640, 360


def world(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = cv2.GaussianBlur((rng.random((1000, 2000)) * 255).astype(np.uint8), (0, 0), 2.0)
    for _ in range(300):
        x, y = int(rng.integers(0, 1950)), int(rng.integers(0, 950))
        cv2.rectangle(img, (x, y), (x + int(rng.integers(6, 30)), y + int(rng.integers(6, 30))), int(rng.integers(0, 255)), -1)
    return img


def clip() -> list[bytes]:
    """16 frames: 9 panning over one ground, a cut, 7 panning over another."""
    out = []
    for i in range(16):
        img, x = (world(1), 300 + 4 * i) if i < 9 else (world(2), 900 - 4 * i)
        out.append(np.ascontiguousarray(img[200:200 + H, x:x + W]).tobytes())
    return out


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    params = {"proxy": {"fps": 1, "sourceOffsetMs": 0}, "proxyChecksum": hashlib.sha256(PROXY_BYTES).hexdigest(),
              "sourceDurationMs": 15_500, "chunkMs": 10_000}
    inputs = {"videoAssetId": "asset", "params": params, "modelVersionIds": []}
    job = JobSpec.from_payload({"contractVersion": CONTRACT_VERSION, "jobId": "motion-job", "type": "camera_motion", "resourceClass": "cpu_small",
                                "attemptNumber": 1, "inputs": inputs, "outputPrefix": "inference/motion-job/1/",
                                "budget": {"maxRuntimeSeconds": 60, "maxCostUsdCents": 0}})

    class Client:
        asked: list = []

        def input_url(self, job_id, role, key=None):
            self.asked.append(role)
            return "https://storage.test/proxy"

        def presign_output(self, job_id, key, content_type):
            return key

    class Progress:
        def set(self, *_a, **_k):
            pass

    context = StageContext(job=job, work_dir=tmp_path, client=Client(), progress=Progress(), http=None)
    uploads: dict[str, bytes] = {}
    decodes: list = []
    frames = clip()

    def download(ctx, url, path):
        path.write_bytes(PROXY_BYTES)
        return len(PROXY_BYTES)

    def upload(ctx, key, path, content_type):
        uploads[key] = path.read_bytes()
        return len(uploads[key])

    def gray_frames(path, width, height, every=1, timeout=0):
        decodes.append((width, height, every))
        assert (width, height) == (W, H)
        return iter(frames[::every])

    monkeypatch.setattr(stage, "download", download)
    monkeypatch.setattr(stage, "upload", upload)
    monkeypatch.setattr(stage, "probe", lambda path: SimpleNamespace(width=W, height=H, duration_ms=16_000))
    monkeypatch.setattr(stage, "gray_frames", gray_frames)
    return context, params, uploads, decodes


def test_measures_motion_on_the_pinned_proxy_and_proposes_the_shots_between_cuts(fixture):
    context, params, uploads, decodes = fixture
    result = stage.run_camera_motion(context)
    s = result.summary
    assert s["calculationVersion"] == "camera-motion/v1" and s["frames"] == 16
    assert s["break"] == 1 and s["tracked"] + s["bridged"] == 14
    # Frame 9 starts the second shot; the last ends at the source, not the proxy's tail.
    assert s["shots"] == [{"startFrame": 0, "endFrame": 9, "startMs": 0, "endMs": 9000},
                          {"startFrame": 9, "endFrame": 16, "startMs": 9000, "endMs": 15500}]
    assert context.client.asked == ["proxy"]
    # One decode a second for the overlay mask, then every frame.
    assert decodes == [(W, H, 1), (W, H, 1)]

    index = json.loads(uploads["inference/motion-job/1/camera-motion.json"])
    assert index["role"] == "camera_motion" and index["contractVersion"] == CONTRACT_VERSION
    assert index["proxyChecksum"] == params["proxyChecksum"] and (index["proxyWidth"], index["proxyHeight"]) == (W, H)
    assert s["indexChecksum"] == hashlib.sha256(uploads["inference/motion-job/1/camera-motion.json"]).hexdigest()
    # 10 frames to a chunk at 1 fps and 10 s chunks: 16 rows in two chunks, each checksummed.
    assert [(c["firstFrame"], c["lastFrame"], c["rows"]) for c in index["chunks"]] == [(0, 9, 10), (10, 15, 6)]
    rows = []
    for chunk in index["chunks"]:
        body = uploads[chunk["key"]]
        assert chunk["sha256"] == hashlib.sha256(body).hexdigest()
        rows += [json.loads(line) for line in body.decode().splitlines()]
    assert [r["f"] for r in rows] == list(range(16))
    assert rows[0]["status"] == "start" and rows[9]["status"] == "break" and rows[9]["H"] is None
    # The pan of 4 px a frame, measured in proxy pixels.
    h = np.array(rows[3]["H"]).reshape(3, 3)
    assert abs(h[0, 2] + 4) < 0.5 and abs(h[1, 2]) < 0.5
    assert {a["role"] for a in result.artifacts} == {"camera_motion", "camera_motion_chunk"}
    assert all(a["bucket"] == "derived" for a in result.artifacts)
    assert result.model_version_ids == [] and result.bytes_written == sum(len(b) for b in uploads.values())


def test_refuses_a_proxy_that_is_not_the_one_pinned(fixture):
    context, params, uploads, _ = fixture
    params["proxyChecksum"] = "f" * 64
    with pytest.raises(StageRefusal, match="not the one pinned"):
        stage.run_camera_motion(context)
    assert uploads == {}


@pytest.mark.parametrize("change", ["fps", "offset", "checksum", "duration", "chunk", "config", "model"])
def test_refuses_unusable_inputs_before_reading_anything(fixture, change):
    context, params, uploads, decodes = fixture
    if change == "fps": params["proxy"]["fps"] = 0
    if change == "offset": params["proxy"]["sourceOffsetMs"] = -1
    if change == "checksum": params["proxyChecksum"] = None
    if change == "duration": params["sourceDurationMs"] = 0
    if change == "chunk": params["chunkMs"] = 5
    if change == "config": params["cameraMotionConfig"] = {"minInliers": 1}
    if change == "model": context.job.inputs["modelVersionIds"] = ["model"]
    with pytest.raises(StageRefusal):
        stage.run_camera_motion(context)
    assert uploads == {} and decodes == [] and context.client.asked == []


def test_a_proxy_with_no_frames_is_refused(fixture, monkeypatch):
    context, _, uploads, _ = fixture
    monkeypatch.setattr(stage, "gray_frames", lambda *a, **k: iter([]))
    with pytest.raises(StageRefusal, match="no frames"):
        stage.run_camera_motion(context)
    assert uploads == {}
