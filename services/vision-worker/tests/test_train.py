"""The train stage: which frames it learns from, what it refuses, and what it writes.

The fine-tune itself (torch) is injected, as detect injects its detector: what is under
test here is everything around it -- the frames read from the export, negatives kept,
uncertain frames left out, the checksum pin, the val scoring and the three artifacts.
`test_trainer_torch.py` runs the real trainer where torch is installed (the GPU image).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from dtp_vision_worker.config import CONTRACT_VERSION
from dtp_vision_worker.control_plane import JobSpec
from dtp_vision_worker.evaluate import Prediction
from dtp_vision_worker.runner import StageContext, StageRefusal
from dtp_vision_worker.stages import train as train_stage
from dtp_vision_worker.train_data import ExportMismatch, frames_from_export

CLASSES = ["player", "goalkeeper", "referee", "ball"]


def detection(label: str, box: list[float], **extra: Any) -> dict[str, Any]:
    return {"_cls": "Detection", "label": label, "bounding_box": box, **extra}


def sample(asset: str, split: str, windows: list[tuple[int, int, bool]], frames: dict[int, list[dict[str, Any]]]) -> dict[str, Any]:
    return {
        "filepath": f"proxies/{asset}.mp4",
        "tags": [split],
        "metadata": {"frame_width": 1280, "frame_height": 720, "frame_rate": 25},
        "provenance": {"video_asset_id": asset, "split": split},
        "annotations": {"_cls": "TemporalDetections", "detections": [
            {"_cls": "TemporalDetection", "support": [a, b], "uncertain": unsure} for a, b, unsure in windows]},
        "frames": {str(n): {"detections": {"_cls": "Detections", "detections": d}} for n, d in frames.items()},
    }


BALL = [0.5, 0.5, 0.01, 0.015]
PLAYER = [0.2, 0.3, 0.03, 0.1]
SAMPLES = [
    # Frame 10: ball and player. Frame 20: looked, nothing to box (a negative). Frame 30: an
    # uncertain ball, so left out. Frame 40: under an uncertain window, so left out.
    sample("a-train", "train", [(10, 10, False), (20, 20, False), (30, 30, False), (40, 40, True)],
           {10: [detection("ball", BALL), detection("player", PLAYER)], 30: [detection("ball", BALL, uncertain=True)], 40: [detection("player", PLAYER)]}),
    sample("b-val", "val", [(5, 5, False), (6, 6, False)], {5: [detection("ball", BALL)]}),
    sample("c-gold", "gold", [(1, 1, False)], {1: [detection("ball", BALL)]}),
]
MEMBERS = {"a-train": "train", "b-val": "val"}


class TestFramesFromExport:
    def test_keeps_negatives_skips_uncertain_and_ignores_unlisted(self) -> None:
        ts = frames_from_export(SAMPLES, MEMBERS, CLASSES)
        assert [(f.asset_id, f.frame_number, len(f.boxes)) for f in ts.frames] == [("a-train", 10, 2), ("a-train", 20, 0), ("b-val", 5, 1), ("b-val", 6, 0)]
        assert ts.skipped_uncertain == 2
        assert ts.ignored_assets == 1
        assert ts.box_counts("train") == {"ball": 1, "player": 1}

    def test_refuses_a_member_tagged_with_another_split(self) -> None:
        with pytest.raises(ExportMismatch, match="tags it"):
            frames_from_export(SAMPLES, {"a-train": "val", "b-val": "val"}, CLASSES)

    def test_refuses_a_member_missing_from_the_export(self) -> None:
        with pytest.raises(ExportMismatch, match="not in the export"):
            frames_from_export(SAMPLES, {**MEMBERS, "z-missing": "train"}, CLASSES)

    def test_refuses_a_label_outside_the_contract(self) -> None:
        bad = [sample("a-train", "train", [(1, 1, False)], {1: [detection("dog", BALL)]})]
        with pytest.raises(ExportMismatch, match="dog"):
            frames_from_export(bad, {"a-train": "train"}, CLASSES)

    def test_refuses_boxes_outside_every_window(self) -> None:
        bad = [sample("a-train", "train", [(1, 1, False)], {2: [detection("ball", BALL)]})]
        with pytest.raises(ExportMismatch, match="outside every label window"):
            frames_from_export(bad, {"a-train": "train"}, CLASSES)


EXPORT_BYTES = json.dumps({"samples": SAMPLES}).encode()
CHECKSUM = hashlib.sha256(EXPORT_BYTES).hexdigest()
HYPER = {"epochs": 2, "batchSize": 2, "learningRate": 0.01, "seed": 7, "minSize": 720, "maxSize": 1280}


def params(**over: Any) -> dict[str, Any]:
    base = {
        "version": train_stage.TRAIN_VERSION, "base": {"configKey": train_stage.BASE_CONFIG}, "classes": CLASSES,
        "export": {"key": "datasets/ds-1/export/samples.json", "checksum": CHECKSUM},
        "members": [{"videoAssetId": "a-train", "split": "train", "proxyKey": "proxies/a-train.mp4"},
                    {"videoAssetId": "b-val", "split": "val", "proxyKey": "proxies/b-val.mp4"}],
        "hyperparameters": HYPER,
    }
    return {**base, **over}


def spec(p: dict[str, Any], **inputs: Any) -> JobSpec:
    return JobSpec.from_payload({
        "contractVersion": CONTRACT_VERSION, "jobId": "job-train", "type": "train", "resourceClass": "gpu_24gb", "attemptNumber": 1,
        "inputs": {"datasetVersionId": "ds-1", "modelVersionIds": [], "params": p, **inputs},
        "outputPrefix": "inference/job-train/1/", "budget": {"maxRuntimeSeconds": 7200, "maxCostUsdCents": 300},
    })


class FakeClient:
    def __init__(self) -> None:
        self.asked: list[tuple[str, str | None]] = []
        self.outputs: list[str] = []

    def input_url(self, _job_id: str, role: str, key: str | None = None) -> str:
        self.asked.append((role, key))
        return f"https://storage.test/{key}"

    def presign_output(self, _job_id: str, key: str, _ct: str) -> str:
        self.outputs.append(key)
        return f"https://storage.test/put/{key}"


class FakeProgress:
    def set(self, stage: str, fraction: float | None = None) -> None:
        pass


@pytest.fixture
def run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    uploaded: dict[str, bytes] = {}

    def fake_download(_ctx: Any, url: str, target: Path) -> int:
        target.parent.mkdir(parents=True, exist_ok=True)
        body = EXPORT_BYTES if url.endswith("samples.json") else b"not-a-real-video"
        target.write_bytes(body)
        return len(body)

    def fake_upload(_ctx: Any, url: str, source: Path, _ct: str) -> int:
        uploaded[url.rsplit("/", 1)[-1]] = source.read_bytes()
        return source.stat().st_size

    def fake_extract(_proxy: Path, frames: list[Any], out_dir: Path) -> dict[Any, Any]:
        out_dir.mkdir(parents=True, exist_ok=True)
        return {(f.asset_id, f.frame_number): (out_dir / f"{f.asset_id}-{f.frame_number}.jpg", 1280, 720) for f in frames}

    monkeypatch.setattr(train_stage, "download", fake_download)
    monkeypatch.setattr(train_stage, "upload", fake_upload)
    monkeypatch.setattr(train_stage, "_extract", fake_extract)
    seen: dict[str, Any] = {}

    def perfect_fit(**kwargs: Any) -> SimpleNamespace:
        seen.update(kwargs)
        weights = tmp_path / "weights.pt"
        weights.write_bytes(b"weights")
        # Predict exactly the val truths: ball recall must come out at 1.0.
        preds = {"b-val": {5: [Prediction(cls="ball", confidence=0.9, box=tuple(BALL))], 6: []}}  # type: ignore[arg-type]
        return SimpleNamespace(weights=weights, epoch_losses=[1.2, 0.8], predictions=preds, gpu_seconds=42.0, device="cuda", base_weights_sha256="b" * 64)

    def go(job: JobSpec, fit: Any = perfect_fit, lose: set[tuple[str, int]] = frozenset()):
        if lose:
            monkeypatch.setattr(train_stage, "_extract", lambda p, frames, out: {k: v for k, v in fake_extract(p, frames, out).items() if k not in lose})
        client = FakeClient()
        ctx = StageContext(job=job, work_dir=tmp_path / "work", client=client, http=None, progress=FakeProgress())  # type: ignore[arg-type]
        (tmp_path / "work").mkdir(exist_ok=True)
        return train_stage.run_train(ctx, fit=fit), client, uploaded, seen

    return go


def _many(samples: Any, members: Any, classes: Any):
    """The real reader, padded with 120 more train negatives, so one lost frame stays under 1%."""
    from dtp_vision_worker.train_data import TrainFrame

    ts = frames_from_export(samples, members, classes)
    ts.frames.extend(TrainFrame("a-train", "train", n, []) for n in range(100, 220))
    return ts


class TestRunTrain:
    def test_trains_on_the_listed_splits_and_writes_three_artifacts(self, run) -> None:
        result, client, uploaded, seen = run(spec(params()))
        assert [i.frame_number for i in seen["train"]] == [10, 20]
        assert seen["train"][0].labels == (4, 1)  # ball then player, 1-based
        assert seen["train"][0].boxes[0] == pytest.approx((640.0, 360.0, 652.8, 370.8))
        assert seen["train"][1].boxes == ()  # the negative is kept, empty
        assert [i.frame_number for i in seen["val"]] == [5, 6]
        assert seen["epochs"] == 2 and seen["seed"] == 7
        assert client.outputs == ["inference/job-train/1/weights.pt", "inference/job-train/1/train-config.json", "inference/job-train/1/train-metrics.json"]
        assert all(a["bucket"] == "models" for a in result.artifacts)
        assert {a["role"] for a in result.artifacts} == {"weights", "train_config", "train_metrics"}
        assert result.model_version_ids == []
        assert result.gpu_seconds == 42.0
        s = result.summary
        assert s["weightsSha256"] == hashlib.sha256(b"weights").hexdigest()
        assert s["weightsKey"] == "inference/job-train/1/weights.pt"
        assert s["configKey"] == train_stage.TRAINED_DETECTOR_CONFIG
        assert s["frames"] == {"train": 2, "val": 2, "skippedUncertain": 2, "undecodable": 0}
        assert s["val"]["ballRecall"] == 1.0
        assert s["finalLoss"] == 0.8
        config = json.loads(uploaded["train-config.json"])
        assert config["labelIds"] == {"player": 1, "goalkeeper": 2, "referee": 3, "ball": 4}
        assert config["exportChecksum"] == CHECKSUM
        # It read only what it was given: the export and the two proxies.
        assert sorted(k for _r, k in client.asked) == ["datasets/ds-1/export/samples.json", "proxies/a-train.mp4", "proxies/b-val.mp4"]

    def test_drops_and_counts_a_frame_that_will_not_decode(self, run, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(train_stage, "frames_from_export", lambda s, m, c: _many(s, m, c))
        result, *_ = run(spec(params()), lose={("a-train", 20)})
        assert result.summary["frames"]["undecodable"] == 1
        assert result.summary["frames"]["train"] == 121  # 2 + 120 padded, less the lost one

    def test_refuses_when_many_frames_will_not_decode(self, run) -> None:
        with pytest.raises(StageRefusal, match="cannot be decoded"):
            run(spec(params()), lose={("a-train", 10), ("a-train", 20)})

    def test_refuses_an_export_whose_checksum_moved(self, run) -> None:
        with pytest.raises(StageRefusal, match="checksum differs"):
            run(spec(params(export={"key": "datasets/ds-1/export/samples.json", "checksum": "0" * 64})))

    def test_refuses_a_job_that_names_a_model_version(self, run) -> None:
        with pytest.raises(StageRefusal, match="must name none"):
            run(spec(params(), modelVersionIds=["mv-1"]))

    def test_refuses_without_labelled_val_frames(self, run) -> None:
        members = [{"videoAssetId": "a-train", "split": "train", "proxyKey": "proxies/a-train.mp4"}]
        with pytest.raises(StageRefusal, match="both splits"):
            run(spec(params(members=members)))

    @pytest.mark.parametrize("field,value", [("epochs", 0), ("epochs", 2.5), ("learningRate", 1.0), ("batchSize", True)])
    def test_refuses_hyperparameters_out_of_bounds(self, run, field: str, value: Any) -> None:
        with pytest.raises(StageRefusal, match=field):
            run(spec(params(hyperparameters={**HYPER, field: value})))

    def test_refuses_another_base_detector(self, run) -> None:
        with pytest.raises(StageRefusal, match="fine-tunes"):
            run(spec(params(base={"configKey": "builtin/other"})))
