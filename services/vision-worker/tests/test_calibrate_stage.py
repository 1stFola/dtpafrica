"""The calibrate stage: pinned motion, checked chunks, carried rows, and refusals before any upload."""

from __future__ import annotations

import hashlib
import json

import numpy as np
import pytest

from dtp_vision_worker.config import CONTRACT_VERSION
from dtp_vision_worker.control_plane import JobSpec
from dtp_vision_worker.runner import StageContext, StageRefusal
from dtp_vision_worker.stages import calibrate as stage

from test_calibration_propagation import G, LANDMARKS_M, camera, motion_rows, true_calibration

PROXY = "b" * 64
N = 60


def keyframe_pin(f: int) -> dict:
    to_frame = camera(f) @ G
    points = []
    for x, y in LANDMARKS_M:
        p = to_frame @ np.array([x, y, 1.0])
        points.append({"px": float(p[0] / p[2]), "py": float(p[1] / p[2])})
    return {"calibrationId": f"k{f}", "quality": "good", "thresholdsVersion": "t", "homography": [float(v) for v in true_calibration(f).ravel()],
            "points": points, "frameIndex": f, "pitch": {"lengthM": 105, "widthM": 68}}


def build_motion(breaks=()):
    rows = motion_rows(N, breaks)
    lines = [(json.dumps(r, separators=(",", ":")) + "\n").encode() for r in rows]
    chunk_a, chunk_b = b"".join(lines[:40]), b"".join(lines[40:])
    files = {"inference/m/1/motion/motion-0000.jsonl": chunk_a, "inference/m/1/motion/motion-0001.jsonl": chunk_b}
    index = {"role": "camera_motion", "proxyChecksum": PROXY, "proxy": {"fps": 25, "sourceOffsetMs": 0},
             "chunks": [{"key": k, "sha256": hashlib.sha256(v).hexdigest(), "rows": n} for (k, v), n in zip(files.items(), (40, N - 40))]}
    files["inference/m/1/camera-motion.json"] = json.dumps(index).encode()
    return files


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    files = build_motion()
    params = {"proxy": {"fps": 25, "sourceOffsetMs": 0}, "proxyChecksum": PROXY, "chunkMs": 10_000,
              "cameraMotion": {"jobId": "m", "indexKey": "inference/m/1/camera-motion.json", "indexChecksum": hashlib.sha256(files["inference/m/1/camera-motion.json"]).hexdigest()},
              "segments": [{"cameraSegmentId": "seg", "startMs": 0, "endMs": 2400, "kind": "live_play", "calibrations": [keyframe_pin(30)]}]}
    inputs = {"videoAssetId": "asset", "params": params, "modelVersionIds": []}
    job = JobSpec.from_payload({"contractVersion": CONTRACT_VERSION, "jobId": "cal-job", "type": "calibrate", "resourceClass": "cpu_small", "attemptNumber": 1,
                                "inputs": inputs, "outputPrefix": "inference/cal-job/1/", "budget": {"maxRuntimeSeconds": 60, "maxCostUsdCents": 0}})

    class Client:
        asked: list = []

        def input_url(self, job_id, role, key=None):
            self.asked.append((role, key))
            return key

        def presign_output(self, job_id, key, content_type):
            return key

    class Progress:
        def set(self, *_a, **_k):
            pass

    context = StageContext(job=job, work_dir=tmp_path, client=Client(), progress=Progress(), http=None)
    uploads: dict[str, bytes] = {}

    def download(ctx, url, path):
        path.write_bytes(files[url])
        return len(files[url])

    def upload(ctx, key, path, content_type):
        uploads[key] = path.read_bytes()
        return len(uploads[key])

    monkeypatch.setattr(stage, "download", download)
    monkeypatch.setattr(stage, "upload", upload)
    return context, params, files, uploads


def rows_of(uploads, index):
    out = []
    for chunk in index["chunks"]:
        body = uploads[chunk["key"]]
        assert chunk["sha256"] == hashlib.sha256(body).hexdigest()
        out += [json.loads(line) for line in body.decode().splitlines()]
    return out


def test_carries_the_keyframe_to_every_frame_and_writes_checksummed_rows(fixture):
    context, params, files, uploads = fixture
    result = stage.run_calibrate(context)
    s = result.summary
    assert s["calculationVersion"] == "calibration-propagation/v1" and s["frames"] == N
    # 0..59 are at 0..2360 ms, all inside the segment; reach 10 s covers all of them.
    assert s["covered"] == N and s["coverage"] == 1.0 and s["reasons"] == {}
    assert [r for r, _ in context.client.asked] == ["declared"] * 3
    index = json.loads(uploads["inference/cal-job/1/calibration-frames.json"])
    assert index["role"] == "calibration_frames" and index["cameraMotion"]["indexChecksum"] == params["cameraMotion"]["indexChecksum"]
    assert s["indexChecksum"] == hashlib.sha256(uploads["inference/cal-job/1/calibration-frames.json"]).hexdigest()
    assert index["segments"][0] | {"drift": None} == {"cameraSegmentId": "seg", "startMs": 0, "endMs": 2400, "mode": "keyframes", "calibrationIds": ["k30"],
                                                      "frames": N, "covered": N, "drift": None}
    rows = rows_of(uploads, index)
    assert [r["f"] for r in rows] == list(range(N))
    h = np.array(rows[55]["H"]).reshape(3, 3)
    truth = true_calibration(55)
    probe = camera(55) @ G @ np.array([52.5, 34.0, 1.0])
    a, b = h @ (probe / probe[2]), truth @ (probe / probe[2])
    assert np.allclose(a[:2] / a[2], b[:2] / b[2], atol=1e-6)
    assert {a["role"] for a in result.artifacts} == {"calibration_frames", "calibration_frames_chunk"}


def test_a_cut_in_the_motion_stops_the_carry_and_says_why(fixture, monkeypatch):
    context, params, files, uploads = fixture
    cut = build_motion(breaks=(45,))
    files.clear(); files.update(cut)
    params["cameraMotion"]["indexChecksum"] = hashlib.sha256(cut["inference/m/1/camera-motion.json"]).hexdigest()
    result = stage.run_calibrate(context)
    assert result.summary["covered"] == 45 and result.summary["reasons"] == {"no_keyframe_in_shot": 15} and result.summary["shots"] == 2


@pytest.mark.parametrize("change", ["index checksum", "chunk bytes", "other proxy", "clock", "keyframe outside", "keyframe past", "bad segments", "model", "reach"])
def test_refuses_before_writing_anything(fixture, change):
    context, params, files, uploads = fixture
    if change == "index checksum": params["cameraMotion"]["indexChecksum"] = "c" * 64
    if change == "chunk bytes": files["inference/m/1/motion/motion-0001.jsonl"] += b"\n"
    if change == "other proxy": params["proxyChecksum"] = "d" * 64
    if change == "clock": params["proxy"]["fps"] = 30
    if change == "keyframe outside": params["segments"][0]["endMs"] = 1000
    if change == "keyframe past": params["segments"][0]["calibrations"][0]["frameIndex"] = 59 + 40; params["segments"][0]["endMs"] = 9000
    if change == "bad segments": params["segments"] = "nope"
    if change == "model": context.job.inputs["modelVersionIds"] = ["m"]
    if change == "reach": params["reachMs"] = 10
    with pytest.raises(StageRefusal):
        stage.run_calibrate(context)
    assert uploads == {}
