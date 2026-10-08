"""Camera motion on synthetic video whose motion is known exactly.

A "stadium" is a large textured image; the camera is a window moved across it by a
known homography per frame. Every test compares the estimate with that truth.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from dtp_vision_worker.camera_motion import (
    Config,
    bridge_pair,
    estimate,
    frame_start_ms,
    shots,
    static_mask,
    track_pair,
    work_size,
)

W, H = 640, 360  # the "proxy" of these tests
CONFIG = Config(work_width=320)
SCALE = 320 / W


def stadium(seed: int, size=(2400, 1200)) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = cv2.GaussianBlur((rng.random((size[1], size[0])) * 255).astype(np.uint8), (0, 0), 2.5)
    # Stand-like structure: boxes and lines, so corners exist as on a real ground.
    for _ in range(400):
        x, y = int(rng.integers(0, size[0] - 40)), int(rng.integers(0, size[1] - 40))
        cv2.rectangle(img, (x, y), (x + int(rng.integers(8, 40)), y + int(rng.integers(8, 40))), int(rng.integers(0, 255)), -1)
    return img


def view(world: np.ndarray, camera: np.ndarray) -> np.ndarray:
    """The proxy frame a camera sees: world pixel -> frame pixel is `camera`."""
    return cv2.warpPerspective(world, camera, (W, H), flags=cv2.INTER_LINEAR)


def translate(dx: float, dy: float = 0.0) -> np.ndarray:
    return np.array([[1, 0, dx], [0, 1, dy], [0, 0, 1]], float)


def zoom(s: float) -> np.ndarray:
    c = np.array([[1, 0, W / 2], [0, 1, H / 2], [0, 0, 1]], float)
    return c @ np.diag([s, s, 1]) @ np.linalg.inv(c)


def small(frame: np.ndarray) -> np.ndarray:
    return cv2.resize(frame, work_size(W, H, CONFIG), interpolation=cv2.INTER_AREA)


def pan_frames(n: int, step: np.ndarray, start: np.ndarray | None = None, world: np.ndarray | None = None) -> tuple[list[np.ndarray], list[np.ndarray]]:
    world = stadium(1) if world is None else world
    cam = translate(-600, -400) if start is None else start
    cams, frames = [], []
    for _ in range(n):
        cams.append(cam.copy())
        frames.append(view(world, cam))
        cam = step @ cam
    return frames, cams


def to_proxy(h_list: list[float]) -> np.ndarray:
    return np.array(h_list, float).reshape(3, 3)


def max_error(estimated: np.ndarray, truth: np.ndarray) -> float:
    """Largest disagreement, in proxy pixels, over a grid covering the frame."""
    ys, xs = np.mgrid[20:H - 20:40, 20:W - 20:40]
    pts = np.float32(np.stack([xs.ravel(), ys.ravel()], 1))[None]
    return float(np.abs(cv2.perspectiveTransform(pts, estimated)[0] - cv2.perspectiveTransform(pts, truth)[0]).max())


def run(frames: list[np.ndarray], config: Config = CONFIG, mask: np.ndarray | None = None) -> list[dict]:
    smalls = [small(f) for f in frames]
    m = mask if mask is not None else np.full(smalls[0].shape, 255, np.uint8)
    return list(estimate(iter(smalls), m, SCALE, config))


def test_a_steady_pan_is_measured_to_a_fraction_of_a_pixel():
    frames, _ = pan_frames(12, translate(-3.5, 0.6))  # the picture moves 3.5 px left, 0.6 px down per frame
    rows = run(frames)
    assert rows[0]["status"] == "start" and rows[0]["H"] is None
    for row in rows[1:]:
        assert row["status"] == "tracked"
        assert max_error(to_proxy(row["H"]), translate(-3.5, 0.6)) < 0.5
        assert row["inliers"] >= CONFIG.min_inliers


def test_a_zoom_is_measured_as_a_zoom_not_a_pan():
    frames, _ = pan_frames(8, zoom(1.012))
    for row in run(frames)[1:]:
        assert row["status"] == "tracked"
        assert max_error(to_proxy(row["H"]), zoom(1.012)) < 0.75


def test_players_moving_on_their_own_do_not_bend_the_fit():
    frames, _ = pan_frames(10, translate(-2.0))
    rng = np.random.default_rng(5)
    blobs = rng.integers([40, 120], [W - 40, H - 20], size=(14, 2)).astype(float)
    for i, frame in enumerate(frames):
        for b in blobs:
            # Each "player" runs its own way, faster than the camera pans.
            x, y = b + np.array([7.0, -3.0]) * i * (1 if b[0] % 2 else -1)
            cv2.rectangle(frame, (int(x), int(y)), (int(x) + 10, int(y) + 26), 255, -1)
    for row in run(frames)[1:]:
        assert row["status"] == "tracked"
        assert max_error(to_proxy(row["H"]), translate(-2.0)) < 0.5


def test_a_fixed_scoreboard_graphic_is_masked_out_rather_than_read_as_a_still_camera():
    # Sampled across the clip, the camera has travelled far: only the graphic stays still.
    frames, _ = pan_frames(40, translate(-12.0))
    for f in frames:
        f[280:340, 160:480] = 30
        cv2.putText(f, "36 LION FC  VS  FC BETHEL", (170, 318), cv2.FONT_HERSHEY_SIMPLEX, 0.7, 240, 2)
    smalls = [small(f) for f in frames]
    mask, fraction = static_mask(smalls[::4], CONFIG)
    assert 0.03 < fraction < 0.2
    # Inside the graphic nothing is tracked; outside, everything may be.
    assert mask[150, 160] == 0 and mask[40, 40] == 255
    for row in estimate(iter(smalls), mask, SCALE, CONFIG):
        if row["f"]:
            # Read as a still camera, every pair would be 12 px out; each is within a pixel.
            assert max_error(to_proxy(row["H"]), translate(-12.0)) < 1.0


def test_a_long_noisy_pan_drifts_far_less_measured_against_a_reference_than_chained_pair_by_pair():
    # 150 frames of a pan with sensor noise: what matters is the error the chain carries
    # to the last frame, which is what a keyframe's calibration rides on.
    rng = np.random.default_rng(3)
    frames, cams = pan_frames(150, translate(-2.3, 0.4))
    noisy = [np.clip(f.astype(np.int16) + rng.normal(0, 6, f.shape).astype(np.int16), 0, 255).astype(np.uint8) for f in frames]
    smalls = [small(f) for f in noisy]
    open_mask = np.full(smalls[0].shape, 255, np.uint8)
    truth = cams[-1] @ np.linalg.inv(cams[0])

    chained = np.eye(3)
    for row in estimate(iter(smalls), open_mask, SCALE, CONFIG):
        if row["f"]:
            assert row["status"] == "tracked"
            chained = to_proxy(row["H"]) @ chained
    pairwise = np.eye(3)
    for a, b in zip(smalls, smalls[1:]):
        h = track_pair(a, b, open_mask, CONFIG)["h"]
        s_ = np.diag([SCALE, SCALE, 1.0])
        pairwise = (np.linalg.inv(s_) @ h @ s_) @ pairwise
    with_reference, pair_by_pair = max_error(chained, truth), max_error(pairwise, truth)
    assert with_reference < 1.5
    assert with_reference < pair_by_pair


def test_a_still_camera_is_not_masked_into_having_nothing_to_track():
    # A fixed tactical camera: every pixel but the players is "static". That is not an
    # overlay, and masking it would break every pair of a clip that is the easy case.
    frames, _ = pan_frames(30, translate(0.0))
    smalls = [small(f) for f in frames]
    mask, fraction = static_mask(smalls[::3], CONFIG)
    assert fraction == 0.0 and mask.min() == 255
    for row in estimate(iter(smalls), mask, SCALE, CONFIG):
        if row["f"]:
            assert row["status"] == "tracked" and max_error(to_proxy(row["H"]), np.eye(3)) < 0.3


def test_an_edit_cut_is_a_break_and_no_motion_is_invented_across_it():
    first, _ = pan_frames(6, translate(-2.0))
    second, _ = pan_frames(6, translate(2.0), world=stadium(99))
    rows = run(first + second)
    assert [r["status"] for r in rows] == ["start"] + ["tracked"] * 5 + ["break"] + ["tracked"] * 5
    assert rows[6]["H"] is None


def test_a_whip_pan_too_fast_to_follow_is_bridged_not_mistaken_for_a_cut():
    frames, _ = pan_frames(3, translate(-2.0))
    jump, _ = pan_frames(3, translate(-2.0), start=translate(-130, 0) @ translate(-600, -400) @ np.linalg.matrix_power(translate(-2.0), 3))
    rows = run(frames + jump)
    statuses = [r["status"] for r in rows]
    assert statuses[3] in ("tracked", "bridged") and "break" not in statuses
    assert max_error(to_proxy(rows[3]["H"]), translate(-132.0)) < 1.5


def test_a_cut_to_a_closer_shot_of_the_same_ground_is_a_break_not_a_bridge():
    # The pilot's cuts: a wide shot, then a closer one of the same stadium. Matched
    # directly they agree, with a 17-43% zoom no camera makes in one frame.
    frames, _ = pan_frames(4, translate(-2.0))
    closer, _ = pan_frames(4, translate(-2.0), start=zoom(1.25) @ translate(-606, -400))
    rows = run(frames + closer)
    assert [r["status"] for r in rows] == ["start", "tracked", "tracked", "tracked", "break", "tracked", "tracked", "tracked"]


def test_a_bridge_refuses_a_sideways_jump_no_camera_makes_in_one_frame():
    # Same zoom, overlapping views, 40% of the frame apart: it matches, and it is a
    # translation, so only the shift limit stands between it and a false bridge. On a
    # real ground this is what repeated advertising boards produce.
    a = small(pan_frames(1, translate(0))[0][0])
    b = small(pan_frames(1, translate(0), start=translate(-600 - 0.4 * W, -400))[0][0])
    mask = np.full(a.shape, 255, np.uint8)
    assert bridge_pair(a, b, mask, CONFIG) is None
    # The same pair a little closer, inside the limit, does bridge: the limit is what refused it.
    c = small(pan_frames(1, translate(0), start=translate(-600 - 0.2 * W, -400))[0][0])
    assert bridge_pair(a, c, mask, CONFIG) is not None


def test_a_bridge_refuses_a_match_that_would_jump_the_frame_across_the_ground():
    a = small(pan_frames(1, translate(0))[0][0])
    b = small(pan_frames(1, translate(0), start=translate(-600 - 900, -400))[0][0])
    assert bridge_pair(a, b, np.full(a.shape, 255, np.uint8), CONFIG) is None


def test_a_featureless_frame_is_a_break():
    frames, _ = pan_frames(3, translate(-2.0))
    blank = np.full((H, W), 90, np.uint8)
    rows = run(frames + [blank])
    assert rows[3]["status"] == "break" and rows[3]["H"] is None
    assert track_pair(small(blank), small(blank), np.full(small(blank).shape, 255, np.uint8), CONFIG)["h"] is None


def test_shots_are_half_open_source_windows_inside_the_source():
    rows = [{"f": 0, "status": "start"}] + [{"f": i, "status": "break" if i in (50, 52) else "tracked"} for i in range(1, 100)]
    found = shots(rows, 25, 1000, 1000 + 3960, CONFIG)
    # 0..49 is a shot; 50..51 is a 2-frame transition, dropped; 52..99 runs to the source's end.
    assert found == [
        {"startFrame": 0, "endFrame": 50, "startMs": 1000, "endMs": 3000},
        {"startFrame": 52, "endFrame": 100, "startMs": 3080, "endMs": 4960},
    ]
    assert frame_start_ms(1, 25) == 40 and frame_start_ms(3, 30) == 100


def test_config_takes_only_known_bounded_whole_numbers():
    assert Config.parse(None) == Config()
    assert Config.parse({"minInliers": 50, "minShotMs": 0}).min_inliers == 50
    for bad in ({"minInliers": 2}, {"minInliers": True}, {"minShotMs": 1.5}, {"other": 1}, []):
        with pytest.raises(ValueError):
            Config.parse(bad)


def test_work_size_keeps_the_aspect_and_never_enlarges():
    assert work_size(1280, 720, Config()) == (640, 360)
    assert work_size(320, 180, Config()) == (320, 180)
    with pytest.raises(ValueError):
        work_size(0, 720, Config())
