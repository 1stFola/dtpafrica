"""Calibration carried along camera motion, against a synthetic camera whose every frame's truth is known.

The pitch (metres) maps to a "world" picture by G; the camera at frame f sees the world
through P_f. So frame f's true calibration is (P_f G)^-1, and the motion camera_motion
would measure from f-1 to f is P_f P_(f-1)^-1. A keyframe filed on frame k is exactly
(P_k G)^-1, and carried to frame i it must equal (P_i G)^-1.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from dtp_vision_worker.calibration_propagation import (
    Calibration,
    Segment,
    carry,
    chain,
    check_keyframes,
    drifts,
    parse_segments,
    propagate,
)

FPS, OFFSET = 25, 0
# Pitch metres -> world pixels: 10 px a metre with a little perspective, as a raised camera sees it.
G = np.array([[10.0, 1.5, 200.0], [0.2, 6.0, 120.0], [0.0, 0.0015, 1.0]])
LANDMARKS_M = [(0, 0), (105, 0), (52.5, 0), (52.5, 68), (0, 68), (105, 68), (16.5, 13.85), (88.5, 54.15)]


def camera(f: int) -> np.ndarray:
    """World pixel -> frame pixel at frame f: a pan of 6 px a frame and a slow zoom."""
    s = 1.0 + 0.002 * f
    return np.array([[s, 0.0, -6.0 * f - 300.0], [0.0, s, -100.0], [0.0, 0.0, 1.0]])


def true_calibration(f: int) -> np.ndarray:
    return np.linalg.inv(camera(f) @ G)


def keyframe(f: int, cid: str = "", quality: str = "good", h: np.ndarray | None = None) -> Calibration:
    to_frame = camera(f) @ G
    points = []
    for x, y in LANDMARKS_M:
        p = to_frame @ np.array([x, y, 1.0])
        points.append((p[0] / p[2], p[1] / p[2]))
    return Calibration(cid or f"k{f}", quality, true_calibration(f) if h is None else h, tuple(points), f)


def motion_rows(n: int, breaks: tuple[int, ...] = ()) -> list[dict]:
    rows = [{"f": 0, "status": "start", "H": None}]
    for f in range(1, n):
        if f in breaks:
            rows.append({"f": f, "status": "break", "H": None})
        else:
            h = camera(f) @ np.linalg.inv(camera(f - 1))
            rows.append({"f": f, "status": "tracked", "H": [float(v) for v in h.ravel()]})
    return rows


def metres_error(h: np.ndarray, f: int) -> float:
    """Largest disagreement with the truth, in metres, over the landmarks frame f sees."""
    worst = 0.0
    to_frame = camera(f) @ G
    for x, y in LANDMARKS_M:
        p = to_frame @ np.array([x, y, 1.0])
        q = h @ (p / p[2])
        worst = max(worst, math.hypot(q[0] / q[2] - x, q[1] / q[2] - y))
    return worst


def segment(start=0, end=10_000, sid="seg", **kw) -> Segment:
    return Segment(sid, start, end, **kw)


def rows_by_frame(segments, n=100, breaks=(), reach=1000):
    transforms, shot = chain(motion_rows(n, breaks), n)
    check_keyframes(segments, n, FPS, OFFSET)
    return {r["f"]: r for r in propagate(transforms, shot, segments, FPS, OFFSET, reach)}


def test_one_keyframe_carried_to_every_frame_of_its_shot_matches_the_truth():
    rows = rows_by_frame([segment(keyframes=[keyframe(50)])])
    for f in (0, 1, 25, 49, 50, 51, 75, 99):
        r = rows[f]
        assert r["reason"] is None and r["calibrationId"] == "k50" and r["framesFromKeyframe"] == abs(f - 50)
        assert metres_error(np.array(r["H"]).reshape(3, 3), f) < 1e-6


def test_nothing_crosses_an_edit_cut():
    rows = rows_by_frame([segment(keyframes=[keyframe(50)])], breaks=(60,))
    assert rows[59]["H"] is not None
    assert rows[60]["H"] is None and rows[60]["reason"] == "no_keyframe_in_shot"
    assert rows[99]["reason"] == "no_keyframe_in_shot"


def test_reach_stops_the_carry_where_drift_could_grow():
    rows = rows_by_frame([segment(keyframes=[keyframe(50)])], reach=10)
    assert rows[40]["H"] is not None and rows[60]["H"] is not None
    assert rows[39]["reason"] == "beyond_reach" and rows[61]["reason"] == "beyond_reach"
    assert rows[39]["calibrationId"] is None


def test_each_frame_takes_its_nearest_keyframe_in_the_shot_the_earlier_on_a_tie():
    rows = rows_by_frame([segment(keyframes=[keyframe(10), keyframe(90)])])
    assert rows[40]["calibrationId"] == "k10" and rows[60]["calibrationId"] == "k90"
    assert rows[50]["calibrationId"] == "k10"
    # A keyframe across a cut is not "nearest": the one in the frame's own shot is.
    rows = rows_by_frame([segment(keyframes=[keyframe(10), keyframe(70)])], breaks=(65,))
    assert rows[64]["calibrationId"] == "k10" and rows[66]["calibrationId"] == "k70"


def test_a_whole_segment_calibration_holds_on_every_frame_and_a_failed_one_on_none():
    whole = Calibration("w", "usable", true_calibration(0), keyframe(0).points, None)
    rows = rows_by_frame([segment(whole=whole)])
    assert all(rows[f]["H"] == [float(v) for v in true_calibration(0).ravel()] for f in (0, 50, 99))
    failed = Calibration("w", "failed", true_calibration(0), (), None)
    rows = rows_by_frame([segment(whole=failed)])
    assert rows[50]["H"] is None and rows[50]["reason"] == "calibration_failed" and rows[50]["calibrationId"] == "w"


def test_a_failed_keyframe_yields_no_coordinates_but_says_which():
    rows = rows_by_frame([segment(keyframes=[keyframe(50, quality="failed")])])
    assert rows[52]["H"] is None and rows[52]["reason"] == "keyframe_failed" and rows[52]["calibrationId"] == "k50"


def test_frames_outside_any_segment_and_segments_without_calibration_are_explicit():
    rows = rows_by_frame([segment(1000, 2000, keyframes=[keyframe(30)]), segment(2000, 3000, sid="bare")])
    assert rows[0]["reason"] == "no_camera_segment" and rows[0]["cameraSegmentId"] is None
    assert rows[30]["cameraSegmentId"] == "seg" and rows[30]["H"] is not None
    # Half-open: frame 50 is at 2000 ms, so it belongs to the second segment, not the first.
    assert rows[50]["cameraSegmentId"] == "bare" and rows[50]["reason"] == "segment_not_calibrated"
    assert rows[80]["reason"] == "no_camera_segment"


def test_exact_keyframes_agree_and_a_wrong_one_shows_as_drift_in_metres():
    transforms, shot = chain(motion_rows(100), 100)
    good = drifts(transforms, shot, [segment(keyframes=[keyframe(10), keyframe(90)])])["seg"]
    assert good[0]["fromFrame"] == 10 and good[0]["toFrame"] == 90 and good[0]["maxM"] < 1e-4
    # The later keyframe filed one metre off along the touchline.
    shift = np.array([[1.0, 0.0, 1.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
    off = keyframe(90, h=shift @ true_calibration(90))
    bad = drifts(transforms, shot, [segment(keyframes=[keyframe(10), off])])["seg"]
    assert abs(bad[0]["medianM"] - 1.0) < 1e-6
    # No pair across a cut, and none with a failed keyframe.
    assert drifts(*chain(motion_rows(100, (50,)), 100), [segment(keyframes=[keyframe(10), keyframe(90)])]) == {}
    assert drifts(transforms, shot, [segment(keyframes=[keyframe(10), keyframe(90, quality="failed")])]) == {}


def test_a_keyframe_filed_with_the_opposite_sign_is_carried_facing_the_camera():
    flipped = keyframe(50, h=-true_calibration(50))
    transforms, _ = chain(motion_rows(100), 100)
    h = carry(flipped, transforms, 70)
    to_frame = camera(70) @ G
    for x, y in LANDMARKS_M:
        p = to_frame @ np.array([x, y, 1.0])
        assert (h @ (p / p[2]))[2] > 0
    assert metres_error(h, 70) < 1e-6


def test_the_pinned_segments_are_read_strictly():
    good = {"cameraSegmentId": "s", "startMs": 0, "endMs": 1000, "calibrations": [
        {"calibrationId": "k", "quality": "good", "frameIndex": 3, "homography": [1, 0, 0, 0, 1, 0, 0, 0, 1], "points": [{"px": 1, "py": 2}]}]}
    assert parse_segments([good])[0].keyframes[0].frame == 3
    whole = {"calibrationId": "w", "quality": "good", "frameIndex": None, "homography": [1, 0, 0, 0, 1, 0, 0, 0, 1], "points": []}
    for bad in (
        [good, {**good, "cameraSegmentId": "t", "startMs": 500, "endMs": 2000}],  # overlap
        [{**good, "calibrations": [whole, whole]}],
        [{**good, "calibrations": [whole, good["calibrations"][0]]}],
        [{**good, "calibrations": [good["calibrations"][0], good["calibrations"][0]]}],
        [{**good, "calibrations": [{**good["calibrations"][0], "homography": [0] * 9}]}],
        [{**good, "calibrations": [{**good["calibrations"][0], "quality": "great"}]}],
        [{**good, "endMs": 0}],
        "not a list",
    ):
        with pytest.raises(ValueError):
            parse_segments(bad)


def test_motion_must_cover_every_frame_in_order_and_keyframes_must_sit_in_it():
    with pytest.raises(ValueError):
        chain(motion_rows(10)[:9], 10)
    with pytest.raises(ValueError):
        chain([motion_rows(10)[0], motion_rows(10)[2]], 10)
    with pytest.raises(ValueError, match="past"):
        check_keyframes([segment(keyframes=[keyframe(150)])], 100, FPS, OFFSET)
    with pytest.raises(ValueError, match="outside its segment"):
        check_keyframes([segment(0, 1000, keyframes=[keyframe(50)])], 100, FPS, OFFSET)
