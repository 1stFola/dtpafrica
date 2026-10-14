"""Does a carried calibration still sit on the painted lines?

A calibration carried along camera motion drifts, fastest in a quick pan: on the 1XCup
pilot clip the drawn pitch left the paint about a second after a keyframe in some pans
and stayed on it for ten in others (docs/vision/97). So every carried frame is checked
against its own picture: the pitch's markings are drawn through the carried calibration
and sampled every 10 cm, and each sample is scored by how far it falls from white
paint. A frame whose markings mostly miss the paint loses its calibration, with the
reason `off_paint`. Unknown beats wrong.

The paint is what a person would call a line: brighter than the grass around it (a
top-hat over an 11-pixel disc) and unsaturated. Players' kit, boards and the score bug
can look like paint, which only makes a frame look better than it is; so the check
never fails a frame on too little evidence, and never passes one on paint alone.
"""
from __future__ import annotations

import math

import numpy as np

#: A sample within this many pixels of paint is on it: half a painted line on a 720p proxy,
#: plus the fit's own error.
ON_PAINT_PX = 3.0
#: Fewer samples than this in view and below the stands (about 10 m of marking): too little to
#: judge, so the frame keeps its calibration.
MIN_SAMPLES = 100
#: A frame fails when under this share of its samples is on paint ...
MIN_ON_PAINT = 0.5
#: ... and its median sample is further than this from paint. Both, so one bad line cannot fail a frame.
MAX_MEDIAN_PX = 2.0
#: The top of a broadcast picture is stands, boards and the score bug: not pitch, and full of false paint.
TOP_EXCLUDED = 0.22
#: Every 10 cm: a far view shows only a few pixels per metre, and coarser sampling left drifted
#: far views with too few samples to judge (docs/vision/97).
SAMPLE_M = 0.1
R_CIRCLE = 9.15

PARAMS = {"onPaintPx": ON_PAINT_PX, "minSamples": MIN_SAMPLES, "minOnPaint": MIN_ON_PAINT, "maxMedianPx": MAX_MEDIAN_PX, "topExcluded": TOP_EXCLUDED, "sampleM": SAMPLE_M}


def markings(length_m: float, width_m: float, step: float = SAMPLE_M) -> np.ndarray:
    """Points on the painted markings, in pitch metres: the outline, halfway line, centre circle, both boxes and goal areas."""
    m = width_m / 2
    segments = [((0, 0), (length_m, 0)), ((length_m, 0), (length_m, width_m)), ((length_m, width_m), (0, width_m)), ((0, width_m), (0, 0)),
                ((length_m / 2, 0), (length_m / 2, width_m))]
    for x0, s in ((0.0, 1), (length_m, -1)):
        for depth, half in ((16.5, 20.16), (5.5, 9.16)):
            a, b = (x0, m - half), (x0 + s * depth, m - half)
            c, d = (x0 + s * depth, m + half), (x0, m + half)
            segments += [(a, b), (b, c), (c, d)]
    pts = []
    for (ax, ay), (bx, by) in segments:
        n = max(2, int(math.hypot(bx - ax, by - ay) / step))
        t = np.linspace(0, 1, n)
        pts.append(np.stack([ax + t * (bx - ax), ay + t * (by - ay)], 1))
    n = int(2 * math.pi * R_CIRCLE / step)
    a = np.linspace(0, 2 * math.pi, n, endpoint=False)
    pts.append(np.stack([length_m / 2 + R_CIRCLE * np.cos(a), m + R_CIRCLE * np.sin(a)], 1))
    return np.concatenate(pts)


def paint_distance(frame_bgr: np.ndarray) -> np.ndarray:
    """Per pixel, the distance in pixels to the nearest painted-line pixel."""
    import cv2  # noqa: PLC0415 -- the CPU image has it; the propagation itself does not need it

    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    grey = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    tophat = cv2.morphologyEx(grey, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    paint = ((tophat > 25) & (hsv[..., 1] < 60)).astype(np.uint8)
    return cv2.distanceTransform(1 - paint, cv2.DIST_L2, 3)


def check(distance: np.ndarray, homography: list[float], pitch: dict, samples: np.ndarray | None = None) -> dict:
    """Score one frame: the carried homography (pixel -> metres) drawn back onto its own picture."""
    h, w = distance.shape
    pts = samples if samples is not None else markings(pitch["lengthM"], pitch["widthM"])
    try:
        back = np.linalg.inv(np.array(homography, float).reshape(3, 3))
    except np.linalg.LinAlgError:
        return {"verdict": "off_paint", "samples": 0, "onPaint": 0.0, "medianPx": None}
    q = np.c_[pts, np.ones(len(pts))] @ back.T
    ok = q[:, 2] > 1e-9  # in front of the camera
    uv = q[ok, :2] / q[ok, 2:]
    keep = (uv[:, 0] >= 0) & (uv[:, 0] < w - 1) & (uv[:, 1] >= TOP_EXCLUDED * h) & (uv[:, 1] < h - 1)
    uv = uv[keep]
    if len(uv) < MIN_SAMPLES:
        return {"verdict": "unjudged", "samples": int(len(uv)), "onPaint": None, "medianPx": None}
    d = distance[uv[:, 1].astype(int), uv[:, 0].astype(int)]
    on, median = float((d <= ON_PAINT_PX).mean()), float(np.median(d))
    verdict = "off_paint" if on < MIN_ON_PAINT and median > MAX_MEDIAN_PX else "on_paint"
    return {"verdict": verdict, "samples": int(len(uv)), "onPaint": round(on, 3), "medianPx": round(median, 2)}
