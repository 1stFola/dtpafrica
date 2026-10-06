import pytest

from dtp_vision_worker.possession import PlayerIndex, build, rows
from dtp_vision_worker.possession_constraints import Constraints, FootballConfig
from test_possession import balls, clock, track


def snapshot(c, quality="good", h=None, width=1000, height=500):
    return {"proxyWidth": width, "proxyHeight": height, "proxyVariantId": "proxy", "proxyKey": "proxy.mp4", "proxyChecksum": "b" * 64,
            "segments": [{"cameraSegmentId": s["cameraSegmentId"], "startMs": s["startMs"], "endMs": s["endMs"],
                          "calibrationId": "cal-" + s["cameraSegmentId"] if quality else None, "quality": quality, "thresholdsVersion": "provisional/v1" if quality else None,
                          "homography": (h or [.1, 0, 0, 0, .1, 0, 0, 0, 1]) if quality in {"good", "usable"} else None,
                          "pitch": {"lengthM": 105, "widthM": 68} if quality in {"good", "usable"} else None} for s in c.segments]}


def process(tmp_path, c, declaration=None, b=None, t=None):
    constraints = Constraints(c, declaration or snapshot(c))
    players = PlayerIndex(tmp_path / "p.sqlite", c, [t or track(c)])
    try:
        return list(rows(c, b or balls(c), players, constraints=constraints))
    finally:
        players.close()


@pytest.mark.parametrize("quality", [None, "failed"])
def test_missing_or_failed_calibration_is_unknown_without_fallback(tmp_path, quality):
    c = clock()
    result = process(tmp_path, c, snapshot(c, quality))
    assert all(r["reason"] == "calibration_unavailable" and r["localTrackId"] is None and r["evidenceConfidence"] is None for r in result)


@pytest.mark.parametrize("quality", ["good", "usable"])
def test_passing_calibration_preserves_continuity_and_unreviewed_status(tmp_path, quality):
    c = clock()
    result = process(tmp_path, c, snapshot(c, quality))
    assert all(r["reason"] == "continuity_pending" for r in result[:5])
    assert all(r["state"] == "candidate" and r["reviewState"] == "unreviewed" for r in result[5:])
    assert all("ballHeightM" not in r and "possessionProbability" not in r for r in result)


@pytest.mark.parametrize("h,reason", [([.1, 0, 0, 0, .1, 0, 0, 0, -1], "projection_invalid"), ([1, 0, 0, 0, 1, 0, 0, 0, 1], "off_pitch")])
def test_horizon_and_off_pitch_are_suppressed(tmp_path, h, reason):
    c = clock()
    assert all(r["reason"] == reason for r in process(tmp_path, c, snapshot(c, h=h)))


def test_ground_distance_is_a_veto_even_when_image_proximity_passes(tmp_path):
    c = clock()
    b = balls(c)
    for row in b: row["rawPoint"]["x"] = .134  # 24 px; within .25 body heights, but 2.4 m
    assert all(r["reason"] == "metric_distance" for r in process(tmp_path, c, b=b))


def test_detector_pixels_are_scaled_to_declared_proxy_pixels(tmp_path):
    c = clock()
    b = balls(c)
    for row in b: row["rawPoint"]["x"] = .134
    # 500 px proxy: 24 detector pixels become 12 proxy pixels -> 1.2m, not 2.4m.
    assert process(tmp_path, c, snapshot(c, width=500, height=250), b=b)[-1]["state"] == "candidate"


@pytest.mark.parametrize("moving", ["ball", "player"])
def test_motion_jump_restarts_continuity_without_backfilling(tmp_path, moving):
    c = clock(800)
    b, t = balls(c), track(c)
    for i in range(7, c.frames):
        b[i]["rawPoint"] = {"x": .127 if moving == "ball" else .122, "y": .4}
        if moving == "player": t["positions"][i]["box"]["x"] += 12
    result = process(tmp_path, c, b=b, t=t)
    assert result[6]["state"] == "candidate" and result[7]["reason"] == "implausible_motion"
    assert all(r["state"] == "unknown" for r in result[8:13])
    assert result[13]["state"] == "candidate"


def test_camera_change_does_not_compare_coordinates_across_homographies(tmp_path):
    c = clock(800, [{"cameraSegmentId": "a", "startMs": 0, "endMs": 280, "kind": "live_play"}, {"cameraSegmentId": "b", "startMs": 280, "endMs": 800, "kind": "live_play"}])
    declared = snapshot(c)
    declared["segments"][1]["homography"][2] = 50
    result = process(tmp_path, c, declared, b=balls(c, changes=(7,)))
    assert result[6]["state"] == "candidate"
    assert all(r["reason"] == "continuity_pending" for r in result[7:12])
    assert result[12]["state"] == "candidate"


@pytest.mark.parametrize("config", [{"maxGroundDistanceM": True}, {"maxGroundDistanceM": 0}, {"maxBallGroundSpeedMps": float("nan")}, {"maxPlayerSpeedMps": 99}, {"extra": 1}])
def test_invalid_football_limits_are_refused(config):
    with pytest.raises(ValueError): FootballConfig.parse(config)


@pytest.mark.parametrize("change", ["camera", "dimensions", "matrix", "pitch", "identity", "quality", "singular"])
def test_malformed_calibration_refuses_instead_of_implying_accuracy(change):
    c = clock()
    declared = snapshot(c)
    row = declared["segments"][0]
    if change == "camera": row["cameraSegmentId"] = "other"
    if change == "dimensions": declared["proxyWidth"] = None
    if change == "matrix": row["homography"][0] = float("inf")
    if change == "pitch": row["pitch"]["widthM"] = 0
    if change == "identity": row["calibrationId"] = None
    if change == "quality": row["quality"] = "assumed"
    if change == "singular": row["homography"] = [0]*8+[1]
    with pytest.raises(ValueError): Constraints(c, declared)


def test_artifact_pins_calibration_and_configuration_without_writing_pitch_metrics(tmp_path):
    c = clock()
    declaration = snapshot(c)
    constraints = Constraints(c, declaration)
    players = PlayerIndex(tmp_path / "p.sqlite", c, [track(c)])
    try: result = build(c, balls(c), players, tmp_path / "out", constraints=constraints)
    finally: players.close()
    assert result["calculationVersion"] == "possession-candidates/v2"
    assert result["calibrationSnapshot"] == declaration and result["footballConfig"]["maxGroundDistanceM"] == 2
    assert result["candidateFrames"] == 5 and result["unknownFrames"] == 5
