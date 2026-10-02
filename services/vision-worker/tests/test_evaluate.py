"""The scoring arithmetic, against cases worked out by hand.

A metric tested only against itself proves nothing, so every number below was
computed on paper first and the code is held to it. The cases are small on purpose:
two boxes and one prediction is enough to tell greedy matching from generous
matching, and all-point AP from an eleven-point one.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from dtp_vision_worker.evaluate import (
    ALL,
    GoldSample,
    Prediction,
    Truth,
    average_precision,
    evaluate,
    gold_from_export,
    iou,
    main,
    match_frame,
    predictions_from_artifact,
)

CLASSES = ["player", "goalkeeper", "referee", "ball"]


def metric(report: dict, name: str, slice_name: str = ALL) -> float | None:
    for m in report["metrics"]:
        if m["metric"] == name and m["slice"] == slice_name:
            return m["value"]
    raise KeyError(f"{name} on {slice_name}")


# ── IoU ───────────────────────────────────────────────────────────────────────


def test_iou_of_identical_boxes_is_one() -> None:
    assert iou((0.1, 0.1, 0.2, 0.2), (0.1, 0.1, 0.2, 0.2)) == pytest.approx(1.0)


def test_iou_of_disjoint_boxes_is_zero() -> None:
    assert iou((0.0, 0.0, 0.1, 0.1), (0.5, 0.5, 0.1, 0.1)) == 0.0


def test_iou_by_hand() -> None:
    # A: [0,0]-[2,2] area 4. B: [1,1]-[3,3] area 4. Intersection [1,1]-[2,2] = 1.
    # Union 4 + 4 - 1 = 7. IoU 1/7.
    assert iou((0, 0, 2, 2), (1, 1, 2, 2)) == pytest.approx(1 / 7)


def test_iou_of_an_empty_box_is_zero() -> None:
    assert iou((0, 0, 0, 2), (0, 0, 2, 2)) == 0.0


# ── Matching ─────────────────────────────────────────────────────────────────

PLAYER = Truth("player", (0.1, 0.1, 0.1, 0.2))
BALL = Truth("ball", (0.5, 0.5, 0.02, 0.03))


def test_a_confident_overlapping_prediction_matches() -> None:
    pred = Prediction("player", 0.9, (0.1, 0.1, 0.1, 0.2))
    assert match_frame([pred], [PLAYER], 0.5) == [(pred, True)]


def test_class_must_agree_however_well_the_boxes_overlap() -> None:
    pred = Prediction("ball", 0.9, (0.1, 0.1, 0.1, 0.2))
    assert match_frame([pred], [PLAYER], 0.5) == [(pred, False)]


def test_two_boxes_on_one_player_is_one_hit_and_one_false_positive() -> None:
    """Greedy by confidence: the more confident takes the truth, the other is told so."""
    strong = Prediction("player", 0.9, (0.1, 0.1, 0.1, 0.2))
    weak = Prediction("player", 0.6, (0.11, 0.1, 0.1, 0.2))
    assert match_frame([weak, strong], [PLAYER], 0.5) == [(strong, True), (weak, False)]


def test_below_the_threshold_is_a_miss() -> None:
    # Shifted by half its width: IoU = 0.5*0.2 / (0.02+0.02-0.01) = 0.01/0.03 = 1/3.
    pred = Prediction("player", 0.9, (0.15, 0.1, 0.1, 0.2))
    assert match_frame([pred], [PLAYER], 0.5) == [(pred, False)]
    assert match_frame([pred], [PLAYER], 0.3) == [(pred, True)]


# ── Average precision ────────────────────────────────────────────────────────


def test_ap_is_undefined_with_nothing_to_find() -> None:
    assert average_precision([], 0) is None
    assert average_precision([(0.9, False)], 0) is None


def test_ap_is_zero_when_nothing_was_found() -> None:
    assert average_precision([], 3) == 0.0
    assert average_precision([(0.9, False), (0.8, False)], 3) == 0.0


def test_ap_by_hand() -> None:
    """Three truths. Ranked: hit, miss, hit. Recall steps 1/3 at p=1, then 2/3 at p=2/3.

    Area = (1/3 - 0) * 1 + (2/3 - 1/3) * (2/3) = 1/3 + 2/9 = 5/9.
    The monotone envelope does not change anything here: precision after the second
    hit (2/3) is already at or below the first (1).
    """
    hits = [(0.9, True), (0.8, False), (0.7, True)]
    assert average_precision(hits, 3) == pytest.approx(5 / 9)


def test_ap_uses_the_monotone_envelope() -> None:
    """Ranked: miss, hit, hit over two truths. Raw precisions 0, 1/2, 2/3; recall 0, 1/2, 1.

    The envelope lifts precision at recall 1/2 to the best at any higher recall, 2/3.
    Area = (1/2) * 2/3 + (1/2) * 2/3 = 2/3. Without the envelope it would be 1/4 + 1/3.
    """
    hits = [(0.9, False), (0.8, True), (0.7, True)]
    assert average_precision(hits, 2) == pytest.approx(2 / 3)


def test_ap_is_ranked_by_confidence_not_by_list_order() -> None:
    hits = [(0.7, True), (0.8, False), (0.9, True)]  # same multiset as the 5/9 case
    assert average_precision(hits, 3) == pytest.approx(5 / 9)


# ── The whole report ─────────────────────────────────────────────────────────


def gold(asset: str = "a1", slices: tuple[str, ...] = ("quality:broadcast",)) -> GoldSample:
    g = GoldSample(asset_id=asset, slices=slices)
    g.frames[26] = [PLAYER, BALL]
    g.frames[38] = [PLAYER]
    return g


def test_scores_per_class_and_overall_by_hand() -> None:
    """Frame 26: player found, ball missed, one spurious player. Frame 38: player found.

    player: 2 truths, 2 hits, 1 false positive -> precision 2/3, recall 1, f1 0.8.
    ball:   1 truth, nothing predicted           -> precision None, recall 0, ap 0.
    all:    3 truths, tp 2, fp 1                 -> precision 2/3, recall 2/3, f1 2/3.
    ap:all is the mean over classes with truths: player AP 1 (hits ranked .9 hit, .8 hit,
    .4 miss -> recall reaches 1 at precision 1), ball AP 0 -> 0.5.
    """
    preds = {
        "a1": {
            26: [
                Prediction("player", 0.9, PLAYER.box),
                Prediction("player", 0.4, (0.7, 0.7, 0.1, 0.2)),
            ],
            38: [Prediction("player", 0.8, PLAYER.box)],
        }
    }
    report = evaluate([gold()], preds, CLASSES, 0.5)
    assert metric(report, "precision:player") == pytest.approx(2 / 3)
    assert metric(report, "recall:player") == 1.0
    assert metric(report, "f1:player") == pytest.approx(0.8)
    assert metric(report, "ap:player") == pytest.approx(1.0)
    assert metric(report, "precision:ball") is None
    assert metric(report, "recall:ball") == 0.0
    assert metric(report, "ap:ball") == 0.0
    assert metric(report, "recall:goalkeeper") is None
    assert metric(report, "precision:all") == pytest.approx(2 / 3)
    assert metric(report, "recall:all") == pytest.approx(2 / 3)
    assert metric(report, "ap:all") == pytest.approx(0.5)
    assert metric(report, "boxes:all") == 3.0


def test_every_metric_is_reported_on_the_sample_slices_too() -> None:
    preds = {"a1": {26: [Prediction("player", 0.9, PLAYER.box)], 38: []}}
    report = evaluate([gold()], preds, CLASSES, 0.5)
    assert metric(report, "recall:player", "quality:broadcast") == 0.5
    assert metric(report, "recall:player", ALL) == 0.5
    slices = {m["slice"] for m in report["metrics"]}
    assert slices == {ALL, "quality:broadcast"}


def test_slices_are_kept_apart() -> None:
    """A perfect result on broadcast footage must not hide a miss on a platform copy."""
    good = gold("a1", ("quality:broadcast",))
    bad = gold("a2", ("quality:platform_copy",))
    preds = {
        "a1": {26: [Prediction("player", 0.9, PLAYER.box), Prediction("ball", 0.9, BALL.box)], 38: [Prediction("player", 0.9, PLAYER.box)]},
        "a2": {26: [], 38: []},
    }
    report = evaluate([good, bad], preds, CLASSES, 0.5)
    assert metric(report, "recall:all", "quality:broadcast") == 1.0
    assert metric(report, "recall:all", "quality:platform_copy") == 0.0
    assert metric(report, "recall:all", ALL) == 0.5


def test_an_unsampled_frame_is_uncovered_not_a_miss() -> None:
    """A box on a frame the detector never looked at measures the sampling, not the model."""
    preds = {"a1": {26: [Prediction("player", 0.9, PLAYER.box), Prediction("ball", 0.9, BALL.box)]}}
    report = evaluate([gold()], preds, CLASSES, 0.5)
    assert report["framesLabelled"] == 2
    assert report["framesScored"] == 1
    assert metric(report, "recall:player") == 1.0  # frame 38 was not scored


def test_a_sampled_frame_with_nothing_found_is_scored() -> None:
    preds = {"a1": {26: [], 38: []}}
    report = evaluate([gold()], preds, CLASSES, 0.5)
    assert report["framesScored"] == 2
    assert metric(report, "recall:all") == 0.0


def test_an_asset_with_no_predictions_at_all_is_uncovered() -> None:
    report = evaluate([gold()], {}, CLASSES, 0.5)
    assert report["framesScored"] == 0
    assert metric(report, "recall:all") is None
    assert report["assets"] == 1


def test_support_is_the_number_of_truths() -> None:
    preds = {"a1": {26: [], 38: []}}
    report = evaluate([gold()], preds, CLASSES, 0.5)
    by = {(m["metric"], m["slice"]): m["support"] for m in report["metrics"]}
    assert by[("recall:player", ALL)] == 2
    assert by[("recall:ball", ALL)] == 1
    assert by[("recall:all", ALL)] == 3


# ── Reading the two files ────────────────────────────────────────────────────


def export_sample(asset: str = "a1") -> dict:
    return {
        "filepath": f"proxies/{asset}/proxy.mp4",
        "metadata": {"frame_width": 1280, "frame_height": 720, "frame_rate": 25},
        "frames": {
            "26": {"detections": {"_cls": "Detections", "detections": [
                {"_cls": "Detection", "label": "player", "bounding_box": [0.1, 0.1, 0.1, 0.2]},
                {"_cls": "Detection", "label": "ball", "bounding_box": [0.5, 0.5, 0.02, 0.03]},
            ]}},
        },
        "provenance": {
            "video_asset_id": asset,
            "source_quality_rank": "broadcast",
            "competition": "Lagos League",
            "source_is_variable_frame_rate": False,
        },
    }


def test_gold_is_read_from_the_export_with_its_slices() -> None:
    [g] = gold_from_export([export_sample()])
    assert g.asset_id == "a1"
    assert g.slices == ("quality:broadcast", "competition:Lagos League", "vfr:false")
    assert g.frames[26] == [Truth("player", (0.1, 0.1, 0.1, 0.2)), Truth("ball", (0.5, 0.5, 0.02, 0.03))]


def test_a_phase_2_sample_has_no_frames() -> None:
    sample = export_sample()
    sample["frames"] = {}
    [g] = gold_from_export([sample])
    assert g.frames == {}


def test_predictions_are_normalised_and_renumbered_from_one() -> None:
    """The detect artifact is pixels and 0-based; the gold export is normalised and 1-based."""
    artifact = {
        "frames": [
            {"frameIndex": 25, "detections": [
                {"class": "player", "confidence": 0.9, "box": {"x": 128, "y": 72, "width": 128, "height": 144}},
            ]},
        ]
    }
    preds = predictions_from_artifact(artifact, 1280, 720)
    assert list(preds) == [26]
    assert preds[26] == [Prediction("player", 0.9, (0.1, 0.1, 0.1, 0.2))]


def test_predictions_refuse_a_missing_frame_size() -> None:
    with pytest.raises(ValueError, match="frame size"):
        predictions_from_artifact({"frames": []}, 0, 720)


def test_the_cli_runs_the_same_arithmetic_on_files(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    gold_path = tmp_path / "samples.json"
    gold_path.write_text(json.dumps({"samples": [export_sample()]}), encoding="utf-8")
    det_path = tmp_path / "det.json"
    det_path.write_text(json.dumps({"frames": [{"frameIndex": 25, "detections": [
        {"class": "player", "confidence": 0.9, "box": {"x": 128, "y": 72, "width": 128, "height": 144}},
    ]}]}), encoding="utf-8")
    assert main(["--gold", str(gold_path), "--detections", f"a1={det_path}"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert metric(report, "recall:player") == 1.0
    assert metric(report, "recall:ball") == 0.0
    assert report["framesScored"] == 1
