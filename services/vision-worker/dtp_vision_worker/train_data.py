"""Frames and boxes for training, read from a dataset's FiftyOne export (docs/vision/102).

No torch here, so the CPU image and the plain test run can check what a run would
learn from without the model stack.

A labelled frame is any frame inside a label window (`annotations.detections[].support`,
1-based and inclusive), with or without boxes: a person who looked and drew no ball box
said "no ball here", and that frame is a negative the model needs. Boxes come from
`frames[n].detections`, normalised with a top-left origin.

A frame with an uncertain box, or under a window marked uncertain, is left out: an
unsure label is neither a positive nor a negative, and it is counted rather than hidden.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence


class ExportMismatch(ValueError):
    """The export disagrees with what the control plane asked to train on."""


@dataclass(frozen=True)
class TrainBox:
    cls: str
    x: float
    y: float
    width: float
    height: float


@dataclass
class TrainFrame:
    asset_id: str
    split: str
    #: 1-based proxy frame, as the export numbers it.
    frame_number: int
    boxes: list[TrainBox] = field(default_factory=list)


@dataclass(frozen=True)
class Item:
    """One decoded frame for the trainer: its JPEG, pixel boxes `[x1, y1, x2, y2]`, and 1-based class ids."""

    asset_id: str
    frame_number: int
    image: Path
    boxes: tuple[tuple[float, float, float, float], ...]
    labels: tuple[int, ...]


@dataclass
class TrainSet:
    frames: list[TrainFrame]
    skipped_uncertain: int
    #: Assets present in the export that the job did not ask for (gold, test): not read.
    ignored_assets: int

    def split(self, name: str) -> list[TrainFrame]:
        return [f for f in self.frames if f.split == name]

    def box_counts(self, name: str) -> dict[str, int]:
        return dict(Counter(b.cls for f in self.split(name) for b in f.boxes))


def _box(raw: dict[str, Any], classes: Sequence[str]) -> TrainBox:
    label = raw.get("label")
    if label not in classes:
        raise ExportMismatch(f"export box label {label!r} is not one of {list(classes)}")
    bb = raw.get("bounding_box")
    if not isinstance(bb, list) or len(bb) != 4 or not all(isinstance(v, (int, float)) for v in bb):
        raise ExportMismatch(f"export box has no [x, y, w, h] bounding_box: {bb!r}")
    x, y, w, h = (float(v) for v in bb)
    if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > 1.0001 or y + h > 1.0001:
        raise ExportMismatch(f"export box {bb!r} is not a box inside the frame")
    return TrainBox(str(label), x, y, w, h)


def frames_from_export(samples: Iterable[dict[str, Any]], members: dict[str, str], classes: Sequence[str]) -> TrainSet:
    """The labelled frames of the members the job names, each tagged with its split.

    `members` maps asset id to `train` or `val`, as the control plane listed them. A
    member whose sample is missing, or whose sample is tagged with another split, means
    the export is not the one the run was asked for, and nothing is trained.
    """
    frames: list[TrainFrame] = []
    skipped = 0
    ignored = 0
    seen: set[str] = set()
    for sample in samples:
        asset_id = str((sample.get("provenance") or {}).get("video_asset_id") or "")
        split = members.get(asset_id)
        if split is None:
            ignored += 1
            continue
        tags = sample.get("tags") or []
        if split not in tags:
            raise ExportMismatch(f"asset {asset_id} is listed as {split} but the export tags it {tags!r}")
        seen.add(asset_id)

        labelled: set[int] = set()
        unsure: set[int] = set()
        for window in ((sample.get("annotations") or {}).get("detections") or []):
            support = window.get("support")
            if not (isinstance(support, list) and len(support) == 2 and all(isinstance(v, int) for v in support) and 1 <= support[0] <= support[1]):
                raise ExportMismatch(f"asset {asset_id} has a label window with no valid support: {support!r}")
            span = range(support[0], support[1] + 1)
            labelled.update(span)
            if window.get("uncertain") is True:
                unsure.update(span)

        boxes: dict[int, list[TrainBox]] = {}
        for key, frame in (sample.get("frames") or {}).items():
            number = int(key)
            for raw in (((frame or {}).get("detections") or {}).get("detections") or []):
                if raw.get("uncertain") is True:
                    unsure.add(number)
                    continue
                boxes.setdefault(number, []).append(_box(raw, classes))
            if number not in labelled:
                raise ExportMismatch(f"asset {asset_id} frame {number} has boxes outside every label window")

        for number in sorted(labelled):
            if number in unsure:
                skipped += 1
                continue
            frames.append(TrainFrame(asset_id, split, number, boxes.get(number, [])))

    missing = sorted(set(members) - seen)
    if missing:
        raise ExportMismatch(f"{len(missing)} listed member(s) are not in the export: {', '.join(missing[:5])}")
    return TrainSet(frames=frames, skipped_uncertain=skipped, ignored_assets=ignored)
