"""Linking, against cases worked out by hand.

Each case is the smallest footage that tells one behaviour from its absence: a
player crossing the frame tells constant-velocity prediction from last-position
matching; a ball missing for ten frames tells max-age survival from a cut; a box
that appears once tells min-hits from writing noise.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from dtp_vision_worker.tracking import Params, Track, Observation, iou, main, record, track


def frame(index: int, *dets: tuple[str, float, tuple[float, float, float, float]], fps: int = 25) -> dict:
    ms = int(round(index / fps * 1000))
    return {
        "frameIndex": index,
        "proxyTimeMs": ms,
        "sourceTimeMs": ms + 9000,
        "detections": [{"class": c, "confidence": conf, "box": {"x": b[0], "y": b[1], "width": b[2], "height": b[3]}} for c, conf, b in dets],
    }


def moving(cls: str, x0: float, dx: float, n: int, conf: float = 0.9, y: float = 100, size=(40.0, 80.0)):
    """A box of `cls` starting at x0 and moving dx per frame for n frames."""
    return [(cls, conf, (x0 + dx * i, y, size[0], size[1])) for i in range(n)]


def test_iou_by_hand() -> None:
    assert iou((0, 0, 2, 2), (1, 1, 2, 2)) == pytest.approx(1 / 7)
    assert iou((0, 0, 2, 2), (0, 0, 2, 2)) == pytest.approx(1.0)
    assert iou((0, 0, 1, 1), (5, 5, 1, 1)) == 0.0


def test_a_static_player_is_one_track() -> None:
    frames = [frame(i, ("player", 0.9, (100, 100, 40, 80))) for i in range(10)]
    tracks, stats = track(frames)
    assert len(tracks) == 1
    assert tracks[0].hits == 10
    assert stats["tracks"] == 1
    assert stats["tracksByClass"] == {"player": 1}
    assert stats["detectionsLinked"] == 10
    assert stats["detectionsUnlinked"] == 0


def test_a_fast_player_is_followed_by_constant_velocity() -> None:
    """Moving half its width every frame (500px/s at 25fps -- a sprint). The first
    step overlaps by a third, enough to link; from then on the prediction lands on
    the next box exactly, where last-position matching would overlap by a third
    every frame and lose him at the first wobble."""
    path = moving("player", 0, 20, 12)
    frames = [frame(i, d) for i, d in enumerate(path)]
    tracks, _ = track(frames)
    assert len(tracks) == 1
    assert tracks[0].hits == 12
    # The prediction after two sightings is the next box itself.
    assert tracks[0].predict(2) == (40.0, 100.0, 40.0, 80.0)


def test_two_players_crossing_keep_their_identities() -> None:
    """One walks right, one walks left; at the crossing both boxes overlap both
    tracks. Prediction says which is which."""
    right = moving("player", 0, 10, 20, y=100)
    left = moving("player", 190, -10, 20, y=100)
    frames = [frame(i, right[i], left[i]) for i in range(20)]
    tracks, _ = track(frames)
    assert len(tracks) == 2
    xs = [t.observations[-1].box[0] for t in sorted(tracks, key=lambda t: t.local_id)]
    # Track 1 started at x=0 and must end on the right; track 2 the reverse.
    assert xs[0] > xs[1]


def test_a_gap_shorter_than_max_age_is_one_track_with_a_gap() -> None:
    """The ball goes behind a player for ten frames. The track survives, and the
    ten frames are absent from its positions rather than filled in."""
    seen = [frame(i, ("ball", 0.8, (300, 200, 10, 10))) for i in range(10)]
    gap = [frame(i) for i in range(10, 20)]
    again = [frame(i, ("ball", 0.8, (300, 200, 10, 10))) for i in range(20, 30)]
    tracks, _ = track(seen + gap + again)
    assert len(tracks) == 1
    assert tracks[0].hits == 20
    frames_seen = [o.frame for o in tracks[0].observations]
    assert 15 not in frames_seen
    assert frames_seen == list(range(10)) + list(range(20, 30))


def test_a_gap_longer_than_max_age_ends_the_track_and_starts_another() -> None:
    seen = [frame(i, ("ball", 0.8, (300, 200, 10, 10))) for i in range(10)]
    gap = [frame(i) for i in range(10, 50)]
    again = [frame(i, ("ball", 0.8, (300, 200, 10, 10))) for i in range(50, 60)]
    tracks, _ = track(seen + gap + again, Params(max_age_ms=1200))
    assert [t.local_id for t in tracks] == [1, 2]


def test_a_box_seen_once_is_noise_and_not_written() -> None:
    frames = [frame(i, ("player", 0.9, (100, 100, 40, 80))) for i in range(10)]
    frames[4]["detections"].append({"class": "player", "confidence": 0.9, "box": {"x": 600, "y": 300, "width": 40, "height": 80}})
    tracks, stats = track(frames)
    assert len(tracks) == 1
    assert stats["detectionsUnlinked"] == 1
    assert stats["detectionsLinked"] == 10


def test_a_ball_track_never_absorbs_a_player_box() -> None:
    """Same place, different class: two tracks, and when the ball is missing for a
    frame its track must go hungry rather than take the player's box. The ball is
    listed first so a class-blind matcher would hand it the player (lower track id
    wins the tie), which is what this test exists to catch."""
    frames = [frame(i, ("ball", 0.9, (100, 100, 40, 80)), ("player", 0.9, (100, 100, 40, 80))) for i in range(6)]
    frames[2] = frame(2, ("player", 0.9, (100, 100, 40, 80)))
    tracks, stats = track(frames)
    assert stats["tracksByClass"] == {"player": 1, "ball": 1}
    assert all(all(o.cls == t.cls for o in t.observations) for t in tracks)
    by_class = {t.cls: t for t in tracks}
    assert by_class["ball"].hits == 5
    assert by_class["player"].hits == 6


def test_a_dip_in_confidence_keeps_the_track_but_cannot_start_one() -> None:
    """Round two: a weak box where the track already was is kept; a weak box with
    no track near it is not a track."""
    frames = [frame(i, ("player", 0.9 if i not in (3, 4) else 0.2, (100, 100, 40, 80))) for i in range(8)]
    frames[6]["detections"].append({"class": "player", "confidence": 0.2, "box": {"x": 500, "y": 300, "width": 40, "height": 80}})
    tracks, stats = track(frames)
    assert len(tracks) == 1
    assert tracks[0].hits == 8
    assert stats["detectionsUnlinked"] == 0  # the lone weak box was never a candidate


def test_boxes_below_the_floor_are_ignored() -> None:
    frames = [frame(i, ("player", 0.05, (100, 100, 40, 80))) for i in range(8)]
    tracks, stats = track(frames)
    assert tracks == []
    assert stats["detectionsLinked"] == 0


def test_two_candidates_for_one_track_take_the_better_overlap() -> None:
    frames = [frame(i, ("player", 0.9, (100, 100, 40, 80))) for i in range(3)]
    frames.append(frame(3, ("player", 0.9, (102, 100, 40, 80)), ("player", 0.9, (120, 100, 40, 80))))
    frames += [frame(i, ("player", 0.9, (104 + (i - 4) * 2, 100, 40, 80))) for i in range(4, 8)]
    tracks, _ = track(frames)
    main_track = max(tracks, key=lambda t: t.hits)
    assert main_track.observations[3].box[0] == 102


def test_the_record_carries_both_clocks_and_only_observed_positions() -> None:
    frames = [frame(i, ("player", 0.9, (100, 100, 40, 80))) for i in (0, 1, 2, 5)]
    tracks, _ = track(frames)
    r = record(tracks[0])
    assert r["startFrame"] == 0 and r["endFrame"] == 5
    assert r["startMs"] == 9000 and r["endMs"] == 9200
    assert r["detectionCount"] == 4
    assert [p["frameIndex"] for p in r["positions"]] == [0, 1, 2, 5]
    assert r["positions"][0]["sourceTimeMs"] == 9000 and r["positions"][0]["proxyTimeMs"] == 0


def test_prediction_falls_back_to_the_last_box_with_one_sighting() -> None:
    t = Track(local_id=1, cls="player", observations=[Observation(0, 0, 0, "player", 0.9, (1, 2, 3, 4))])
    assert t.predict(5) == (1, 2, 3, 4)


def test_frames_are_processed_in_frame_order_however_listed() -> None:
    frames = [frame(i, ("player", 0.9, (100 + i * 5, 100, 40, 80))) for i in range(6)]
    tracks, _ = track(list(reversed(frames)))
    assert len(tracks) == 1
    assert [o.frame for o in tracks[0].observations] == list(range(6))


def test_the_cli_refuses_sparse_detections_and_links_dense_ones(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    sparse = tmp_path / "sparse.json"
    sparse.write_text(json.dumps({"sampleFps": 2, "frames": []}), encoding="utf-8")
    assert main(["--detections", str(sparse)]) == 2
    assert "tracking needs at least 10" in capsys.readouterr().err

    dense = tmp_path / "dense.json"
    dense.write_text(json.dumps({"sampleFps": 25, "frames": [frame(i, ("player", 0.9, (100, 100, 40, 80))) for i in range(5)]}), encoding="utf-8")
    out = tmp_path / "tracks.json"
    assert main(["--detections", str(dense), "--out", str(out)]) == 0
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["tracks"][0]["detectionCount"] == 5
    assert written["summaryRows"][0]["localTrackId"] == 1
    assert "positions" not in written["summaryRows"][0]


# ── ageing by time, and camera cuts (docs/vision/56) ─────────────────────────


def test_a_track_ages_by_the_clock_not_by_a_count_of_frames() -> None:
    """The same player lost for the same two seconds is the same outcome at 25 fps and at 10.
    Counted in frames, thirty frames was 1.2 s at one rate and three seconds at the other."""
    from dtp_vision_worker.tracking import Linker

    def run(fps: int, gap_seconds: float) -> int:
        seen_for = fps  # one second of sightings
        gap = round(gap_seconds * fps)
        frames = [frame(i, ("player", 0.9, (100, 100, 40, 80)), fps=fps) for i in range(seen_for)]
        frames += [frame(i, fps=fps) for i in range(seen_for, seen_for + gap)]
        frames += [frame(i, ("player", 0.9, (100, 100, 40, 80)), fps=fps) for i in range(seen_for + gap, seen_for + gap + fps)]
        return len(track(frames)[0])

    assert Params().max_age_ms == 1200 and Params().as_dict()["maxAgeMs"] == 1200
    # Half a second unseen: one track, at either rate.
    assert run(25, 0.5) == 1 and run(10, 0.5) == 1
    # Two seconds unseen: the track has ended and another begins, at either rate.
    assert run(25, 2.0) == 2 and run(10, 2.0) == 2
    # At ten frames a second, two seconds is twenty frames: fewer than the old thirty, which kept it alive.
    assert round(2.0 * 10) < 30
    assert isinstance(Linker().stats()["params"]["maxAgeMs"], int)


def test_the_boundary_of_the_age_is_the_millisecond() -> None:
    def gap_of(ms: int) -> int:
        frames = [
            {"frameIndex": i, "proxyTimeMs": i * 40, "sourceTimeMs": i * 40, "detections": [{"class": "player", "confidence": 0.9, "box": {"x": 100, "y": 100, "width": 40, "height": 80}}]}
            for i in range(5)
        ]
        resume = 4 * 40 + ms
        frames += [
            {"frameIndex": 100 + i, "proxyTimeMs": resume + i * 40, "sourceTimeMs": resume + i * 40, "detections": [{"class": "player", "confidence": 0.9, "box": {"x": 100, "y": 100, "width": 40, "height": 80}}]}
            for i in range(5)
        ]
        return len(track(frames)[0])

    assert gap_of(1200) == 1
    assert gap_of(1201) == 2


def test_tracks_end_at_a_camera_cut_however_well_the_boxes_overlap() -> None:
    """A player in the same place on both sides of a cut is two tracks: the second box is
    another camera's picture."""
    frames = [frame(i, ("player", 0.9, (100, 100, 40, 80))) for i in range(20)]
    cut_ms = frames[10]["sourceTimeMs"]
    uncut, _ = track(frames)
    assert len(uncut) == 1
    tracks, stats = track(frames, cuts_ms=[cut_ms])
    assert [(t.observations[0].frame, t.last.frame) for t in tracks] == [(0, 9), (10, 19)]
    assert stats["cuts"] == 1 and stats["tracksEndedAtCuts"] == 1
    # The frame on the cut is the new camera's: half-open, like the segments.
    assert tracks[1].observations[0].source_ms == cut_ms


def test_a_cut_between_frames_before_the_first_or_after_the_last_ends_nothing_it_should_not() -> None:
    frames = [frame(i, ("player", 0.9, (100, 100, 40, 80))) for i in range(20)]
    first, last = frames[0]["sourceTimeMs"], frames[-1]["sourceTimeMs"]
    # Before or on the first frame: nothing is alive to end.
    assert len(track(frames, cuts_ms=[0, first])[0]) == 1
    # After the last frame: never reached.
    assert len(track(frames, cuts_ms=[last + 1])[0]) == 1
    # Between two frames: the next frame is the new camera's.
    between = frames[5]["sourceTimeMs"] + 1
    tracks, stats = track(frames, cuts_ms=[between])
    assert [(t.observations[0].frame, t.last.frame) for t in tracks] == [(0, 5), (6, 19)]
    # Two cuts crossed between the same two frames end the tracks once.
    twice, stats = track(frames, cuts_ms=[between, between + 2, between])
    assert len(twice) == 2 and stats["tracksEndedAtCuts"] == 1 and stats["cuts"] == 2


def test_a_track_too_short_to_keep_that_ends_at_a_cut_is_noise() -> None:
    frames = [frame(i, ("player", 0.9, (100, 100, 40, 80))) for i in range(12)]
    # Two sightings, then the cut: under min_hits, so dropped and counted.
    tracks, stats = track(frames, cuts_ms=[frames[2]["sourceTimeMs"]])
    assert [(t.observations[0].frame, t.last.frame) for t in tracks] == [(2, 11)]
    assert stats["detectionsUnlinked"] == 2 and stats["detectionsLinked"] == 10
    assert [t.local_id for t in tracks] == [2]


def test_the_linker_yields_each_track_when_it_ends_and_agrees_with_track() -> None:
    from dtp_vision_worker.tracking import Linker

    frames = [frame(i, ("player", 0.9, (100, 100, 40, 80)), ("ball", 0.8, (300, 200, 10, 10))) for i in range(10)]
    frames += [frame(i, ("player", 0.9, (100, 100, 40, 80))) for i in range(10, 60)]  # the ball is gone
    linker = Linker()
    ended_on: dict[int, int] = {}
    streamed = []
    for f in frames:
        for t in linker.feed(f):
            ended_on[t.local_id] = f["frameIndex"]
            streamed.append(t)
    # The ball was last seen on frame 9 (360 ms). It is given back on the first frame more than 1.2 s later.
    assert ended_on == {2: 40}
    streamed += linker.close()
    whole, stats = track(frames)
    assert sorted(record(t)["localTrackId"] for t in streamed) == [record(t)["localTrackId"] for t in whole]
    assert sorted((record(t) for t in streamed), key=lambda r: r["localTrackId"]) == [record(t) for t in whole]
    assert linker.stats() == stats
    assert linker.frames == [(f["frameIndex"], f["sourceTimeMs"]) for f in frames]
    assert stats["framesTracked"] == 60


def test_the_linker_refuses_frames_out_of_order() -> None:
    from dtp_vision_worker.tracking import Linker

    linker = Linker()
    linker.feed(frame(3))
    with pytest.raises(ValueError, match="frame order"):
        linker.feed(frame(3))
    with pytest.raises(ValueError, match="frame order"):
        linker.feed(frame(1))


def test_the_cli_takes_cuts_and_writes_the_tracked_frames(tmp_path: Path) -> None:
    frames = [frame(i, ("player", 0.9, (100, 100, 40, 80))) for i in range(12)]
    dense = tmp_path / "dense.json"
    dense.write_text(json.dumps({"sampleFps": 25, "frames": frames}), encoding="utf-8")
    out = tmp_path / "tracks.json"
    assert main(["--detections", str(dense), "--out", str(out), "--cuts", str(frames[6]["sourceTimeMs"])]) == 0
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["trackCount"] == 2 and written["tracksEndedAtCuts"] == 1
    assert written["trackedFrames"] == [[f["frameIndex"], f["sourceTimeMs"]] for f in frames]
