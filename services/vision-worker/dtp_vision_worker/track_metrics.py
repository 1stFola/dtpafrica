"""Scoring tracks against gold tracks.

CLEAR's MOTA, identity switches and fragmentations, and IDF1, per class and
overall, per slice -- the metrics docs/vision/10 names for tracking. Pure
arithmetic over two JSON files, like `evaluate.py`, and tested against cases
worked out by hand.

Definitions, so the numbers mean what the paper means:

- A frame's predictions are matched one-to-one to its gold boxes of the same class
  by IoU at the threshold, with the optimal assignment (`assignment.hungarian`);
  a gold box kept by the same predicted track as last time is preferred, as CLEAR
  requires, so a momentary better overlap does not count as a switch.
- **ID switch**: a gold track is matched this frame to a different predicted track
  than the last time it was matched.
- **Fragmentation**: a gold track was matched, then unmatched for a while, then
  matched again -- a hole in its coverage, whoever covered it.
- **MOTA** = 1 - (misses + false positives + switches) / gold boxes.
- **IDF1**: with each gold track assigned to at most one predicted track (and the
  reverse) so that the number of frames on which the pair coincide is maximised,
  IDF1 = 2 * IDTP / (2 * IDTP + IDFP + IDFN).

Only frames the tracker's input covered are scored; see `evaluate.py` for why a
frame the detector never sampled is uncovered rather than missed.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from .assignment import INF, hungarian
from .evaluate import ALL, Box, GoldSample, Truth, iou


@dataclass(frozen=True)
class TrackedBox:
    track_id: str
    cls: str
    box: Box


@dataclass
class GoldTracks:
    asset_id: str
    slices: tuple[str, ...]
    #: 1-based proxy frame -> boxes with their gold track id (boxes without one are ignored here).
    frames: dict[int, list[TrackedBox]] = field(default_factory=dict)


def gold_tracks_from_export(samples: Sequence[dict[str, Any]]) -> list[GoldTracks]:
    """Gold tracks from the dataset export: boxes carrying `track_id`."""
    out: list[GoldTracks] = []
    for sample in samples:
        prov = sample.get("provenance") or {}
        slices: list[str] = []
        if prov.get("source_quality_rank"):
            slices.append(f"quality:{prov['source_quality_rank']}")
        if prov.get("competition"):
            slices.append(f"competition:{prov['competition']}")
        if prov.get("source_is_variable_frame_rate") is not None:
            slices.append(f"vfr:{'true' if prov['source_is_variable_frame_rate'] else 'false'}")
        gold = GoldTracks(asset_id=str(prov.get("video_asset_id") or ""), slices=tuple(slices))
        for frame_key, labels in (sample.get("frames") or {}).items():
            boxes = ((labels or {}).get("detections") or {}).get("detections") or []
            linked = [
                TrackedBox(track_id=str(b["track_id"]), cls=str(b["label"]), box=tuple(float(v) for v in b["bounding_box"]))  # type: ignore[arg-type]
                for b in boxes
                if b.get("track_id") not in (None, "")
            ]
            if linked:
                gold.frames[int(frame_key)] = linked
        out.append(gold)
    return out


def tracks_from_artifact(artifact: dict[str, Any], frame_width: float, frame_height: float) -> dict[int, list[TrackedBox]]:
    """Predicted tracks per 1-based proxy frame from a `tracks` artifact, normalised."""
    if frame_width <= 0 or frame_height <= 0:
        raise ValueError("a positive frame size is needed to normalise pixel boxes")
    out: dict[int, list[TrackedBox]] = defaultdict(list)
    for t in artifact.get("tracks") or []:
        tid = str(t["localTrackId"])
        cls = str(t["class"])
        for p in t.get("positions") or []:
            b = p["box"]
            out[int(p["frameIndex"]) + 1].append(
                TrackedBox(tid, cls, (float(b["x"]) / frame_width, float(b["y"]) / frame_height, float(b["width"]) / frame_width, float(b["height"]) / frame_height))
            )
    return dict(out)


@dataclass
class _Tally:
    gt: int = 0
    misses: int = 0
    fps: int = 0
    switches: int = 0
    frags: int = 0
    gold_tracks: set[str] = field(default_factory=set)
    #: (gold id, pred id) -> frames they coincided on, for IDF1. Ids here are
    #: `asset/track`: a local track id is only unique inside one artifact, and two
    #: assets' track 1 are two people.
    coincide: dict[tuple[str, str], int] = field(default_factory=dict)
    gold_frames: dict[str, int] = field(default_factory=dict)
    pred_frames: dict[str, int] = field(default_factory=dict)


def _match_frame(preds: list[TrackedBox], golds: list[TrackedBox], last: dict[str, str], threshold: float) -> list[tuple[int, int]]:
    """Optimal IoU matching within one class, preferring to keep last frame's pairing.

    The caller has already split both sides by class; this sees one class at a time.
    """
    if not preds or not golds:
        return []
    cost = []
    for g in golds:
        row = []
        for p in preds:
            overlap = iou(p.box, g.box)
            if overlap < threshold:
                row.append(INF)
                continue
            # Continuity bonus: the pair that held last frame is cheapest at equal overlap.
            row.append((1.0 - overlap) - (0.5 if last.get(g.track_id) == p.track_id else 0.0))
        cost.append(row)
    return hungarian(cost)


def score_tracks(
    gold: Iterable[GoldTracks],
    predictions: dict[str, dict[int, list[TrackedBox]]],
    classes: Sequence[str],
    threshold: float,
) -> dict[str, Any]:
    tallies: dict[tuple[str, str], _Tally] = defaultdict(_Tally)
    gold_samples = list(gold)
    frames_labelled = 0
    frames_scored = 0

    for sample in gold_samples:
        covered = predictions.get(sample.asset_id)
        # Per (slice, class): the predicted id each gold track last matched, and whether it is currently matched.
        last: dict[tuple[str, str], dict[str, str]] = defaultdict(dict)
        active: dict[tuple[str, str], set[str]] = defaultdict(set)
        asset = sample.asset_id

        def gid(track_id: str, asset: str = asset) -> str:
            return f"{asset}/{track_id}"

        for frame_number in sorted(sample.frames):
            golds_all = sample.frames[frame_number]
            frames_labelled += 1
            if covered is None:
                continue
            frames_scored += 1
            preds_all = covered.get(frame_number, [])
            for slice_name in (ALL, *sample.slices):
                for cls in classes:
                    key = (slice_name, cls)
                    tally = tallies[key]
                    golds = [g for g in golds_all if g.cls == cls]
                    preds = [p for p in preds_all if p.cls == cls]
                    for g in golds:
                        tally.gold_tracks.add(gid(g.track_id))
                        tally.gold_frames[gid(g.track_id)] = tally.gold_frames.get(gid(g.track_id), 0) + 1
                    for p in preds:
                        tally.pred_frames[gid(p.track_id)] = tally.pred_frames.get(gid(p.track_id), 0) + 1
                    tally.gt += len(golds)
                    pairs = _match_frame(preds, golds, last[key], threshold)
                    matched_g = set()
                    for gi, pi in pairs:
                        g, p = golds[gi], preds[pi]
                        matched_g.add(g.track_id)
                        previous = last[key].get(g.track_id)
                        if previous is not None and previous != p.track_id:
                            tally.switches += 1
                        if previous is not None and g.track_id not in active[key]:
                            tally.frags += 1
                        last[key][g.track_id] = p.track_id
                        active[key].add(g.track_id)
                        pair = (gid(g.track_id), gid(p.track_id))
                        tally.coincide[pair] = tally.coincide.get(pair, 0) + 1
                    tally.misses += len(golds) - len(pairs)
                    tally.fps += len(preds) - len(pairs)
                    for g in golds:
                        if g.track_id not in matched_g:
                            active[key].discard(g.track_id)

    slices = sorted({ALL, *(s for sample in gold_samples for s in sample.slices)} | {s for s, _ in tallies}, key=lambda s: (s != ALL, s))
    metrics: list[dict[str, Any]] = []
    for slice_name in slices:
        total = _Tally()
        for cls in [*classes, ALL]:
            if cls == ALL:
                tally = total
            else:
                tally = tallies.get((slice_name, cls), _Tally())
                total.gt += tally.gt
                total.misses += tally.misses
                total.fps += tally.fps
                total.switches += tally.switches
                total.frags += tally.frags
                total.gold_tracks |= {f"{cls}:{t}" for t in tally.gold_tracks}
                for k, v in tally.coincide.items():
                    total.coincide[(f"{cls}:{k[0]}", f"{cls}:{k[1]}")] = v
                for k, v in tally.gold_frames.items():
                    total.gold_frames[f"{cls}:{k}"] = v
                for k, v in tally.pred_frames.items():
                    total.pred_frames[f"{cls}:{k}"] = v
            mota = None if tally.gt == 0 else 1.0 - (tally.misses + tally.fps + tally.switches) / tally.gt
            idf1 = _idf1(tally)
            support = tally.gt
            metrics.extend(
                [
                    {"metric": f"mota:{cls}", "slice": slice_name, "value": mota, "support": support},
                    {"metric": f"idf1:{cls}", "slice": slice_name, "value": idf1, "support": support},
                    {"metric": f"idsw:{cls}", "slice": slice_name, "value": float(tally.switches) if tally.gt else None, "support": support},
                    {"metric": f"frag:{cls}", "slice": slice_name, "value": float(tally.frags) if tally.gt else None, "support": support},
                    {"metric": f"tracks:{cls}", "slice": slice_name, "value": float(len(tally.gold_tracks)), "support": support},
                ]
            )

    return {
        "iou": threshold,
        "classes": list(classes),
        "assets": len(gold_samples),
        "framesLabelled": frames_labelled,
        "framesScored": frames_scored,
        "metrics": metrics,
    }


def _idf1(tally: _Tally) -> float | None:
    """Identity F1 under the optimal gold-id to predicted-id assignment."""
    gold_total = sum(tally.gold_frames.values())
    pred_total = sum(tally.pred_frames.values())
    if gold_total == 0:
        return None
    golds = sorted(tally.gold_frames)
    preds = sorted(tally.pred_frames)
    if not preds:
        return 0.0
    cost = [[-(tally.coincide.get((g, p), 0)) for p in preds] for g in golds]
    pairs = hungarian(cost)
    idtp = sum(tally.coincide.get((golds[gi], preds[pi]), 0) for gi, pi in pairs)
    idfn = gold_total - idtp
    idfp = pred_total - idtp
    return 2 * idtp / (2 * idtp + idfn + idfp) if (2 * idtp + idfn + idfp) else 0.0
