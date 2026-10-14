import numpy as np

from dtp_vision_worker.paint_check import MIN_SAMPLES, check, markings


def picture_distance(h, uv_paint, shape=(720, 1280)):
    """A distance map with paint exactly where the given pixels are."""
    import cv2

    paint = np.zeros(shape, np.uint8)
    for u, v in uv_paint:
        if 0 <= u < shape[1] and 0 <= v < shape[0]:
            paint[int(v), int(u)] = 1
    return cv2.distanceTransform(1 - paint, cv2.DIST_L2, 3)


# Pitch metres -> pixels: 10 px a metre, the pitch from (100, 200).
TO_PIXEL = np.array([[10.0, 0, 100], [0, 6.0, 200], [0, 0, 1]])
PITCH = {"lengthM": 105, "widthM": 68}


def drawn(shift=0.0):
    q = np.c_[markings(105, 68, 0.1), np.ones(len(markings(105, 68, 0.1)))] @ TO_PIXEL.T
    return [(u + shift, v) for u, v in q[:, :2]]


def test_lines_on_the_paint_pass_and_a_shifted_view_fails():
    H = list(np.linalg.inv(TO_PIXEL).ravel())
    assert check(picture_distance(None, drawn()), H, PITCH)["verdict"] == "on_paint"
    # A one-pixel error is the fit's own noise, not drift.
    assert check(picture_distance(None, drawn(1)), H, PITCH)["verdict"] == "on_paint"
    off = check(picture_distance(None, drawn(20)), H, PITCH)
    assert off["verdict"] == "off_paint" and off["onPaint"] < 0.5 and off["medianPx"] > 2


def test_too_little_in_view_is_not_judged():
    # The pitch drawn far outside the picture: nothing to compare, so the frame keeps its calibration.
    far = np.array([[10.0, 0, 5000], [0, 6.0, 200], [0, 0, 1]])
    out = check(picture_distance(None, []), list(np.linalg.inv(far).ravel()), PITCH)
    assert out["verdict"] == "unjudged" and out["samples"] < MIN_SAMPLES
