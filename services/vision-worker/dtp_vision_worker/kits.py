"""Which side a track is on, from the colour of its kit.

The first step of identity in docs/vision/09 § Tracking and identity: team
assignment from kit appearance, *clustered per match rather than globally*,
because kit colours repeat across competitions, and with goalkeepers handled
separately, because their kit is deliberately different and would cluster on its
own. Pure arithmetic over a few decoded frames per track; no model, no numpy, so
it runs on the CPU image as it is.

What a kit is here: a 14-bin colour histogram of the torso region of a track's box
-- twelve hue bins for saturated pixels, and two for the achromatic ones (dark and
light), because a white kit and a black kit are real and have no hue. Averaged over
up to a handful of frames spread across the track, so one frame of motion blur or a
referee crossing in front does not decide the colour.

Two clusters by k-medoids with a deterministic start (the two most different kits).
Medoids rather than means on purpose: a centre is always a real kit, so one track in
a third colour -- a bib, a mislabelled referee -- cannot drag a side's centre toward
itself and then be counted as near it. A third kit that forms its own tiny cluster
is set aside as an outlier and the sides are found again without it. Then the
honest part: a track whose kit is nearly as close to the other side as to its own
gets **no team**. Unknown beats wrong, and a wrong side on a fifteen-year-old's goal
is a harm no accuracy metric repays.

See docs/vision/34-PHASE-4-INCREMENT-3.md.
"""

from __future__ import annotations

import colorsys
import json
import pathlib
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

#: Twelve hue bins, each centred on the hue it is named for (red at 0°, blue at 240°),
#: plus dark and light achromatic bins.
HUE_BINS = 12
BINS = HUE_BINS + 2

#: Below this saturation a pixel has no hue worth counting; it is dark or light instead.
ACHROMATIC_SATURATION = 0.22
#: Achromatic pixels at or above this value are "light" (white kits), below "dark" (black kits).
LIGHT_VALUE = 0.55
#: Pixels darker than this are shadow or boots, whatever their hue, and are skipped.
MIN_VALUE = 0.12

#: Classes whose kit is clustered into the two sides. Everyone else keeps their own kit.
CLUSTERED_CLASSES = frozenset({"player"})

#: How much nearer a kit must be to its own cluster than the other, as a fraction of
#: the distance between the two cluster centres, before a side is named.
MIN_MARGIN = 0.15

#: Frames sampled per track, spread from first sighting to last.
SAMPLES_PER_TRACK = 5

#: A side smaller than this share of the clustered tracks is not a side; it is a
#: third kit that happened to be far from both, and it is set aside. A fifth means
#: nothing is ever set aside from fewer than six tracks: a side of one is not under
#: a fifth of five.
MIN_SIDE_SHARE = 0.2

HUE_NAMES = ["red", "orange", "yellow", "lime", "green", "teal", "cyan", "azure", "blue", "violet", "magenta", "rose"]


@dataclass(frozen=True)
class Params:
    samples_per_track: int = SAMPLES_PER_TRACK
    min_margin: float = MIN_MARGIN
    achromatic_saturation: float = ACHROMATIC_SATURATION
    min_side_share: float = MIN_SIDE_SHARE

    def as_dict(self) -> dict[str, Any]:
        return {
            "samplesPerTrack": self.samples_per_track,
            "minMargin": self.min_margin,
            "achromaticSaturation": self.achromatic_saturation,
            "minSideShare": self.min_side_share,
        }


Feature = list[float]


def torso_region(box: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    """The part of a player box that is shirt: the middle half across, 20-55% down.

    Head and shorts are excluded on purpose -- shorts are often the other colour of
    the same kit, and skin and hair are not a side.
    """
    x, y, w, h = box
    return (x + w * 0.25, y + h * 0.20, w * 0.5, h * 0.35)


def kit_histogram(
    pixels: bytes, frame_w: int, frame_h: int, region: tuple[float, float, float, float], params: Params = Params()
) -> Feature | None:
    """Normalised colour histogram of a region of a raw RGB frame, or None if too small."""
    x0 = max(0, int(region[0]))
    y0 = max(0, int(region[1]))
    x1 = min(frame_w, int(region[0] + region[2]))
    y1 = min(frame_h, int(region[1] + region[3]))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    counts = [0.0] * BINS
    total = 0.0
    for y in range(y0, y1):
        row = (y * frame_w) * 3
        for x in range(x0, x1):
            i = row + x * 3
            r, g, b = pixels[i] / 255.0, pixels[i + 1] / 255.0, pixels[i + 2] / 255.0
            h, s, v = colorsys.rgb_to_hsv(r, g, b)
            if v < MIN_VALUE:
                continue
            if s < params.achromatic_saturation:
                counts[HUE_BINS + (1 if v >= LIGHT_VALUE else 0)] += 1
            else:
                counts[int(h * HUE_BINS + 0.5) % HUE_BINS] += 1
            total += 1
    if total == 0:
        return None
    return [c / total for c in counts]


def mean_feature(features: Sequence[Feature]) -> Feature:
    n = len(features)
    return [sum(f[i] for f in features) / n for i in range(BINS)]


def distance(a: Feature, b: Feature) -> float:
    """L1 distance between two histograms: 0 for identical kits, 2 for disjoint ones."""
    return sum(abs(x - y) for x, y in zip(a, b, strict=True))


def describe(feature: Feature) -> str:
    """The dominant bin, for a reviewer's eye: 'blue', 'white', 'dark'."""
    top = max(range(BINS), key=lambda i: feature[i])
    if top == HUE_BINS:
        return "dark"
    if top == HUE_BINS + 1:
        return "white"
    return HUE_NAMES[top]


def sample_frames(frames: Sequence[int], per_track: int) -> list[int]:
    """Up to `per_track` of a track's observed frames, spread from first to last."""
    if len(frames) <= per_track:
        return list(frames)
    step = (len(frames) - 1) / (per_track - 1)
    return [frames[round(i * step)] for i in range(per_track)]


@dataclass
class KitTrack:
    local_id: int
    cls: str
    feature: Feature | None
    samples: int


def _two_medoids(features: Sequence[Feature], iterations: int) -> tuple[list[Feature], list[int]]:
    """Two medoids and each feature's side, from the two most different kits."""
    n = len(features)
    dist = [[distance(features[i], features[j]) for j in range(n)] for i in range(n)]
    best = (0.0, 0, 1)
    for i in range(n):
        for j in range(i + 1, n):
            if dist[i][j] > best[0]:
                best = (dist[i][j], i, j)
    medoids = [best[1], best[2]]
    sides = [0] * n
    for _ in range(iterations):
        sides = [0 if dist[i][medoids[0]] <= dist[i][medoids[1]] else 1 for i in range(n)]
        new = list(medoids)
        for k in (0, 1):
            members = [i for i in range(n) if sides[i] == k]
            if members:
                new[k] = min(members, key=lambda i: (sum(dist[i][j] for j in members), i))
        if new == medoids:
            break
        medoids = new
    return [features[medoids[0]], features[medoids[1]]], sides


def cluster_teams(tracks: Sequence[KitTrack], params: Params = Params(), iterations: int = 20) -> dict[str, Any]:
    """Two kits, and which track wears which.

    Only clustered classes with a kit feature take part. Two medoids are found from
    the two most different kits; if one side is a sliver of the pool, its members
    are outliers and the sides are found again without them. Each remaining track's
    margin is `(d_other - d_own) / d_between`, and a side is named only when it
    clears `min_margin`. Returns the assignments and the two kits described.
    """
    pool = [t for t in tracks if t.cls in CLUSTERED_CLASSES and t.feature is not None]
    outliers: set[int] = set()
    centres: list[Feature] = []

    candidates = list(pool)
    for _ in range(2):
        if len(candidates) < 2:
            break
        centres, sides = _two_medoids([t.feature for t in candidates], iterations)  # type: ignore[misc]
        smaller = min(sides.count(0), sides.count(1))
        if smaller < params.min_side_share * len(candidates):
            minority = 0 if sides.count(0) < sides.count(1) else 1
            outliers.update(t.local_id for t, side in zip(candidates, sides, strict=True) if side == minority)
            candidates = [t for t, side in zip(candidates, sides, strict=True) if side != minority]
            centres = []
            continue
        break

    rows: list[dict[str, Any]] = []
    between = distance(centres[0], centres[1]) if len(centres) == 2 else 0.0
    for t in tracks:
        if t.cls not in CLUSTERED_CLASSES or t.feature is None or len(centres) < 2:
            rows.append({"localTrackId": t.local_id, "class": t.cls, "team": None, "nearest": None, "confidence": None, "method": "not_clustered", "samples": t.samples})
            continue
        if t.local_id in outliers:
            rows.append({"localTrackId": t.local_id, "class": t.cls, "team": None, "nearest": None, "confidence": None, "method": "kit_outlier", "samples": t.samples})
            continue
        d0 = distance(t.feature, centres[0])
        d1 = distance(t.feature, centres[1])
        own = 0 if d0 <= d1 else 1
        margin = abs(d1 - d0) / between if between > 0 else 0.0
        confident = margin >= params.min_margin
        rows.append({
            "localTrackId": t.local_id,
            "class": t.cls,
            "team": ("A" if own == 0 else "B") if confident else None,
            # Named even when the margin was too small: unknown precision later asks
            # whether abstaining here avoided a wrong answer.
            "nearest": "A" if own == 0 else "B",
            "confidence": round(min(1.0, margin), 3),
            "method": "kit_cluster",
            "samples": t.samples,
        })

    kits = [{"team": "A", "description": describe(centres[0])}, {"team": "B", "description": describe(centres[1])}] if len(centres) == 2 else []
    assigned = sum(1 for r in rows if r["team"] is not None)
    return {
        "kits": kits,
        "kitDistance": round(between, 4),
        "clusteredTracks": len(pool),
        "outliers": len(outliers),
        "assigned": assigned,
        "unknown": len(pool) - assigned,
        "params": params.as_dict(),
        "rows": rows,
    }


def extract_features(pixels: bytes, width: int, height: int, boxes: Sequence[dict[str, Any]], params: Params = Params()) -> list[dict[str, Any]]:
    """Kit features for a list of `{localTrackId, class, box}` on one raw RGB frame.

    What the stage does per frame, exposed so the gate can hand the arithmetic a
    frame it painted itself and read the kits back.
    """
    out = []
    for b in boxes:
        box = b["box"]
        region = torso_region((float(box["x"]), float(box["y"]), float(box["width"]), float(box["height"])))
        hist = kit_histogram(pixels, width, height, region, params)
        out.append({"localTrackId": int(b["localTrackId"]), "class": str(b["class"]), "feature": hist, "samples": 0 if hist is None else 1})
    return out


def main(argv: Sequence[str] | None = None) -> int:
    """Two modes, so the gate can run the arithmetic on a machine with no FFmpeg.

    `python -m dtp_vision_worker.kits --frame f.rgb --width W --height H --boxes boxes.json`
    reads kits off one raw RGB frame and prints `[{localTrackId, class, feature, samples}]`.

    `python -m dtp_vision_worker.kits --features features.json`
    clusters pre-extracted kit features into two sides and prints the result.
    """
    import argparse  # noqa: PLC0415

    parser = argparse.ArgumentParser(prog="dtp-vision-kits")
    parser.add_argument("--features", help="kit features to cluster")
    parser.add_argument("--frame", help="a raw RGB24 frame to read kits from")
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    parser.add_argument("--boxes", help="[{localTrackId, class, box}] on that frame")
    args = parser.parse_args(argv)

    if args.frame:
        if not (args.width and args.height and args.boxes):
            parser.error("--frame needs --width, --height and --boxes")
        pixels = pathlib.Path(args.frame).read_bytes()
        if len(pixels) != args.width * args.height * 3:
            parser.error(f"{len(pixels)} bytes is not a {args.width}x{args.height} RGB24 frame")
        with open(args.boxes, encoding="utf-8") as handle:
            boxes = json.load(handle)
        json.dump(extract_features(pixels, args.width, args.height, boxes), sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    if not args.features:
        parser.error("one of --features or --frame is needed")
    with open(args.features, encoding="utf-8") as handle:
        raw = json.load(handle)
    tracks = [KitTrack(int(t["localTrackId"]), str(t["class"]), t.get("feature"), int(t.get("samples", 0))) for t in raw]
    json.dump(cluster_teams(tracks), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
