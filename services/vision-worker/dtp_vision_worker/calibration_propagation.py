"""Carrying a person's keyframe calibrations to every frame, along measured camera motion.

A keyframe is a calibration true of one proxy frame: a homography C_k from that
frame's pixels to the pitch in metres. `camera_motion` measured, for each pair of
frames, the homography H_f taking a pixel of frame f-1 to frame f. Chained within a
shot, T_f = H_f ... H_(s+1) takes the shot's first frame s to frame f, so

    C_i = C_k . T_k . T_i^-1

takes a pixel of frame i to the pitch: back to the shot's first frame, forward to the
keyframe, then through the person's fit. Nothing is carried across an edit cut (a
break ends the shot) or further than `reach` frames: drift grows with distance, and
unknown beats wrong.

A segment with a whole-segment calibration (a still camera) uses it on every frame.
A segment with keyframes uses, on each frame, the nearest keyframe in the same shot.
Where one shot holds two keyframes, the earlier is carried onto the later and the two
compared at the later one's clicked landmarks: that disagreement, in metres, is the
drift measured on this footage (docs/vision/93).

Pure numpy over parsed rows, so it is tested on synthetic cameras whose truth is known
(tests/test_calibration_propagation.py).
"""

from __future__ import annotations

import bisect
import math
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field

import numpy as np

CALCULATION_VERSION = "calibration-propagation/v1"
INDEX_ROLE = "calibration_frames"
CHUNK_ROLE = "calibration_frames_chunk"

#: Why a frame has no calibration.
REASONS = ("no_camera_segment", "segment_not_calibrated", "calibration_failed", "no_keyframe_in_shot", "beyond_reach", "keyframe_failed", "motion_unknown")

PASSING = ("good", "usable")


@dataclass(frozen=True)
class Calibration:
    calibration_id: str
    quality: str
    homography: np.ndarray  # 3x3, proxy pixel -> metres, oriented as filed
    points: tuple[tuple[float, float], ...]  # clicked pixels, for orientation and drift
    frame: int | None  # None: whole segment


@dataclass
class Segment:
    segment_id: str
    start_ms: int
    end_ms: int
    whole: Calibration | None = None
    keyframes: list[Calibration] = field(default_factory=list)


def _matrix(values: object) -> np.ndarray:
    if not isinstance(values, (list, tuple)) or len(values) != 9 or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in values):
        raise ValueError("a homography is nine finite numbers")
    m = np.array(values, float).reshape(3, 3)
    if abs(np.linalg.det(m)) < 1e-15:
        raise ValueError("a homography must be invertible")
    return m


def parse_segments(raw: object) -> list[Segment]:
    """The declared segments with their current calibrations, as the control plane pinned them."""
    if not isinstance(raw, list) or len(raw) > 2000:
        raise ValueError("segments must be a list of at most 2000")
    out: list[Segment] = []
    for row in raw:
        if not isinstance(row, dict):
            raise ValueError("a segment must be an object")
        sid, start, end = row.get("cameraSegmentId"), row.get("startMs"), row.get("endMs")
        if not isinstance(sid, str) or not sid or not isinstance(start, int) or not isinstance(end, int) or isinstance(start, bool) or isinstance(end, bool) or end <= start or start < 0:
            raise ValueError("a segment needs an id and a half-open whole-ms window")
        seg = Segment(sid, start, end)
        for cal in row.get("calibrations") or []:
            c = _calibration(cal)
            if c.frame is None:
                if seg.whole is not None:
                    raise ValueError(f"segment {sid} has two whole-segment calibrations")
                seg.whole = c
            else:
                seg.keyframes.append(c)
        if seg.whole is not None and seg.keyframes:
            raise ValueError(f"segment {sid} has both a whole-segment calibration and keyframes")
        if len({k.frame for k in seg.keyframes}) != len(seg.keyframes):
            raise ValueError(f"segment {sid} has two keyframes on one frame")
        seg.keyframes.sort(key=lambda k: k.frame)
        out.append(seg)
    out.sort(key=lambda s: s.start_ms)
    for a, b in zip(out, out[1:]):
        if b.start_ms < a.end_ms:
            raise ValueError("segments overlap")
    return out


def _calibration(raw: object) -> Calibration:
    if not isinstance(raw, dict):
        raise ValueError("a calibration must be an object")
    cid, quality, frame = raw.get("calibrationId"), raw.get("quality"), raw.get("frameIndex")
    if not isinstance(cid, str) or not cid or quality not in ("good", "usable", "failed"):
        raise ValueError("a calibration needs an id and a quality")
    if frame is not None and (not isinstance(frame, int) or isinstance(frame, bool) or frame < 0):
        raise ValueError("a keyframe's frame is a whole number")
    pts = raw.get("points") or []
    if not isinstance(pts, list) or not all(isinstance(p, dict) and isinstance(p.get("px"), (int, float)) and isinstance(p.get("py"), (int, float)) for p in pts):
        raise ValueError("calibration points must carry px and py")
    return Calibration(cid, quality, _matrix(raw.get("homography")), tuple((float(p["px"]), float(p["py"])) for p in pts), frame)


def _normalise(m: np.ndarray) -> np.ndarray:
    """Scaled so its largest entry is 1 in size, sign kept: products of hundreds of frames stay in range."""
    return m / np.abs(m).max()


def chain(rows: Iterable[dict], n_frames: int) -> tuple[np.ndarray, np.ndarray]:
    """Per frame: the transform from its shot's first frame (T), and its shot number.

    A `break`, or a missing or malformed row, starts a new shot: motion that was not
    measured is not assumed.
    """
    transforms = np.empty((n_frames, 3, 3), float)
    shot = np.empty(n_frames, np.int64)
    current = -1
    seen = 0
    t = np.eye(3)
    for row in rows:
        f = row.get("f")
        if f != seen or f >= n_frames:
            raise ValueError(f"camera motion rows must run 0..{n_frames - 1} in order; got frame {f} at {seen}")
        h = row.get("H")
        if f == 0 or row.get("status") not in ("tracked", "bridged") or h is None:
            current += 1
            t = np.eye(3)
        else:
            t = _normalise(_matrix(h) @ t)
        transforms[f] = t
        shot[f] = current
        seen += 1
    if seen != n_frames:
        raise ValueError(f"camera motion covers {seen} frames, not {n_frames}")
    return transforms, shot


def _project(h: np.ndarray, x: float, y: float) -> tuple[float, float] | None:
    v = h @ np.array([x, y, 1.0])
    if abs(v[2]) < 1e-12:
        return None
    return float(v[0] / v[2]), float(v[1] / v[2])


def carry(c: Calibration, transforms: np.ndarray, i: int) -> np.ndarray:
    """C_k carried to frame i: pixel of frame i -> metres. Oriented: positive w at the keyframe's landmarks seen from i."""
    k = c.frame
    assert k is not None
    i_to_k = transforms[k] @ np.linalg.inv(transforms[i])
    h = c.homography @ i_to_k
    k_to_i = np.linalg.inv(i_to_k)
    signs = []
    for px, py in c.points:
        p = k_to_i @ np.array([px, py, 1.0])
        if abs(p[2]) < 1e-12:
            continue
        p = p / p[2]
        signs.append((h @ p)[2])
    if signs and sum(1 for w in signs if w < 0) > len(signs) / 2:
        h = -h
    return h / np.abs(h).max()


def drift(a: Calibration, b: Calibration, transforms: np.ndarray) -> dict:
    """Keyframe a carried onto keyframe b's frame, compared with b at b's landmarks, in metres."""
    carried = carry(a, transforms, b.frame)  # type: ignore[arg-type]
    errors = []
    for px, py in b.points:
        p, q = _project(carried, px, py), _project(b.homography, px, py)
        if p and q:
            errors.append(math.hypot(p[0] - q[0], p[1] - q[1]))
    errors.sort()
    return {"fromCalibrationId": a.calibration_id, "toCalibrationId": b.calibration_id, "fromFrame": a.frame, "toFrame": b.frame,
            "medianM": round(errors[len(errors) // 2], 3) if errors else None, "maxM": round(errors[-1], 3) if errors else None}


def frame_ms(frame: int, fps: float, offset: int) -> int:
    return offset + int(round(frame * 1000 / fps))


def check_keyframes(segments: list[Segment], n_frames: int, fps: float, offset: int) -> None:
    """Every keyframe on a frame the motion covers, inside its own segment, half-open."""
    for seg in segments:
        for k in seg.keyframes:
            if k.frame >= n_frames:
                raise ValueError(f"keyframe {k.calibration_id} is on frame {k.frame}, past the {n_frames} frames measured")
            ms = frame_ms(k.frame, fps, offset)
            if not seg.start_ms <= ms < seg.end_ms:
                raise ValueError(f"keyframe {k.calibration_id} at {ms} ms is outside its segment {seg.start_ms}-{seg.end_ms} ms")


def propagate(transforms: np.ndarray, shot: np.ndarray, segments: list[Segment], fps: float, offset: int, reach_frames: int) -> Iterator[dict]:
    """One row per frame: its calibration (pixel -> metres) or why it has none. Call `check_keyframes` first."""
    starts = [s.start_ms for s in segments]
    for i in range(len(shot)):
        ms = frame_ms(i, fps, offset)
        seg = None
        j = bisect.bisect_right(starts, ms) - 1
        if j >= 0 and segments[j].start_ms <= ms < segments[j].end_ms:
            seg = segments[j]
        row: dict = {"f": i, "ms": ms, "cameraSegmentId": seg.segment_id if seg else None, "H": None, "calibrationId": None,
                     "quality": None, "keyframe": None, "framesFromKeyframe": None, "reason": None}
        if seg is None:
            row["reason"] = "no_camera_segment"
        elif seg.whole is not None:
            row |= {"calibrationId": seg.whole.calibration_id, "quality": seg.whole.quality}
            if seg.whole.quality in PASSING:
                row["H"] = [float(v) for v in seg.whole.homography.ravel()]
            else:
                row["reason"] = "calibration_failed"
        elif not seg.keyframes:
            row["reason"] = "segment_not_calibrated"
        else:
            same_shot = [k for k in seg.keyframes if shot[k.frame] == shot[i]]
            if not same_shot:
                row["reason"] = "no_keyframe_in_shot"
            else:
                k = min(same_shot, key=lambda c: (abs(c.frame - i), c.frame))
                if abs(k.frame - i) > reach_frames:
                    row["reason"] = "beyond_reach"
                else:
                    row |= {"calibrationId": k.calibration_id, "quality": k.quality, "keyframe": k.frame, "framesFromKeyframe": abs(k.frame - i)}
                    if k.quality not in PASSING:
                        row["reason"] = "keyframe_failed"
                    else:
                        row["H"] = [float(v) for v in carry(k, transforms, i).ravel()]
        yield row


def drifts(transforms: np.ndarray, shot: np.ndarray, segments: list[Segment]) -> dict[str, list[dict]]:
    """Per segment, every consecutive pair of keyframes in one shot, carried onto each other."""
    out: dict[str, list[dict]] = {}
    for seg in segments:
        pairs = [drift(a, b, transforms) for a, b in zip(seg.keyframes, seg.keyframes[1:])
                 if shot[a.frame] == shot[b.frame] and a.quality in PASSING and b.quality in PASSING]
        if pairs:
            out[seg.segment_id] = pairs
    return out
