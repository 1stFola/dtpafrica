"""Camera motion between consecutive proxy frames, and the shots it falls into.

A grassroots match is usually filmed by one person panning and zooming from the
stand, so a pitch calibration made on one frame is wrong a second later. This
measures how the picture moves from each frame to the next, so a calibration a
person filed on a keyframe can be carried to the frames around it
(docs/vision/92).

Per pair of frames: corners on the earlier frame, followed into the later one by
pyramidal Lucas-Kanade, and a homography fitted by RANSAC. Players and the ball
move on their own; RANSAC leaves them out as long as the stands, boards and pitch
outnumber them, which is the case for a wide shot. Pixels that never change while
the camera moves (a scoreboard graphic, a broadcaster's mark) are masked out
first: tracked, they would agree on "no motion" and pull every fit towards it.

A pair that does not fit is either an edit cut or a whip pan too fast to follow.
The two frames are then matched directly, wide-baseline: a pan still shares most
of its picture and matches; a cut does not, and is a break between shots. A
measured homography is never invented across a break: a calibration does not
cross one.

Pure computation over greyscale numpy frames, so it is tested on synthetic video
whose motion is known exactly (tests/test_camera_motion.py).
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass

import math

import cv2
import numpy as np

ALGORITHM_VERSION = "camera-motion/v1"
INDEX_ROLE = "camera_motion"
CHUNK_ROLE = "camera_motion_chunk"

#: Statuses of a pair, frame f-1 -> frame f.
PAIR_STATUSES = ("tracked", "bridged", "break")


@dataclass(frozen=True)
class Config:
    #: Frames are tracked at this width; the homography is scaled back to proxy pixels.
    work_width: int = 640
    max_corners: int = 600
    corner_quality: float = 0.01
    corner_min_distance: int = 8
    #: RANSAC reprojection threshold, in working pixels.
    ransac_px: float = 1.0
    #: A pair is tracked only with this many agreeing points, and this share of those followed.
    min_inliers: int = 30
    min_inlier_ratio: float = 0.5
    #: Wide-baseline matching across a break: ORB features, Lowe ratio, agreeing matches needed.
    bridge_features: int = 2000
    bridge_ratio: float = 0.75
    bridge_min_inliers: int = 40
    #: A bridge is believed only as a move one frame can make: a whip pan shifts the
    #: picture a long way but barely zooms or tilts it. A cut from a wide shot to a
    #: closer one of the same ground matches too, with a zoom no camera makes in 40 ms.
    max_bridge_shift: float = 0.3
    max_bridge_zoom: float = 0.05
    max_bridge_perspective: float = 2e-4
    #: A pixel whose brightness varies less than this across the clip is static overlay.
    static_std: float = 6.0
    #: An overlay is a small part of the picture. A larger "static" area is a camera that
    #: hardly moved, and masking it would leave nothing to track: then nothing is masked.
    max_overlay_fraction: float = 0.2
    #: Mean Sobel magnitude above which a pixel is textured: where corners come from.
    texture_gradient: float = 40.0
    #: Shots shorter than this are transitions, not shots, and propose no segment.
    min_shot_ms: int = 500
    #: Frames are measured against a reference frame, not the one before: chained pair by
    #: pair, the error of every pair adds up (about 10 px over 8 s on the pilot). A new
    #: reference is taken after this many frames, or sooner when fewer than
    #: `ref_min_survival` of its corners still agree.
    ref_max_frames: int = 75
    ref_min_survival: float = 0.5

    @staticmethod
    def parse(raw: object) -> "Config":
        if raw is None:
            return Config()
        if not isinstance(raw, dict):
            raise ValueError("cameraMotionConfig must be an object")
        allowed = {"minInliers": ("min_inliers", int, 8, 400), "minShotMs": ("min_shot_ms", int, 0, 10_000)}
        values = {}
        for key, value in raw.items():
            if key not in allowed:
                raise ValueError(f"unknown cameraMotionConfig key {key!r}")
            name, kind, lo, hi = allowed[key]
            if not isinstance(value, kind) or isinstance(value, bool) or not lo <= value <= hi:
                raise ValueError(f"cameraMotionConfig.{key} must be a whole number from {lo} to {hi}")
            values[name] = value
        return Config(**values)

    def public(self) -> dict:
        return {k: v for k, v in asdict(self).items()}


def work_size(width: int, height: int, config: Config) -> tuple[int, int]:
    """The tracking resolution: the configured width, height to the proxy's aspect, both even."""
    if width <= 0 or height <= 0:
        raise ValueError("frame size must be positive")
    w = min(width, config.work_width)
    h = max(2, int(round(height * w / width / 2)) * 2)
    return w - (w % 2), h


def static_mask(samples: Iterable[np.ndarray], config: Config) -> tuple[np.ndarray, float]:
    """255 where features may be taken, 0 over a static overlay; and the overlay's share of textured pixels.

    Tracking only takes corners from textured places, so only textured pixels are
    judged: one that never changes while the frames are spread across the clip is
    overlay. Flat grass and sky never change either, but no corner is taken there.
    When most textured pixels never change, the camera barely moved: that is not an
    overlay, nothing is masked and 0.0 is returned.
    """
    stack = np.stack([s.astype(np.float32) for s in samples])
    open_frame = np.full(stack.shape[1:], 255, np.uint8)
    if stack.shape[0] < 2:
        # Nothing to compare: mask nothing rather than guess.
        return open_frame, 0.0
    gradient = np.mean([np.hypot(cv2.Sobel(f, cv2.CV_32F, 1, 0), cv2.Sobel(f, cv2.CV_32F, 0, 1)) for f in stack], axis=0)
    textured = gradient > config.texture_gradient
    if not textured.any():
        return open_frame, 0.0
    still = textured & (stack.std(axis=0) < config.static_std)
    fraction = float(still.sum() / textured.sum())
    if fraction > config.max_overlay_fraction:
        return open_frame, 0.0
    # Grow the overlay a little: its anti-aliased edge flickers and would leak corners.
    grown = cv2.dilate(still.astype(np.uint8), np.ones((9, 9), np.uint8))
    return ((1 - grown) * 255).astype(np.uint8), fraction


def _scale_to_proxy(h: np.ndarray, scale: float) -> list[float]:
    """A homography fitted in working pixels, as one in proxy pixels: S^-1 H S with S = diag(scale, scale, 1)."""
    s = np.diag([scale, scale, 1.0])
    full = np.linalg.inv(s) @ h @ s
    full = full / full[2, 2]
    return [float(v) for v in full.ravel()]


def track_pair(a: np.ndarray, b: np.ndarray, mask: np.ndarray, config: Config) -> dict:
    """Frame a -> frame b, both greyscale at working size. Homography in working pixels, or None."""
    corners = cv2.goodFeaturesToTrack(a, maxCorners=config.max_corners, qualityLevel=config.corner_quality,
                                      minDistance=config.corner_min_distance, mask=mask)
    if corners is None or len(corners) < config.min_inliers:
        return {"h": None, "tracked": 0 if corners is None else int(len(corners)), "inliers": 0, "residualPx": None}
    moved, status, _ = cv2.calcOpticalFlowPyrLK(a, b, corners, None, winSize=(21, 21), maxLevel=3)
    keep = status.ravel() == 1
    p0, p1 = corners[keep].reshape(-1, 2), moved[keep].reshape(-1, 2)
    if len(p0) < config.min_inliers:
        return {"h": None, "tracked": int(len(p0)), "inliers": 0, "residualPx": None}
    h, inliers = cv2.findHomography(p0, p1, cv2.RANSAC, config.ransac_px)
    if h is None or not np.all(np.isfinite(h)):
        return {"h": None, "tracked": int(len(p0)), "inliers": 0, "residualPx": None}
    agree = inliers.ravel() == 1
    n = int(agree.sum())
    residual = float(np.linalg.norm(cv2.perspectiveTransform(p0[agree][None], h)[0] - p1[agree], axis=1).mean()) if n else None
    if n < config.min_inliers or n < config.min_inlier_ratio * len(p0):
        return {"h": None, "tracked": int(len(p0)), "inliers": n, "residualPx": residual}
    return {"h": h, "tracked": int(len(p0)), "inliers": n, "residualPx": residual}


def reference_corners(frame: np.ndarray, mask: np.ndarray, config: Config) -> np.ndarray | None:
    corners = cv2.goodFeaturesToTrack(frame, maxCorners=config.max_corners, qualityLevel=config.corner_quality,
                                      minDistance=config.corner_min_distance, mask=mask)
    return corners if corners is not None and len(corners) >= config.min_inliers else None


def track_from_reference(ref: np.ndarray, corners: np.ndarray, predicted: np.ndarray, frame: np.ndarray, config: Config) -> dict:
    """Reference frame -> this frame, the reference's corners started where the prediction puts them."""
    guess = cv2.perspectiveTransform(corners.astype(np.float32), predicted).astype(np.float32)
    moved, status, _ = cv2.calcOpticalFlowPyrLK(ref, frame, corners, guess.copy(), winSize=(21, 21), maxLevel=3,
                                                flags=cv2.OPTFLOW_USE_INITIAL_FLOW)
    keep = status.ravel() == 1
    p0, p1 = corners[keep].reshape(-1, 2), moved[keep].reshape(-1, 2)
    if len(p0) < config.min_inliers:
        return {"h": None, "tracked": int(len(p0)), "inliers": 0, "residualPx": None}
    h, inliers = cv2.findHomography(p0, p1, cv2.RANSAC, config.ransac_px)
    if h is None or not np.all(np.isfinite(h)):
        return {"h": None, "tracked": int(len(p0)), "inliers": 0, "residualPx": None}
    agree = inliers.ravel() == 1
    n = int(agree.sum())
    residual = float(np.linalg.norm(cv2.perspectiveTransform(p0[agree][None], h)[0] - p1[agree], axis=1).mean()) if n else None
    if n < config.min_inliers or n < config.min_inlier_ratio * len(p0):
        return {"h": None, "tracked": int(len(p0)), "inliers": n, "residualPx": residual}
    return {"h": h, "tracked": int(len(p0)), "inliers": n, "residualPx": residual}


def bridge_pair(a: np.ndarray, b: np.ndarray, mask: np.ndarray, config: Config) -> np.ndarray | None:
    """Wide-baseline match of a -> b, for a pair tracking could not follow. None means a cut."""
    orb = cv2.ORB_create(config.bridge_features)
    ka, da = orb.detectAndCompute(a, mask)
    kb, db = orb.detectAndCompute(b, mask)
    if da is None or db is None or len(ka) < config.bridge_min_inliers or len(kb) < config.bridge_min_inliers:
        return None
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(da, db, k=2)
    good = [m[0] for m in pairs if len(m) == 2 and m[0].distance < config.bridge_ratio * m[1].distance]
    if len(good) < config.bridge_min_inliers:
        return None
    pa = np.float32([ka[m.queryIdx].pt for m in good])
    pb = np.float32([kb[m.trainIdx].pt for m in good])
    h, inliers = cv2.findHomography(pa, pb, cv2.RANSAC, 3.0 * config.ransac_px)
    if h is None or not np.all(np.isfinite(h)) or int(inliers.sum()) < config.bridge_min_inliers:
        return None
    if not plausible_step(h, a.shape, config):
        return None
    return h


def plausible_step(h: np.ndarray, shape: tuple[int, int], config: Config) -> bool:
    """Whether a homography between adjacent frames is a move a camera can make in one frame.

    The centre may shift at most `max_bridge_shift` of the frame (repeated advertising
    boards otherwise match one end of the ground to the other), the zoom change at
    most `max_bridge_zoom`, and the perspective terms stay small.
    """
    hgt, wid = shape
    m = h / h[2, 2]
    centre = cv2.perspectiveTransform(np.float32([[[wid / 2, hgt / 2]]]), m)[0, 0]
    if not np.all(np.isfinite(centre)):
        return False
    if abs(centre[0] - wid / 2) > config.max_bridge_shift * wid or abs(centre[1] - hgt / 2) > config.max_bridge_shift * hgt:
        return False
    zoom = math.sqrt(abs(np.linalg.det(m[:2, :2])))
    if not math.isfinite(zoom) or abs(math.log(max(zoom, 1e-9))) > config.max_bridge_zoom:
        return False
    return abs(m[2, 0]) <= config.max_bridge_perspective and abs(m[2, 1]) <= config.max_bridge_perspective


def frame_start_ms(frame: int, fps: float) -> int:
    """Start of a frame in proxy ms: round-to-even, as ball_trajectory and possession place frames."""
    return int(round(frame * 1000 / fps))


def estimate(frames: Iterator[np.ndarray], mask: np.ndarray, scale: float, config: Config) -> Iterator[dict]:
    """One row per frame. Row 0 is the first frame; row f describes the pair f-1 -> f, in proxy pixels.

    Each frame is measured against a reference frame, started where the last motion
    predicts, and the pair is what that leaves: H(ref->f) . H(ref->f-1)^-1. Chained, the
    pairs telescope back to the reference measurements, so error accumulates once per
    reference rather than once per frame. When the reference no longer holds (too many
    corners lost, or too long ago) the frame is tracked from the one before, as a pair,
    and becomes the new reference. A pair that cannot be tracked either way is bridged
    or is a break, as before.
    """
    previous = None
    ref = ref_corners = None
    ref_index = 0
    ref_to_prev = np.eye(3)
    last_pair = np.eye(3)
    for index, frame in enumerate(frames):
        if previous is None:
            yield {"f": 0, "status": "start", "H": None, "inliers": None, "tracked": None, "residualPx": None}
            ref, ref_corners, ref_index, ref_to_prev, last_pair = frame, reference_corners(frame, mask, config), 0, np.eye(3), np.eye(3)
            previous = frame
            continue
        row: dict = {"f": index}
        from_ref = None
        if ref_corners is not None:
            from_ref = track_from_reference(ref, ref_corners, last_pair @ ref_to_prev, frame, config)
        if from_ref is not None and from_ref["h"] is not None:
            ref_to_frame = from_ref["h"]
            pair = ref_to_frame @ np.linalg.inv(ref_to_prev)
            row |= {"status": "tracked", "inliers": from_ref["inliers"], "tracked": from_ref["tracked"],
                    "residualPx": None if from_ref["residualPx"] is None else round(from_ref["residualPx"] / scale, 4)}
            stale = index - ref_index >= config.ref_max_frames or from_ref["inliers"] < config.ref_min_survival * len(ref_corners)
            if stale:
                ref, ref_corners, ref_index, ref_to_prev = frame, reference_corners(frame, mask, config), index, np.eye(3)
            else:
                ref_to_prev = ref_to_frame
        else:
            single = track_pair(previous, frame, mask, config)
            row |= {"inliers": single["inliers"], "tracked": single["tracked"],
                    "residualPx": None if single["residualPx"] is None else round(single["residualPx"] / scale, 4)}
            if single["h"] is not None:
                pair = single["h"]
                row["status"] = "tracked"
            else:
                bridged = bridge_pair(previous, frame, mask, config)
                pair = bridged
                row["status"] = "bridged" if bridged is not None else "break"
            # The reference did not hold: this frame starts the next one.
            ref, ref_corners, ref_index, ref_to_prev = frame, reference_corners(frame, mask, config), index, np.eye(3)
        row["H"] = None if pair is None else _scale_to_proxy(pair, scale)
        last_pair = np.eye(3) if pair is None else pair
        yield row
        previous = frame


def shots(rows: list[dict], fps: float, source_offset_ms: int, source_duration_ms: int, config: Config) -> list[dict]:
    """Runs of frames joined by tracked or bridged pairs, as half-open source-ms windows inside the source."""
    if not rows:
        return []
    starts = [0] + [r["f"] for r in rows[1:] if r["status"] == "break"]
    ends = starts[1:] + [len(rows)]
    out = []
    for first, end in zip(starts, ends):
        start_ms = source_offset_ms + frame_start_ms(first, fps)
        end_ms = min(source_duration_ms, source_offset_ms + frame_start_ms(end, fps))
        if end_ms - start_ms < max(config.min_shot_ms, 1):
            continue
        out.append({"startFrame": first, "endFrame": end, "startMs": start_ms, "endMs": end_ms})
    return out
