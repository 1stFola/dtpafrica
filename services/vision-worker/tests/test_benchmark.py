"""The benchmark stage: what it reads, what it refuses, and what it reports.

The arithmetic is tested in test_evaluate.py. What is under test here is the stage
around it: that it reads only by declared key, refuses an artifact from another
model, refuses a gold member with nothing to score, and reports the summary the
control plane turns into metric rows.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from dtp_vision_worker.config import CONTRACT_VERSION
from dtp_vision_worker.control_plane import JobSpec
from dtp_vision_worker.runner import StageContext, StageRefusal
from dtp_vision_worker.stages import benchmark as bench_stage

MODEL = "6a1b2c3d-0000-4000-8000-000000000001"
DATASET = "6a1b2c3d-0000-4000-8000-000000000002"
RUN = "6a1b2c3d-0000-4000-8000-000000000003"
GOLD_KEY = f"datasets/{DATASET}/export/samples.json"
DET_KEY = "inference/job-d/1/detections.json"


def params(**over: Any) -> dict[str, Any]:
    return {
        "benchmarkRunId": RUN,
        "goldLabelsKey": GOLD_KEY,
        "task": "detect",
        "predictions": [{"videoAssetId": "a1", "key": DET_KEY}],
        "readKeys": [{"bucket": "derived", "key": GOLD_KEY}, {"bucket": "derived", "key": DET_KEY}],
        "iou": 0.5,
        "classes": ["player", "goalkeeper", "referee", "ball"],
        **over,
    }


def spec(inputs: dict[str, Any] | None = None, **over: Any) -> JobSpec:
    return JobSpec.from_payload(
        {
            "contractVersion": CONTRACT_VERSION,
            "jobId": "job-bench",
            "type": "benchmark",
            "resourceClass": "cpu_small",
            "attemptNumber": 1,
            "inputs": inputs
            if inputs is not None
            else {"datasetVersionId": DATASET, "modelVersionIds": [MODEL], "params": params(**over)},
            "outputPrefix": "inference/job-bench/1/",
            "budget": {"maxRuntimeSeconds": 600, "maxCostUsdCents": 50},
        }
    )


GOLD = {
    "samples": [
        {
            "filepath": "proxies/a1/proxy.mp4",
            "metadata": {"frame_width": 1280, "frame_height": 720},
            "frames": {
                "26": {"detections": {"detections": [
                    {"label": "player", "bounding_box": [0.1, 0.1, 0.1, 0.2]},
                    {"label": "ball", "bounding_box": [0.5, 0.5, 0.02, 0.03]},
                ]}}
            },
            "provenance": {"video_asset_id": "a1", "source_quality_rank": "broadcast"},
        }
    ]
}


def artifact(model: str = MODEL) -> dict[str, Any]:
    return {
        "modelVersionId": model,
        "frames": [
            {"frameIndex": 25, "detections": [
                {"class": "player", "confidence": 0.9, "box": {"x": 128, "y": 72, "width": 128, "height": 144}},
            ]}
        ],
    }


class FakeClient:
    def __init__(self, objects: dict[str, Any]) -> None:
        self.objects = objects
        self.asked: list[tuple[str, str | None]] = []

    def input_url(self, _job_id: str, role: str, key: str | None = None) -> str:
        self.asked.append((role, key))
        return f"https://storage.test/{key}"

    def presign_output(self, _job_id: str, key: str, _ct: str) -> str:
        self.output_key = key
        return f"https://storage.test/put/{key}"


class FakeProgress:
    def set(self, *_a: object, **_k: object) -> None:
        pass


@pytest.fixture
def ctx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    objects = {GOLD_KEY: GOLD, DET_KEY: artifact()}
    client = FakeClient(objects)
    context = StageContext(
        job=spec(), work_dir=tmp_path, client=client, http=None, progress=FakeProgress()  # type: ignore[arg-type]
    )

    def fake_download(_c: object, url: str, target: Path) -> int:
        key = url.removeprefix("https://storage.test/")
        body = json.dumps(objects[key]).encode()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        return len(body)

    uploaded: dict[str, Any] = {}

    def fake_upload(_c: object, _url: str, source: Path, _ct: str) -> int:
        uploaded["payload"] = json.loads(source.read_bytes())
        return source.stat().st_size

    monkeypatch.setattr(bench_stage, "download", fake_download)
    monkeypatch.setattr(bench_stage, "upload", fake_upload)
    context.uploaded = uploaded  # type: ignore[attr-defined]
    context.objects = objects  # type: ignore[attr-defined]
    return context


def test_scores_the_gold_and_reports_the_summary(ctx) -> None:
    result = bench_stage.run_benchmark(ctx)
    assert result.summary["benchmarkRunId"] == RUN
    assert result.summary["modelVersionId"] == MODEL
    assert result.summary["framesLabelled"] == 1
    assert result.summary["framesScored"] == 1
    by = {(m["metric"], m["slice"]): m["value"] for m in result.summary["metrics"]}
    assert by[("recall:player", "all")] == 1.0
    assert by[("recall:ball", "all")] == 0.0
    assert by[("recall:all", "quality:broadcast")] == 0.5


def test_reads_only_by_declared_key(ctx) -> None:
    bench_stage.run_benchmark(ctx)
    assert ctx.client.asked == [("declared", GOLD_KEY), ("declared", DET_KEY)]


def test_the_report_goes_to_the_models_bucket_and_names_its_inputs(ctx) -> None:
    result = bench_stage.run_benchmark(ctx)
    assert result.artifacts[0]["bucket"] == "models"
    assert result.artifacts[0]["key"] == "inference/job-bench/1/benchmark.json"
    assert result.artifacts[0]["role"] == "benchmark"
    payload = ctx.uploaded["payload"]
    assert payload["goldLabelsKey"] == GOLD_KEY
    assert payload["predictions"] == [{"videoAssetId": "a1", "key": DET_KEY}]
    assert payload["contractVersion"] == CONTRACT_VERSION


def test_a_benchmark_ran_no_model_and_says_so(ctx) -> None:
    """The control plane refuses a non-model-bound completion that claims a model."""
    assert bench_stage.run_benchmark(ctx).model_version_ids == []


def test_refuses_an_artifact_from_another_model(ctx) -> None:
    ctx.objects[DET_KEY] = artifact(model="someone-else")
    with pytest.raises(StageRefusal, match="produced by model version 'someone-else'"):
        bench_stage.run_benchmark(ctx)


def test_refuses_a_gold_member_with_no_artifact_listed(ctx) -> None:
    ctx.job = spec(predictions=[])
    with pytest.raises(StageRefusal, match="no detect artifact listed"):
        bench_stage.run_benchmark(ctx)


def test_refuses_a_gold_sample_with_no_frame_size(ctx) -> None:
    ctx.objects[GOLD_KEY] = {"samples": [{**GOLD["samples"][0], "metadata": {}}]}
    with pytest.raises(StageRefusal, match="no frame size"):
        bench_stage.run_benchmark(ctx)


@pytest.mark.parametrize(
    "inputs",
    [
        {"datasetVersionId": DATASET, "modelVersionIds": [], "params": params()},
        {"datasetVersionId": DATASET, "modelVersionIds": [MODEL, "x"], "params": params()},
        {"modelVersionIds": [MODEL], "params": params()},
        {"datasetVersionId": DATASET, "modelVersionIds": [MODEL], "params": params(iou=0)},
        {"datasetVersionId": DATASET, "modelVersionIds": [MODEL], "params": params(iou=1.5)},
        {"datasetVersionId": DATASET, "modelVersionIds": [MODEL], "params": params(classes=[])},
        {"datasetVersionId": DATASET, "modelVersionIds": [MODEL], "params": {**params(), "goldLabelsKey": None}},
    ],
    ids=["no-model", "two-models", "no-dataset", "iou-zero", "iou-over-one", "no-classes", "no-gold-key"],
)
def test_refuses_a_misdispatched_job_before_reading_anything(ctx, inputs) -> None:
    ctx.job = spec(inputs)
    with pytest.raises(StageRefusal):
        bench_stage.run_benchmark(ctx)
    assert ctx.client.asked == []


TRK_KEY = "inference/job-t/1/tracks.json"
TRACKER = "6a1b2c3d-0000-4000-8000-00000000000a"


def test_scores_a_tracker_against_gold_tracks(ctx) -> None:
    """Gold: one player track A on frames 26 and 27. Prediction: track 5 on both, exactly. MOTA 1, IDF1 1."""
    ctx.objects[GOLD_KEY] = {"samples": [{
        **GOLD["samples"][0],
        "frames": {
            "26": {"detections": {"detections": [{"label": "player", "bounding_box": [0.1, 0.1, 0.1, 0.2], "track_id": "A"}]}},
            "27": {"detections": {"detections": [{"label": "player", "bounding_box": [0.1, 0.1, 0.1, 0.2], "track_id": "A"}]}},
        },
    }]}
    ctx.objects[TRK_KEY] = {"trackerVersionId": TRACKER, "tracks": [{"localTrackId": 5, "class": "player", "positions": [
        {"frameIndex": 25, "box": {"x": 128, "y": 72, "width": 128, "height": 144}},
        {"frameIndex": 26, "box": {"x": 128, "y": 72, "width": 128, "height": 144}},
    ]}]}
    ctx.job = spec({"datasetVersionId": DATASET, "modelVersionIds": [TRACKER], "params": params(task="track", predictions=[{"videoAssetId": "a1", "key": TRK_KEY}])})
    result = bench_stage.run_benchmark(ctx)
    by = {(m["metric"], m["slice"]): m["value"] for m in result.summary["metrics"]}
    assert by[("mota:player", "all")] == 1.0
    assert by[("idf1:player", "all")] == 1.0
    assert by[("idsw:player", "all")] == 0
    assert result.summary["task"] == "track"
    assert ctx.uploaded["payload"]["task"] == "track"


def test_refuses_a_track_artifact_from_another_tracker(ctx) -> None:
    ctx.objects[TRK_KEY] = {"trackerVersionId": "someone-else", "tracks": []}
    ctx.job = spec({"datasetVersionId": DATASET, "modelVersionIds": [TRACKER], "params": params(task="track", predictions=[{"videoAssetId": "a1", "key": TRK_KEY}])})
    with pytest.raises(StageRefusal, match="track artifact .* produced by model version 'someone-else'"):
        bench_stage.run_benchmark(ctx)


def test_refuses_an_unknown_task(ctx) -> None:
    ctx.job = spec({"datasetVersionId": DATASET, "modelVersionIds": [MODEL], "params": params(task="calibrate")})
    with pytest.raises(StageRefusal, match="cannot score task"):
        bench_stage.run_benchmark(ctx)
