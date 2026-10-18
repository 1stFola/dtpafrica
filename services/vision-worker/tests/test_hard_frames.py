import pytest

from dtp_vision_worker.hard_frames import attach_boxes, boxes_of, choose


def ball_row(f, state="observed", reason=None, camera="cam"):
    return {"frameIndex": f, "sourceTimeMs": f * 40, "cameraSegmentId": camera, "state": state, "reason": reason}


def frame(f, balls=(), players=1):
    dets = [{"class": "player", "box": {"x": 100 + 10 * i, "y": 200, "width": 20, "height": 60}, "confidence": 0.9} for i in range(players)]
    dets += [{"class": "ball", "box": {"x": 600, "y": 300, "width": 10, "height": 10}, "confidence": c, **({"source": s} if s else {})} for c, s in balls]
    return {"frameIndex": f, "sourceTimeMs": f * 40, "detections": dets}


def clip():
    """100 frames: the ball seen 0-39, missed 40-44, seen 45-99; a weak ball at 60, a tiles-only ball at 80."""
    rows, frames = [], []
    for f in range(100):
        missed = 40 <= f <= 44
        rows.append(ball_row(f, "lost" if missed else "observed", "no_detection" if missed else None))
        balls = [] if missed else [(0.9, None)]
        if f == 60: balls = [(0.35, None)]
        if f == 80: balls = [(0.8, "ball_tiles")]
        frames.append(frame(f, balls))
    return rows, frames


def test_ranks_a_missed_ball_first_then_a_weak_one_then_a_tile_only_one():
    rows, frames = clip()
    picks = choose(frames, rows, max_frames=3, random_share=0, min_gap_ms=0)
    assert [(p["frameIndex"], p["cause"], p["reason"]) for p in picks] == [
        (40, "ball_missed_between_sightings", "stage_disagreement"),
        (41, "ball_missed_between_sightings", "stage_disagreement"),
        (42, "ball_missed_between_sightings", "stage_disagreement"),
    ]
    # Spread out, one pick per moment: the misses collapse to one, then the weak ball and the tile-only one.
    spread = choose(frames, rows, max_frames=3, random_share=0, min_gap_ms=400)
    assert [(p["frameIndex"], p["cause"]) for p in spread] == [(40, "ball_missed_between_sightings"), (60, "ball_low_confidence"), (80, "tile_only_ball")]


def test_mixes_in_ordinary_play_with_a_seeded_draw():
    rows, frames = clip()
    a = choose(frames, rows, max_frames=6, random_share=0.5, min_gap_ms=400, seed="s1")
    assert sum(p["cause"] == "random_live_play" for p in a) == 3 and sum(p["cause"] != "random_live_play" for p in a) == 3
    assert all(p["reason"] == "uniform_random" and p["score"] < 0.5 for p in a if p["cause"] == "random_live_play")
    assert a == choose(frames, rows, max_frames=6, random_share=0.5, min_gap_ms=400, seed="s1")
    assert a != choose(frames, rows, max_frames=6, random_share=0.5, min_gap_ms=400, seed="s2")


def test_random_play_keeps_its_share_when_the_clip_is_too_short_for_max_frames():
    rows, frames = clip()
    for f in range(0, 100, 2):  # a weak ball every other frame: hard frames everywhere
        if not 40 <= f <= 44:
            frames[f] = frame(f, [(0.35, None)])
    picks = choose(frames, rows, max_frames=50, random_share=1 / 3, min_gap_ms=400, seed="s1")
    randoms = sum(p["cause"] == "random_live_play" for p in picks)
    assert len(picks) < 50 and randoms == round(len(picks) / 3)
    times = sorted(p["sourceTimeMs"] for p in picks)
    assert all(b - a >= 400 for a, b in zip(times, times[1:]))
    # The best-ranked hard frame is never displaced by a random one.
    assert any(p["frameIndex"] == 40 for p in picks)


def test_a_miss_needs_the_ball_on_both_sides_in_the_same_camera_and_never_picks_non_play():
    rows, frames = clip()
    for f in range(45, 53):  # after the miss, a different camera
        rows[f]["cameraSegmentId"] = "other"
    for f in range(90, 100):
        rows[f] = ball_row(f, "lost", "non_play")
    picks = choose(frames, rows, max_frames=50, random_share=1, min_gap_ms=0)
    assert not any(p["cause"] == "ball_missed_between_sightings" for p in picks)
    assert not any(p["frameIndex"] >= 90 for p in picks)


def test_boxes_become_annotation_geometry_with_the_ball_first():
    f = frame(7, balls=[(0.6, "ball_tiles")], players=2)
    boxes = boxes_of(f, 1280, 720)
    assert boxes[0] == {"class": "ball", "x": 0.46875, "y": 0.416667, "width": 0.007812, "height": 0.013889, "confidence": 0.6, "source": "ball_tiles"}
    assert [b["class"] for b in boxes] == ["ball", "player", "player"]
    # Clipped to the frame; nothing outside it, nothing malformed.
    edge = {"frameIndex": 1, "detections": [{"class": "player", "box": {"x": 1270, "y": 700, "width": 40, "height": 40}, "confidence": 0.9},
                                            {"class": "car", "box": {"x": 1, "y": 1, "width": 5, "height": 5}, "confidence": 0.9},
                                            {"class": "ball", "box": {"x": 1, "y": 1, "width": 0, "height": 5}, "confidence": 0.9}]}
    [only] = boxes_of(edge, 1280, 720)
    assert only["x"] + only["width"] <= 1 and only["y"] + only["height"] <= 1
    picks = attach_boxes([f], [{"frameIndex": 7, "sourceTimeMs": 280, "cause": "tile_only_ball"}], width=1280, height=720)
    assert picks[0]["boxes"] == boxes


def test_refuses_out_of_range_settings():
    rows, frames = clip()
    for bad in ({"max_frames": 0}, {"max_frames": 501}, {"random_share": 1.5}, {"min_gap_ms": -1}):
        with pytest.raises(ValueError):
            choose(frames, rows, **bad)
