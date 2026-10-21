"""The real trainer, end to end on four tiny frames (docs/vision/102).

Skipped where torch is not installed (the CPU image and the plain test run); it runs in
the GPU image, on CPU if there is no card. It checks the plumbing, not the learning: a
fresh head for the contract's classes, a negative frame accepted, one epoch's loss,
weights that load back into the same architecture, and val predictions per frame.
"""

from __future__ import annotations

from pathlib import Path

import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("torchvision")

from dtp_vision_worker import trainer  # noqa: E402
from dtp_vision_worker.train_data import Item  # noqa: E402

CLASSES = ["player", "goalkeeper", "referee", "ball"]


def frame(path: Path, ball: tuple[int, int] | None) -> Path:
    from torchvision.io import write_jpeg

    image = torch.full((3, 96, 128), 60, dtype=torch.uint8)
    image[1] = 140  # grass
    if ball:
        x, y = ball
        image[:, y : y + 8, x : x + 8] = 250
    write_jpeg(image, str(path))
    return path


def test_one_epoch_on_four_frames(tmp_path: Path) -> None:
    items = [
        Item("a", 1, frame(tmp_path / "a1.jpg", (20, 30)), ((20.0, 30.0, 28.0, 38.0),), (4,)),
        Item("a", 2, frame(tmp_path / "a2.jpg", None), (), ()),  # a negative: looked, no ball
        Item("a", 3, frame(tmp_path / "a3.jpg", (90, 50)), ((90.0, 50.0, 98.0, 58.0),), (4,)),
    ]
    val = [Item("b", 7, frame(tmp_path / "b7.jpg", (60, 40)), ((60.0, 40.0, 68.0, 48.0),), (4,))]
    result = trainer.fit(items, val, CLASSES, epochs=1, batch_size=2, learning_rate=0.005, seed=3,
                         min_size=96, max_size=128, out_dir=tmp_path / "out")

    assert result.weights.is_file()
    assert len(result.epoch_losses) == 1 and result.epoch_losses[0] > 0
    assert set(result.predictions) == {"b"} and set(result.predictions["b"]) == {7}
    for p in result.predictions["b"][7]:
        assert p.cls in CLASSES and 0 <= p.confidence <= 1

    model, _ = trainer.build_model(len(CLASSES), 96, 128)
    model.load_state_dict(torch.load(result.weights, map_location="cpu", weights_only=True))
    assert model.roi_heads.box_predictor.cls_score.out_features == len(CLASSES) + 1


def test_detect_loads_what_train_wrote(tmp_path: Path) -> None:
    """The round trip of docs/vision/103: train's weights, through detect's real loader."""
    from dtp_vision_worker.media import sha256_file
    from dtp_vision_worker.stages import detect

    items = [Item("a", 1, frame(tmp_path / "a1.jpg", (20, 30)), ((20.0, 30.0, 28.0, 38.0),), (4,)),
             Item("a", 2, frame(tmp_path / "a2.jpg", (70, 40)), ((70.0, 40.0, 78.0, 48.0),), (4,))]
    result = trainer.fit(items, items[:1], CLASSES, epochs=1, batch_size=2, learning_rate=0.005, seed=5,
                         min_size=96, max_size=128, out_dir=tmp_path / "out")
    weights = detect.TrainedWeights(result.weights, sha256_file(result.weights), detect.TRAINED_CLASSES, 96, 128)
    run = detect._torchvision_detector(trained=weights)
    assert run.weights_sha256 == weights.sha256
    frames = run([tmp_path / "a1.jpg", tmp_path / "a2.jpg"])
    assert len(frames) == 2
    for found in frames:
        for d in found:
            assert d["label"] in detect.TRAINED_CLASSES
            assert detect.to_prediction(d)["class"] == d["label"]
