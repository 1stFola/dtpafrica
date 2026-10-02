"""The track stage: what it reads, what it refuses, and the provenance it writes."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from dtp_vision_worker.config import CONTRACT_VERSION
from dtp_vision_worker.control_plane import JobSpec
from dtp_vision_worker.runner import StageContext, StageRefusal
from dtp_vision_worker.stages import track as track_stage

TRACKER = "6a1b2c3d-0000-4000-8000-00000000000a"
DETECTOR = "6a1b2c3d-0000-4000-8000-00000000000b"
DET_KEY = "inference/job-d/1/detections.json"


def artifact(fps: float = 25, model: str = DETECTOR) -> dict[str, Any]:
    frames = []
    for i in range(6):
        ms = int(round(i / 25 * 1000))
        frames.append({"frameIndex": i, "proxyTimeMs": ms, "sourceTimeMs": ms, "detections": [
            {"class": "player", "confidence": 0.9, "box": {"x": 100 + i, "y": 100, "width": 40, "height": 80}},
        ]})
    return {"modelVersionId": model, "sampleFps": fps, "proxy": {"fps": 25, "sourceOffsetMs": 0}, "frames": frames}


def spec(inputs: dict[str, Any] | None = None) -> JobSpec:
    return JobSpec.from_payload({
        "contractVersion": CONTRACT_VERSION, "jobId": "job-track", "type": "track", "resourceClass": "cpu_small", "attemptNumber": 1,
        "inputs": inputs if inputs is not None else {
            "videoAssetId": "asset-1", "modelVersionIds": [TRACKER],
            "params": {"videoAssetId": "asset-1", "proxy": {"fps": 25, "sourceOffsetMs": 0},
                       "detections": {"jobId": "job-d", "key": DET_KEY, "modelVersionId": DETECTOR, "sampleFps": 25},
                       "readKeys": [{"bucket": "derived", "key": DET_KEY}]},
        },
        "outputPrefix": "inference/job-track/1/", "budget": {"maxRuntimeSeconds": 600, "maxCostUsdCents": 50},
    })


class FakeClient:
    def __init__(self, objects: dict[str, Any]) -> None:
        self.objects = objects
        self.asked: list[tuple[str, str | None]] = []

    def input_url(self, _job_id: str, role: str, key: str | None = None) -> str:
        self.asked.append((role, key))
        return f"https://storage.test/{key}"

    def presign_output(self, _job_id: str, key: str, _ct: str) -> str:
        return f"https://storage.test/put/{key}"


class FakeProgress:
    def set(self, *_a: object, **_k: object) -> None:
        pass


@pytest.fixture
def ctx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    objects = {DET_KEY: artifact()}
    client = FakeClient(objects)
    context = StageContext(job=spec(), work_dir=tmp_path, client=client, http=None, progress=FakeProgress())  # type: ignore[arg-type]

    def fake_download(_c: object, url: str, target: Path) -> int:
        body = json.dumps(objects[url.removeprefix("https://storage.test/")]).encode()
        target.write_bytes(body)
        return len(body)

    uploaded: dict[str, Any] = {}

    def fake_upload(_c: object, _url: str, source: Path, _ct: str) -> int:
        uploaded["payload"] = json.loads(source.read_bytes())
        return source.stat().st_size

    monkeypatch.setattr(track_stage, "download", fake_download)
    monkeypatch.setattr(track_stage, "upload", fake_upload)
    context.uploaded = uploaded  # type: ignore[attr-defined]
    context.objects = objects  # type: ignore[attr-defined]
    return context


def test_links_the_artifact_and_names_both_models(ctx) -> None:
    result = track_stage.run_track(ctx)
    assert result.summary["trackerVersionId"] == TRACKER
    assert result.summary["detectorVersionId"] == DETECTOR
    assert result.summary["tracks"] == 1
    assert result.summary["trackRows"][0]["detectionCount"] == 6
    assert "positions" not in result.summary["trackRows"][0]
    assert result.model_version_ids == [TRACKER]
    payload = ctx.uploaded["payload"]
    assert payload["role"] == "tracks"
    assert payload["trackerVersionId"] == TRACKER and payload["detectorVersionId"] == DETECTOR
    assert payload["tracks"][0]["positions"][0]["frameIndex"] == 0
    assert payload["params"]["minHits"] == 3


def test_reads_only_by_declared_key_and_writes_to_derived(ctx) -> None:
    result = track_stage.run_track(ctx)
    assert ctx.client.asked == [("declared", DET_KEY)]
    assert result.artifacts[0]["bucket"] == "derived"
    assert result.artifacts[0]["key"] == "inference/job-track/1/tracks.json"


def test_refuses_sparse_detections(ctx) -> None:
    ctx.objects[DET_KEY] = artifact(fps=2)
    with pytest.raises(StageRefusal, match="at least 10"):
        track_stage.run_track(ctx)


def test_refuses_an_artifact_with_no_detector_version(ctx) -> None:
    a = artifact()
    a.pop("modelVersionId")
    ctx.objects[DET_KEY] = a
    with pytest.raises(StageRefusal, match="names no model version"):
        track_stage.run_track(ctx)


def test_refuses_an_artifact_from_a_detector_other_than_declared(ctx) -> None:
    ctx.objects[DET_KEY] = artifact(model="someone-else")
    with pytest.raises(StageRefusal, match="declared detector"):
        track_stage.run_track(ctx)


@pytest.mark.parametrize(
    "inputs",
    [
        {"videoAssetId": "asset-1", "modelVersionIds": [], "params": {"detections": {"key": DET_KEY}}},
        {"videoAssetId": "asset-1", "modelVersionIds": [TRACKER, "x"], "params": {"detections": {"key": DET_KEY}}},
        {"videoAssetId": "asset-1", "modelVersionIds": [TRACKER], "params": {}},
        {"videoAssetId": "asset-1", "modelVersionIds": [TRACKER], "params": {"detections": {"key": ""}}},
    ],
    ids=["no-tracker", "two-trackers", "no-detections", "empty-key"],
)
def test_refuses_a_misdispatched_job_before_reading(ctx, inputs) -> None:
    ctx.job = spec(inputs)
    with pytest.raises(StageRefusal):
        track_stage.run_track(ctx)
    assert ctx.client.asked == []
