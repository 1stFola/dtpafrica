"""Linking detections across frames into tracks.

Pure arithmetic over a `detect` artifact, in the ByteTrack style: two rounds of
IoU association per frame, high-confidence boxes first and then the low-confidence
ones against whatever is still unmatched, so a player who dips below the detector's
confidence for a few frames is kept rather than cut. Implemented here rather than
imported, because every tracking repository in the licence register is still
"review required" and the algorithm itself is a page. It is a floor, like the
baseline detector: the benchmark against ByteTrack and BoT-SORT that the phase plan
asks for happens when their licences clear.

Three decisions a reader of the output needs to know:

- **A gap is a gap.** A track's positions are observations only. Nothing is
  interpolated across a miss and presented as seen; docs/vision/00 § Unknown beats
  wrong.
- **Class-aware.** A ball track never absorbs a player box, however well it
  overlaps. Association is within class.
- **A track that never reached the minimum hits is noise, and not written.** It is
  counted (`detectionsUnlinked`), so a detector that flickers is visible.

The association is the optimal assignment (`assignment.hungarian`) over IoU, as
ByteTrack's is: greedy best-first pairing is wrong exactly when two candidates are
both good for two tracks, which is the crossing-players case.

See docs/vision/32-PHASE-4-INCREMENT-1.md.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from .assignment import INF, hungarian

#: Detections sampled below this cannot be linked: a player moves too far between frames.
MIN_TRACK_SAMPLE_FPS = 10


@dataclass(frozen=True)
class Params:
    """The tracker's knobs. Recorded in every artifact: a tracker is these numbers."""

    #: Boxes at or above this are first-round candidates and may start a track.
    high_confidence: float = 0.5
    #: Boxes below this are ignored entirely.
    low_confidence: float = 0.1
    #: IoU needed in the first round, against the track's predicted box.
    match_iou: float = 0.3
    #: IoU needed in the second (low-confidence) round. Stricter: a weak box must be where the track already was.
    low_match_iou: float = 0.5
    #: Frames a track survives without a match before it ends.
    max_age: int = 30
    #: Matches before a track is confirmed and written.
    min_hits: int = 3

    def as_dict(self) -> dict[str, Any]:
        return {
            "highConfidence": self.high_confidence,
            "lowConfidence": self.low_confidence,
            "matchIou": self.match_iou,
            "lowMatchIou": self.low_match_iou,
            "maxAge": self.max_age,
            "minHits": self.min_hits,
        }


Box = tuple[float, float, float, float]  # x, y, w, h


@dataclass(frozen=True)
class Observation:
    frame: int
    proxy_ms: int
    source_ms: int
    cls: str
    confidence: float
    box: Box


@dataclass
class Track:
    local_id: int
    cls: str
    observations: list[Observation] = field(default_factory=list)
    misses: int = 0

    @property
    def hits(self) -> int:
        return len(self.observations)

    @property
    def last(self) -> Observation:
        return self.observations[-1]

    def predict(self, frame: int) -> Box:
        """Where the track should be at `frame`: constant velocity from the last two sightings."""
        if len(self.observations) < 2:
            return self.last.box
        a, b = self.observations[-2], self.observations[-1]
        span = max(1, b.frame - a.frame)
        ahead = frame - b.frame
        vx = (b.box[0] - a.box[0]) / span
        vy = (b.box[1] - a.box[1]) / span
        return (b.box[0] + vx * ahead, b.box[1] + vy * ahead, b.box[2], b.box[3])


def iou(a: Box, b: Box) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    if aw <= 0 or ah <= 0 or bw <= 0 or bh <= 0:
        return 0.0
    ix = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _associate(
    tracks: list[Track], detections: list[Observation], frame: int, threshold: float
) -> tuple[list[tuple[Track, Observation]], list[Track], list[Observation]]:
    """Optimal IoU matching within class. Returns matches, leftover tracks, leftover detections."""
    if not tracks or not detections:
        return [], list(tracks), list(detections)
    cost: list[list[float]] = []
    for track in tracks:
        predicted = track.predict(frame)
        row: list[float] = []
        for det in detections:
            overlap = iou(predicted, det.box) if det.cls == track.cls else 0.0
            row.append(1.0 - overlap if overlap >= threshold else INF)
        cost.append(row)
    assigned = hungarian(cost)
    used_t = {ti for ti, _ in assigned}
    used_d = {di for _, di in assigned}
    matches: list[tuple[Track, Observation]] = [(tracks[ti], detections[di]) for ti, di in assigned]
    rest_t = [t for i, t in enumerate(tracks) if i not in used_t]
    rest_d = [d for i, d in enumerate(detections) if i not in used_d]
    return matches, rest_t, rest_d


def track(frames: Sequence[dict[str, Any]], params: Params = Params()) -> tuple[list[Track], dict[str, Any]]:
    """Link the frames of a detect artifact into tracks.

    `frames` is the artifact's `frames` list, each with `frameIndex`, `proxyTimeMs`,
    `sourceTimeMs` and `detections` of `{class, confidence, box: {x, y, width, height}}`.
    Returns the confirmed tracks, in order of first appearance, and the counts.
    """
    active: list[Track] = []
    finished: list[Track] = []
    next_id = 1
    unlinked = 0
    linked = 0

    for raw in sorted(frames, key=lambda f: int(f["frameIndex"])):
        frame = int(raw["frameIndex"])
        obs: list[Observation] = []
        for d in raw.get("detections") or []:
            conf = float(d["confidence"])
            if conf < params.low_confidence:
                continue
            b = d["box"]
            obs.append(
                Observation(
                    frame=frame,
                    proxy_ms=int(raw["proxyTimeMs"]),
                    source_ms=int(raw["sourceTimeMs"]),
                    cls=str(d["class"]),
                    confidence=conf,
                    box=(float(b["x"]), float(b["y"]), float(b["width"]), float(b["height"])),
                )
            )
        high = [o for o in obs if o.confidence >= params.high_confidence]
        low = [o for o in obs if o.confidence < params.high_confidence]

        # Round one: confident boxes against every live track.
        matched, remaining, unmatched_high = _associate(active, high, frame, params.match_iou)
        # Round two: the weak boxes, only against tracks still unmatched, and only
        # where the track already was. This is what keeps a player through a dip in
        # confidence without letting a weak box start a track of its own.
        matched_low, remaining, _unmatched_low = _associate(remaining, low, frame, params.low_match_iou)

        for t, o in matched + matched_low:
            t.observations.append(o)
            t.misses = 0
            linked += 1
        for t in remaining:
            t.misses += 1

        for o in unmatched_high:
            active.append(Track(local_id=next_id, cls=o.cls, observations=[o]))
            next_id += 1
            linked += 1

        still: list[Track] = []
        for t in active:
            if t.misses > params.max_age:
                if t.hits >= params.min_hits:
                    finished.append(t)
                else:
                    unlinked += t.hits
                    linked -= t.hits
            else:
                still.append(t)
        active = still

    for t in active:
        if t.hits >= params.min_hits:
            finished.append(t)
        else:
            unlinked += t.hits
            linked -= t.hits

    finished.sort(key=lambda t: t.local_id)
    by_class: dict[str, int] = {}
    for t in finished:
        by_class[t.cls] = by_class.get(t.cls, 0) + 1
    lengths = [t.last.frame - t.observations[0].frame + 1 for t in finished]
    stats = {
        "tracks": len(finished),
        "tracksByClass": by_class,
        "framesTracked": len(frames),
        "detectionsLinked": linked,
        "detectionsUnlinked": unlinked,
        "meanTrackFrames": round(sum(lengths) / len(lengths), 1) if lengths else 0.0,
        "params": params.as_dict(),
    }
    return finished, stats


def record(t: Track) -> dict[str, Any]:
    """A track in the artifact's shape (`TrackRecord` in the contracts)."""
    first, last = t.observations[0], t.last
    return {
        "localTrackId": t.local_id,
        "class": t.cls,
        "startFrame": first.frame,
        "endFrame": last.frame,
        "startMs": first.source_ms,
        "endMs": last.source_ms,
        "detectionCount": t.hits,
        "confirmed": True,
        "positions": [
            {
                "frameIndex": o.frame,
                "proxyTimeMs": o.proxy_ms,
                "sourceTimeMs": o.source_ms,
                "box": {"x": o.box[0], "y": o.box[1], "width": o.box[2], "height": o.box[3]},
                "confidence": o.confidence,
            }
            for o in t.observations
        ],
    }


def summary_row(t: Track) -> dict[str, Any]:
    r = record(t)
    r.pop("positions")
    return r


def main(argv: Sequence[str] | None = None) -> int:
    """`python -m dtp_vision_worker.tracking --detections artifact.json [--out tracks.json]`

    The same linking the `track` stage does, on a file. Refuses an artifact sampled
    too sparsely to link, like the stage.
    """
    import argparse  # noqa: PLC0415

    parser = argparse.ArgumentParser(prog="dtp-vision-track")
    parser.add_argument("--detections", required=True)
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    with open(args.detections, encoding="utf-8") as handle:
        artifact = json.load(handle)
    fps = float(artifact.get("sampleFps") or 0)
    if fps < MIN_TRACK_SAMPLE_FPS:
        sys.stderr.write(f"detections sampled at {fps} fps; tracking needs at least {MIN_TRACK_SAMPLE_FPS}\n")
        return 2
    tracks, stats = track(artifact.get("frames") or [])
    out = {
        **{k: v for k, v in stats.items() if k != "tracks"},
        "trackCount": stats["tracks"],
        "tracks": [record(t) for t in tracks],
        "summaryRows": [summary_row(t) for t in tracks],
    }
    body = json.dumps(out, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(body)
    else:
        sys.stdout.write(body + "\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
