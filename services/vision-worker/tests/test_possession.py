import hashlib
import json

import pytest

from dtp_vision_worker.ball_trajectory import Smoother
from dtp_vision_worker.possession import Config, PlayerIndex, build, rows


def clock(duration=400, segments=None, offset=0):
    return Smoother(fps=25, source_offset_ms=offset, source_duration_ms=offset + duration, proxy_duration_ms=duration + 40, width=1000, height=500,
                    segments=segments if segments is not None else [{"cameraSegmentId": "live", "startMs": offset, "endMs": offset + duration, "kind": "live_play"}])


def balls(c, lost=(), changes=None):
    result = []
    trajectory = 1
    for i in range(c.frames):
        ms = c.offset + i * 40
        if i and (i - 1 in lost or (changes and i in changes)):
            trajectory += 1
        segment = c.at(ms)
        point = {"x": .11, "y": .4}
        result.append({"frameIndex": i, "sourceTimeMs": ms, "cameraSegmentId": segment["cameraSegmentId"] if segment else None,
                       "trajectoryId": None if i in lost else trajectory, "state": "lost" if i in lost else "observed", "reason": "no_detection" if i in lost else None,
                       "point": None if i in lost else point, "rawPoint": None if i in lost else point, "confidence": None if i in lost else .9})
    return result


def track(c, local_id=1, score=.8, cls="player", missing=(), x=100, confirmed=True):
    return {"localTrackId": local_id, "class": cls, "confirmed": confirmed,
            "positions": [{"frameIndex": i, "sourceTimeMs": c.offset + i * 40, "proxyTimeMs": i * 40, "confidence": score,
                           "box": {"x": x, "y": 100, "width": 20, "height": 100}} for i in range(c.frames) if i not in missing]}


def process(tmp_path, c, tracks=None, ball_rows=None, config=Config()):
    players = PlayerIndex(tmp_path / "players.sqlite", c, tracks if tracks is not None else [track(c)])
    try:
        return list(rows(c, ball_rows if ball_rows is not None else balls(c), players, config))
    finally:
        players.close()


def test_waits_for_continuity_without_backfilling_and_keeps_raw_confidence(tmp_path):
    result = process(tmp_path, clock())
    assert [r["reason"] for r in result[:5]] == ["continuity_pending"] * 5
    assert all(r["localTrackId"] is None and r["evidenceConfidence"] is None for r in result[:5])
    assert all(r["state"] == "candidate" and r["localTrackId"] == 1 and r["evidenceConfidence"] == .8 for r in result[5:])
    assert all(r["reviewState"] == "unreviewed" for r in result)


@pytest.mark.parametrize("cause", ["ball_gap", "player_gap", "camera", "switch"])
def test_never_bridges_loss_player_gaps_camera_cuts_or_player_switches(tmp_path, cause):
    segments = [{"cameraSegmentId": "a", "startMs": 0, "endMs": 280, "kind": "live_play"}, {"cameraSegmentId": "b", "startMs": 280, "endMs": 600, "kind": "live_play"}]
    c = clock(600, segments if cause == "camera" else None)
    b = balls(c, lost=(6,) if cause == "ball_gap" else (), changes=(7,) if cause == "camera" else None)
    tracks = [track(c, missing=(6,) if cause == "player_gap" else ())]
    if cause == "switch":
        tracks = [track(c, missing=range(7, c.frames)), track(c, local_id=2, missing=range(7))]
    result = process(tmp_path, c, tracks, b)
    assert result[5]["state"] == "candidate"
    assert all(r["state"] == "unknown" for r in result[7:12])
    assert result[12]["state"] == "candidate"


@pytest.mark.parametrize("scenario,reason", [("none", "no_player"), ("referee", "no_player"), ("far", "no_near_player"), ("contested", "ambiguous_players"), ("low", "weak_player"), ("unconfirmed", "weak_player"), ("goalkeeper", None)])
def test_refuses_nearest_wins_and_requires_confirmed_player_or_goalkeeper(tmp_path, scenario, reason):
    c = clock()
    tracks = [track(c)]
    if scenario == "none": tracks = []
    if scenario == "referee": tracks = [track(c, cls="referee")]
    if scenario == "far": tracks = [track(c, x=800)]
    if scenario == "contested": tracks.append(track(c, local_id=2, score=.1, x=110))
    if scenario == "low": tracks = [track(c, score=.1)]
    if scenario == "unconfirmed": tracks = [track(c, confirmed=False)]
    if scenario == "goalkeeper": tracks = [track(c, cls="goalkeeper")]
    result = process(tmp_path, c, tracks)
    assert result[-1]["reason"] == reason
    assert result[-1]["state"] == ("candidate" if reason is None else "unknown")


def test_uses_raw_ball_point_so_smoothing_cannot_create_foot_contact(tmp_path):
    c = clock()
    b = balls(c)
    for row in b: row["rawPoint"] = {"x": .8, "y": .1}
    assert all(r["reason"] == "no_near_player" for r in process(tmp_path, c, ball_rows=b))


def test_weak_ball_evidence_is_unknown_even_when_upstream_threshold_was_lowered(tmp_path):
    c = clock()
    b = balls(c)
    for row in b: row["confidence"] = .2
    assert all(r["reason"] == "weak_ball" for r in process(tmp_path, c, ball_rows=b))


@pytest.mark.parametrize("corruption", ["frame", "time", "missing", "lost_point", "reused_trajectory", "replay", "camera", "confidence", "point"])
def test_refuses_corrupt_ball_clock_nonlive_coordinates_and_missing_frames(tmp_path, corruption):
    c = clock()
    b = balls(c, lost=(1,) if corruption in {"lost_point", "reused_trajectory"} else ())
    if corruption == "frame": b[1]["frameIndex"] = 2
    if corruption == "time": b[1]["sourceTimeMs"] = 999
    if corruption == "missing": b.pop()
    if corruption == "lost_point": b[1]["point"] = {"x": .1, "y": .4}
    if corruption == "reused_trajectory": b[2]["trajectoryId"] = 1
    if corruption == "replay": c.segments[0]["kind"] = "replay"
    if corruption == "camera": b[1]["cameraSegmentId"] = "other"
    if corruption == "confidence": b[1]["confidence"] = float("nan")
    if corruption == "point": b[1]["rawPoint"]["x"] = 2
    with pytest.raises(ValueError): process(tmp_path, c, ball_rows=b)


@pytest.mark.parametrize("corruption", ["time", "order", "id", "box", "confidence"])
def test_refuses_unusable_player_evidence(tmp_path, corruption):
    c = clock()
    t = track(c)
    if corruption == "time": t["positions"][0]["sourceTimeMs"] = 1
    if corruption == "order": t["positions"][1]["frameIndex"] = 0
    if corruption == "id": t["localTrackId"] = True
    if corruption == "box": t["positions"][0]["box"]["width"] = 2000
    if corruption == "confidence": t["positions"][0]["confidence"] = float("inf")
    with pytest.raises(ValueError): process(tmp_path, c, [t])


@pytest.mark.parametrize("config", [{"minPlayerConfidence": True}, {"maxFootDistanceHeights": 0}, {"maxFootDistanceHeights": .6}, {"minContinuityMs": 0}, {"minContinuityMs": 80.5}, {"unknown": 1}])
def test_invalid_configuration_is_not_accepted(config):
    with pytest.raises(ValueError): Config.parse(config)


def test_segments_cover_exact_original_window_with_unknown_loss_and_checksum(tmp_path):
    c = clock(401, offset=9000)
    players = PlayerIndex(tmp_path / "players.sqlite", c, [track(c)])
    try:
        result = build(c, balls(c, lost=(7,)), players, tmp_path / "out")
    finally:
        players.close()
    chunks = result["chunks"]
    segments = [json.loads(line) for chunk in chunks for line in (tmp_path / "out" / chunk["file"]).read_text().splitlines()]
    assert segments[0]["startMs"] == 9000 and segments[-1]["endMs"] == 9401
    assert all(a["endMs"] == b["startMs"] for a, b in zip(segments, segments[1:]))
    assert sum(s["frames"] for s in segments) == result["frames"] == 11
    assert result["candidateFrames"] == 2 and result["unknownFrames"] == 9
    assert sum(result["reasons"].values()) == result["unknownFrames"]
    assert result["candidateFrameCoverage"] == 2 / 11
    assert result["segments"] == len(segments)
    for chunk in chunks:
        assert chunk["checksumSha256"] == hashlib.sha256((tmp_path / "out" / chunk["file"]).read_bytes()).hexdigest()


def test_empty_player_output_still_produces_explicit_unknown_segments(tmp_path):
    c = clock()
    assert all(r["reason"] == "no_player" for r in process(tmp_path, c, tracks=[]))


def test_a_short_ball_gap_holds_the_same_player_when_bridging_is_on(tmp_path):
    # docs/vision/97: the ball is often lost for a frame or two between sightings.
    c = clock(600)
    b = balls(c, lost=(6, 7))
    bridged = process(tmp_path, c, ball_rows=b, config=Config(maxBallGapMs=120))
    # The gap frames stay Unknown with no point; continuity counted from frame 0 carries on.
    assert [r["state"] for r in bridged[5:10]] == ["candidate", "unknown", "unknown", "candidate", "candidate"]
    assert bridged[6]["reason"] == bridged[7]["reason"] == "ball_lost" and bridged[6]["localTrackId"] is None
    # Without bridging the loss restarts the count, as before.
    (tmp_path / "plain").mkdir()
    plain = process(tmp_path / "plain", c, ball_rows=b)
    assert [r["state"] for r in plain[8:13]] == ["unknown"] * 5 and plain[13]["state"] == "candidate"


@pytest.mark.parametrize("cause", ["too_long", "camera", "other_player", "not_a_detector_miss"])
def test_bridging_never_spans_a_long_gap_a_cut_another_player_or_a_lost_reason_beyond_the_detector(tmp_path, cause):
    segments = [{"cameraSegmentId": "a", "startMs": 0, "endMs": 280, "kind": "live_play"}, {"cameraSegmentId": "b", "startMs": 280, "endMs": 800, "kind": "live_play"}]
    c = clock(800, segments if cause == "camera" else None)
    lost = (6, 7, 8, 9) if cause == "too_long" else (6,)
    b = balls(c, lost=lost, changes=(7,) if cause == "camera" else None)
    if cause == "not_a_detector_miss":
        b[6]["reason"] = "motion_jump"
    tracks = [track(c)]
    if cause == "other_player":
        tracks = [track(c, missing=range(7, c.frames)), track(c, local_id=2, missing=range(7))]
    result = process(tmp_path, c, tracks, b, config=Config(maxBallGapMs=120))
    after = lost[-1] + 1
    # The count restarts after the gap: five frames pending before a candidate again.
    assert all(r["state"] == "unknown" for r in result[after:after + 5])
    assert result[after + 5]["state"] == "candidate"


def test_ball_gap_configuration_is_bounded(tmp_path):
    assert Config.parse({"maxBallGapMs": 240}).maxBallGapMs == 240
    for bad in (-1, 1001, 1.5, True):
        with pytest.raises(ValueError):
            Config.parse({"maxBallGapMs": bad})
