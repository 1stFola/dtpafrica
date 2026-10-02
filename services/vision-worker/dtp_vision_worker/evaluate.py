"""Scoring detections against boxes.

Pure arithmetic, no torch, no FFmpeg: a benchmark compares what a model wrote with
what a reviewer approved, and both are JSON. It is a module of its own so the
numbers can be tested against cases worked out by hand -- a metric tested only
against itself proves nothing -- and so the `benchmark` stage and a laptop can run
the same code on the same files.

Three decisions, each written here because each produces a plausible wrong number
if made the other way:

- **Matching is greedy by confidence, one truth per prediction, one prediction per
  truth.** A second prediction on an already-matched box is a false positive, which
  is how a detector that draws two boxes round one player is told so.
- **Average precision is the all-point interpolated area** under the precision-recall
  curve ranked by confidence, per class. No 11-point sampling, no smoothing beyond
  the monotone envelope.
- **Only frames the detector sampled are scored.** A box on a frame the detect
  artifact never looked at is not a miss; it is uncovered, and reported as such in
  `framesScored / framesLabelled`. Counting it as a miss would measure the sampling
  rate rather than the model.

See docs/vision/10-EVALUATION-AND-GATES.md.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

#: The slice every number is also reported under.
ALL = "all"

Box = tuple[float, float, float, float]  # x, y, width, height, normalised


@dataclass(frozen=True)
class Truth:
    cls: str
    box: Box


@dataclass(frozen=True)
class Prediction:
    cls: str
    confidence: float
    box: Box


@dataclass
class GoldSample:
    """One gold member: its slices, and its boxes per 1-based proxy frame."""

    asset_id: str
    slices: tuple[str, ...]
    frames: dict[int, list[Truth]] = field(default_factory=dict)


@dataclass
class Metric:
    metric: str
    slice: str
    value: float | None
    support: int

    def as_dict(self) -> dict[str, Any]:
        return {"metric": self.metric, "slice": self.slice, "value": self.value, "support": self.support}


def iou(a: Box, b: Box) -> float:
    """Intersection over union of two `[x, y, w, h]` boxes. Zero when either is empty."""
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    if aw <= 0 or ah <= 0 or bw <= 0 or bh <= 0:
        return 0.0
    ix = max(0.0, min(ax1 + aw, bx1 + bw) - max(ax1, bx1))
    iy = max(0.0, min(ay1 + ah, by1 + bh) - max(ay1, by1))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def match_frame(
    predictions: Sequence[Prediction], truths: Sequence[Truth], threshold: float
) -> list[tuple[Prediction, bool]]:
    """Each prediction, in confidence order, with whether it matched an unclaimed truth.

    Class-aware: a `player` box never matches a `ball` truth, however well it overlaps.
    Greedy by confidence, so the most confident of two boxes on one player takes the
    truth and the other is a false positive -- which is the honest account of a
    detector that draws two.
    """
    ordered = sorted(predictions, key=lambda p: -p.confidence)
    claimed: set[int] = set()
    out: list[tuple[Prediction, bool]] = []
    for pred in ordered:
        best, best_iou = None, threshold
        for index, truth in enumerate(truths):
            if index in claimed or truth.cls != pred.cls:
                continue
            overlap = iou(pred.box, truth.box)
            if overlap >= best_iou:
                best, best_iou = index, overlap
        if best is None:
            out.append((pred, False))
        else:
            claimed.add(best)
            out.append((pred, True))
    return out


def average_precision(hits: Sequence[tuple[float, bool]], truths: int) -> float | None:
    """All-point interpolated AP from (confidence, hit) pairs over `truths` boxes.

    None when there is nothing to find: an AP over zero truths is not zero, it is
    undefined, and a zero would drag a mean down for a class absent from the slice.
    """
    if truths <= 0:
        return None
    if not hits:
        return 0.0
    ordered = sorted(hits, key=lambda h: -h[0])
    tp = 0
    fp = 0
    recalls: list[float] = []
    precisions: list[float] = []
    for _conf, hit in ordered:
        if hit:
            tp += 1
        else:
            fp += 1
        recalls.append(tp / truths)
        precisions.append(tp / (tp + fp))
    # Monotone envelope: precision at a recall level is the best precision at any
    # higher recall, then the area under the resulting staircase.
    for i in range(len(precisions) - 2, -1, -1):
        precisions[i] = max(precisions[i], precisions[i + 1])
    area = 0.0
    previous_recall = 0.0
    for r, p in zip(recalls, precisions, strict=True):
        area += (r - previous_recall) * p
        previous_recall = r
    return area


def _ratio(num: int, den: int) -> float | None:
    return None if den == 0 else num / den


def _f1(precision: float | None, recall: float | None) -> float | None:
    if precision is None or recall is None:
        return None
    return 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)


@dataclass
class _Tally:
    tp: int = 0
    fp: int = 0
    truths: int = 0
    hits: list[tuple[float, bool]] = field(default_factory=list)


def evaluate(
    gold: Iterable[GoldSample],
    predictions: dict[str, dict[int, list[Prediction]]],
    classes: Sequence[str],
    threshold: float,
) -> dict[str, Any]:
    """Score every gold frame the predictions covered, per class and per slice.

    `predictions` is keyed by asset id, then by 1-based proxy frame. A gold frame with
    no entry for its asset is uncovered and skipped; a frame the detector sampled and
    found nothing on is scored (its truths are misses). Every metric is reported
    under `all` and under each of the sample's slices.
    """
    tallies: dict[tuple[str, str], _Tally] = defaultdict(_Tally)  # (slice, class)
    frames_labelled = 0
    frames_scored = 0
    assets = 0
    gold_samples = list(gold)

    for sample in gold_samples:
        assets += 1
        covered = predictions.get(sample.asset_id)
        for frame_number, truths in sample.frames.items():
            frames_labelled += 1
            if covered is None or frame_number not in covered:
                continue
            frames_scored += 1
            preds = covered[frame_number]
            matched = match_frame(preds, truths, threshold)
            for slice_name in (ALL, *sample.slices):
                for cls in classes:
                    tally = tallies[(slice_name, cls)]
                    tally.truths += sum(1 for t in truths if t.cls == cls)
                    for pred, hit in matched:
                        if pred.cls != cls:
                            continue
                        tally.hits.append((pred.confidence, hit))
                        if hit:
                            tally.tp += 1
                        else:
                            tally.fp += 1

    # Every slice the gold set declares is reported, scored or not: a slice that
    # vanished from the report because nothing on it was sampled would read as
    # "no slice" rather than "not measured", and those are different findings.
    declared = {ALL, *(s for sample in gold_samples for s in sample.slices)}
    slices = sorted(declared | {s for s, _ in tallies}, key=lambda s: (s != ALL, s))
    metrics: list[Metric] = []
    for slice_name in slices:
        per_class_ap: list[float] = []
        total = _Tally()
        for cls in classes:
            tally = tallies.get((slice_name, cls), _Tally())
            precision = _ratio(tally.tp, tally.tp + tally.fp)
            recall = _ratio(tally.tp, tally.truths)
            ap = average_precision(tally.hits, tally.truths)
            if ap is not None:
                per_class_ap.append(ap)
            metrics.extend(
                [
                    Metric(f"precision:{cls}", slice_name, precision, tally.truths),
                    Metric(f"recall:{cls}", slice_name, recall, tally.truths),
                    Metric(f"f1:{cls}", slice_name, _f1(precision, recall), tally.truths),
                    Metric(f"ap:{cls}", slice_name, ap, tally.truths),
                    Metric(f"boxes:{cls}", slice_name, float(tally.truths), tally.truths),
                ]
            )
            total.tp += tally.tp
            total.fp += tally.fp
            total.truths += tally.truths
        precision = _ratio(total.tp, total.tp + total.fp)
        recall = _ratio(total.tp, total.truths)
        metrics.extend(
            [
                Metric(f"precision:{ALL}", slice_name, precision, total.truths),
                Metric(f"recall:{ALL}", slice_name, recall, total.truths),
                Metric(f"f1:{ALL}", slice_name, _f1(precision, recall), total.truths),
                # Mean of the per-class APs that exist. A class with no truths in the
                # slice is left out rather than counted as zero.
                Metric(
                    f"ap:{ALL}",
                    slice_name,
                    (sum(per_class_ap) / len(per_class_ap)) if per_class_ap else None,
                    total.truths,
                ),
                Metric(f"boxes:{ALL}", slice_name, float(total.truths), total.truths),
            ]
        )

    return {
        "iou": threshold,
        "classes": list(classes),
        "assets": assets,
        "framesLabelled": frames_labelled,
        "framesScored": frames_scored,
        "metrics": [m.as_dict() for m in metrics],
    }


# ── Reading the two file shapes ────────────────────────────────────────────


def gold_from_export(samples: Sequence[dict[str, Any]]) -> list[GoldSample]:
    """Gold samples from the dataset's FiftyOne export (`samples.json`).

    A sample's slices come from its provenance: source quality, competition, and
    whether the source was variable frame rate -- the axes a regression hides behind.
    Boxes are read from `frames[n].detections`, already normalised, already 1-based.
    """
    out: list[GoldSample] = []
    for sample in samples:
        prov = sample.get("provenance") or {}
        asset_id = str(prov.get("video_asset_id") or "")
        slices: list[str] = []
        if prov.get("source_quality_rank"):
            slices.append(f"quality:{prov['source_quality_rank']}")
        if prov.get("competition"):
            slices.append(f"competition:{prov['competition']}")
        if prov.get("source_is_variable_frame_rate") is not None:
            slices.append(f"vfr:{'true' if prov['source_is_variable_frame_rate'] else 'false'}")
        gold = GoldSample(asset_id=asset_id, slices=tuple(slices))
        for frame_key, labels in (sample.get("frames") or {}).items():
            boxes = ((labels or {}).get("detections") or {}).get("detections") or []
            truths = [
                Truth(cls=str(b["label"]), box=tuple(float(v) for v in b["bounding_box"]))  # type: ignore[arg-type]
                for b in boxes
            ]
            gold.frames[int(frame_key)] = truths
        out.append(gold)
    return out


def predictions_from_artifact(
    artifact: dict[str, Any], frame_width: float, frame_height: float
) -> dict[int, list[Prediction]]:
    """Predictions per 1-based proxy frame from a `detect` artifact.

    The artifact's boxes are proxy pixels and its `frameIndex` is 0-based; the gold
    export is normalised and 1-based. Both conversions happen here, once, with the
    frame size the gold export recorded for the proxy.
    """
    if frame_width <= 0 or frame_height <= 0:
        raise ValueError("a positive frame size is needed to normalise pixel boxes")
    out: dict[int, list[Prediction]] = {}
    for frame in artifact.get("frames") or []:
        number = int(frame["frameIndex"]) + 1
        preds: list[Prediction] = []
        for d in frame.get("detections") or []:
            box = d["box"]
            preds.append(
                Prediction(
                    cls=str(d["class"]),
                    confidence=float(d["confidence"]),
                    box=(
                        float(box["x"]) / frame_width,
                        float(box["y"]) / frame_height,
                        float(box["width"]) / frame_width,
                        float(box["height"]) / frame_height,
                    ),
                )
            )
        out[number] = preds
    return out


def main(argv: Sequence[str] | None = None) -> int:
    """`python -m dtp_vision_worker.evaluate --gold samples.json --detections <assetId>=<artifact.json> ... [--iou 0.5]`

    Prints the summary the `benchmark` stage would report. Exists so the same
    arithmetic can be run on files by hand, or by a gate, without a pod.
    """
    import argparse  # noqa: PLC0415

    parser = argparse.ArgumentParser(prog="dtp-vision-evaluate")
    parser.add_argument("--gold", required=True)
    parser.add_argument("--task", choices=["detect", "track"], default="detect")
    parser.add_argument("--detections", action="append", default=[], metavar="ASSET=PATH")
    parser.add_argument("--tracks", action="append", default=[], metavar="ASSET=PATH")
    parser.add_argument("--iou", type=float, default=0.5)
    parser.add_argument("--classes", default="player,goalkeeper,referee,ball")
    args = parser.parse_args(argv)

    with open(args.gold, encoding="utf-8") as handle:
        samples = json.load(handle)["samples"]
    sizes = {
        str((s.get("provenance") or {}).get("video_asset_id")): (
            (s.get("metadata") or {}).get("frame_width"),
            (s.get("metadata") or {}).get("frame_height"),
        )
        for s in samples
    }

    def size_of(asset_id: str) -> tuple[float, float]:
        width, height = sizes.get(asset_id, (None, None))
        if not width or not height:
            raise SystemExit(f"gold export records no frame size for asset {asset_id}")
        return float(width), float(height)

    if args.task == "track":
        from .track_metrics import gold_tracks_from_export, score_tracks, tracks_from_artifact  # noqa: PLC0415

        tracked: dict[str, dict[int, list[Any]]] = {}
        for spec in args.tracks:
            asset_id, _, path = spec.partition("=")
            with open(path, encoding="utf-8") as handle:
                tracked[asset_id] = tracks_from_artifact(json.load(handle), *size_of(asset_id))
        report = score_tracks(gold_tracks_from_export(samples), tracked, args.classes.split(","), args.iou)
    else:
        gold = gold_from_export(samples)
        predictions: dict[str, dict[int, list[Prediction]]] = {}
        for spec in args.detections:
            asset_id, _, path = spec.partition("=")
            with open(path, encoding="utf-8") as handle:
                predictions[asset_id] = predictions_from_artifact(json.load(handle), *size_of(asset_id))
        report = evaluate(gold, predictions, args.classes.split(","), args.iou)
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
