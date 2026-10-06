import hashlib
import json
import math

import pytest

from dtp_vision_worker.ball_trajectory import Config, Smoother, build


def ball(x=100, score=0.9):
    return {"class": "ball", "confidence": score, "box": {"x": x, "y": 100, "width": 10, "height": 10}}


def frame(index, detections=None, offset=0):
    return {"frameIndex": index, "sourceTimeMs": index * 40 + offset, "proxyTimeMs": index * 40, "detections": [ball()] if detections is None else detections}


def smoother(duration=240, segments=None, offset=0, proxy_duration=None, config=Config()):
    return Smoother(fps=25, source_offset_ms=offset, source_duration_ms=duration, proxy_duration_ms=proxy_duration or duration - offset,
                    width=1000, height=500, segments=segments if segments is not None else [{"cameraSegmentId": "live", "startMs": 0, "endMs": duration, "kind": "live_play"}], config=config)


def test_smooths_only_observed_points_and_keeps_raw_evidence_and_confidence():
    rows = list(smoother(duration=80).rows([frame(0), frame(1, [ball(110)])]))
    assert rows[0]["point"] == {"x": 0.105, "y": 0.21}
    assert rows[1]["rawPoint"] == {"x": 0.115, "y": 0.21}
    assert rows[1]["point"]["x"] == pytest.approx(0.105 + (1 - math.exp(-40 / 120)) * 0.01)
    assert rows[1]["confidence"] == 0.9
    assert rows[0]["trajectoryId"] == rows[1]["trajectoryId"]


@pytest.mark.parametrize("detections,reason", [([], "no_detection"), ([ball(score=0.1)], "low_confidence"), ([ball(), ball(120)], "ambiguous"), ([ball(score=float('nan'))], "invalid_detection"), ([ball(-1)], "invalid_detection")])
def test_abstains_with_null_coordinates_and_resets_after_every_loss(detections, reason):
    rows = list(smoother(duration=120).rows([frame(0), frame(1, detections), frame(2, [ball(700)])]))
    assert rows[1]["state"] == "lost" and rows[1]["reason"] == reason
    assert rows[1]["point"] is None and rows[1]["rawPoint"] is None and rows[1]["confidence"] is None and rows[1]["trajectoryId"] is None
    assert rows[2]["point"] == rows[2]["rawPoint"]
    assert rows[2]["trajectoryId"] != rows[0]["trajectoryId"]


def test_missing_prefix_middle_and_tail_frames_are_explicit_losses_not_interpolated():
    rows = list(smoother().rows([frame(1), frame(3)]))
    assert [r["frameIndex"] for r in rows] == list(range(6))
    assert [r["reason"] for r in rows] == ["missing_frame", None, "missing_frame", None, "missing_frame", "missing_frame"]
    assert rows[1]["trajectoryId"] != rows[3]["trajectoryId"]


def test_replay_intro_halftime_cut_and_unknown_never_emit_ball_coordinates():
    for kind, reason in [("replay", "non_play"), ("intro", "non_play"), ("halftime", "non_play"), ("camera_cut", "camera_cut"), ("unknown", "camera_unknown")]:
        row = list(smoother(duration=40, segments=[{"cameraSegmentId": kind, "startMs": 0, "endMs": 40, "kind": kind}]).rows([frame(0)]))[0]
        assert row["state"] == "lost" and row["reason"] == reason and row["point"] is None
    assert list(smoother(duration=40, segments=[]).rows([frame(0)]))[0]["reason"] == "camera_unknown"


def test_camera_boundary_is_half_open_and_never_bridges_the_smoother():
    segments = [{"cameraSegmentId": "a", "startMs": 0, "endMs": 40, "kind": "live_play"}, {"cameraSegmentId": "b", "startMs": 40, "endMs": 80, "kind": "live_play"}]
    rows = list(smoother(duration=80, segments=segments).rows([frame(0), frame(1, [ball(800)])]))
    assert rows[1]["cameraSegmentId"] == "b" and rows[1]["state"] == "observed"
    assert rows[1]["point"] == rows[1]["rawPoint"] and rows[1]["trajectoryId"] != rows[0]["trajectoryId"]


def test_unexplained_motion_jump_becomes_lost_not_a_smoothed_guess():
    rows = list(smoother(duration=120).rows([frame(0), frame(1, [ball(800)]), frame(2, [ball(810)])]))
    assert rows[1]["reason"] == "motion_jump" and rows[1]["point"] is None
    assert rows[2]["point"] == rows[2]["rawPoint"]


def test_original_source_tail_excludes_proxy_padding_and_offset_uses_source_time():
    rows = list(smoother(duration=81, proxy_duration=160).rows([frame(0), frame(1), frame(2), frame(3)]))
    assert [r["sourceTimeMs"] for r in rows] == [0, 40, 80]
    rows = list(smoother(duration=1041, offset=1000, proxy_duration=80).rows([frame(0, offset=1000), frame(1, offset=1000)]))
    assert [r["sourceTimeMs"] for r in rows] == [1000, 1040]


@pytest.mark.parametrize("frames", [[frame(0), frame(0)], [frame(1), frame(0)], [{**frame(0), "sourceTimeMs": 1}], [{**frame(0), "frameIndex": True}], [{**frame(0), "detections": None}]])
def test_rejects_corrupt_frame_clocks_or_shapes_before_publishing(frames):
    with pytest.raises(ValueError):
        list(smoother().rows(frames))


def test_rejects_overlapping_camera_windows_and_invalid_configuration():
    with pytest.raises(ValueError, match="overlap"):
        smoother(segments=[{"cameraSegmentId": "a", "startMs": 0, "endMs": 200, "kind": "live_play"}, {"cameraSegmentId": "b", "startMs": 40, "endMs": 240, "kind": "live_play"}])
    for config in [{"minConfidence": True}, {"smoothingMs": float('nan')}, {"maxImageSpeedPerSecond": 0}, {"unrecognised": 1}]:
        with pytest.raises(ValueError): Config.parse(config)


def test_chunked_rows_are_checksummed_and_coverage_counts_losses_honestly(tmp_path):
    index = build(smoother(), [frame(0), frame(1, [])], tmp_path, chunk_ms=80)
    assert index["frames"] == 6 and index["observed"] == 1 and index["lost"] == 5
    assert index["observedFrameCoverage"] == pytest.approx(1 / 6)
    assert len(index["chunks"]) == 3
    assert sum(c["rows"] for c in index["chunks"]) == 6
    for chunk in index["chunks"]:
        body = (tmp_path / chunk["file"]).read_bytes()
        assert chunk["checksumSha256"] == hashlib.sha256(body).hexdigest()
        assert len([json.loads(line) for line in body.splitlines()]) == chunk["rows"]
