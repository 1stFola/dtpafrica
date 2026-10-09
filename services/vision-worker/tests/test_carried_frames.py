"""Stages reading a moving camera's per-frame calibration from a pinned calibrate run (docs/vision/94)."""

import hashlib
import json
from types import SimpleNamespace

import pytest

from dtp_vision_worker import runner
from dtp_vision_worker.carried_frames import CarriedFrames, load, parse_pin
from dtp_vision_worker.event_carry import propose
from dtp_vision_worker.gamestate import Segment, SegmentIndex, place_track
from dtp_vision_worker.possession import PlayerIndex, rows
from dtp_vision_worker.possession_constraints import Constraints
from test_event_carry import fixture as carry_fixture
from test_gamestate import PIXEL_TO_PITCH, walk
from test_possession import balls, clock, track

H = [.1, 0, 0, 0, .1, 0, 0, 0, 1]


def sha(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def pin(**over):
    return {"jobId": "calibrate", "indexKey": "inference/c/1/index.json", "indexChecksum": "a" * 64, "chunkKeys": ["inference/c/1/c0.jsonl"], **over}


def frames(carried_until: int, segment="live", fps=25, offset=0, total=10, h=H) -> CarriedFrames:
    """Frames 0..total-1 of one segment; a keyframe reached those before `carried_until`."""
    return CarriedFrames.from_rows([{"f": f, "cameraSegmentId": segment, "H": h if f < carried_until else None, "quality": "good" if f < carried_until else None} for f in range(total)],
                                   {segment}, fps, offset)


@pytest.mark.parametrize("change", ["not a dict", "job", "index key", "checksum case", "short checksum", "no chunks", "chunk not a key", "repeated chunk"])
def test_a_malformed_pin_is_refused(change):
    raw = {"not a dict": [], "job": pin(jobId=""), "index key": pin(indexKey=None), "checksum case": pin(indexChecksum="A" * 64), "short checksum": pin(indexChecksum="a" * 63),
           "no chunks": pin(chunkKeys=[]), "chunk not a key": pin(chunkKeys=[3]), "repeated chunk": pin(chunkKeys=["c", "c"])}[change]
    with pytest.raises(ValueError):
        parse_pin(raw)
    assert parse_pin(pin()) == pin()


def test_frames_are_kept_only_for_the_declared_segments_where_a_keyframe_reached():
    carried = CarriedFrames.from_rows([
        {"f": 0, "cameraSegmentId": "live", "H": H, "quality": "good"},
        {"f": 1, "cameraSegmentId": "live", "H": None, "quality": None, "reason": "beyond_reach"},
        {"f": 2, "cameraSegmentId": "still", "H": H, "quality": "good"},
        {"f": 3, "cameraSegmentId": None, "H": None},
    ], {"live"}, 25, 1000)
    assert len(carried) == 1
    assert carried.at(0, "live") == tuple(H) and carried.at(0, "still") is None and carried.at(1, "live") is None and carried.at(2, "still") is None
    # 1000 ms offset, 40 ms a frame: 1000 is frame 0, 1040 frame 1.
    assert carried.at_ms(1000, "live") == tuple(H) and carried.at_ms(1040, "live") is None and carried.frame_of(1080) == 2


@pytest.mark.parametrize("row", [
    {"cameraSegmentId": "live", "H": H, "quality": "good"},
    {"f": -1, "cameraSegmentId": "live", "H": H, "quality": "good"},
    {"f": True, "cameraSegmentId": "live", "H": H, "quality": "good"},
    {"f": 0, "cameraSegmentId": "live", "H": H, "quality": "failed"},
    {"f": 0, "cameraSegmentId": "live", "H": [1, 0, 0], "quality": "good"},
    {"f": 0, "cameraSegmentId": "live", "H": [1, 0, 0, 0, 1, 0, 0, 0, float("nan")], "quality": "good"},
    {"f": 0, "cameraSegmentId": "live", "H": [1, 0, 0, 0, 1, 0, 0, 0, True], "quality": "good"},
])
def test_a_carried_row_that_is_not_a_passing_finite_transform_is_refused(row):
    with pytest.raises(ValueError):
        CarriedFrames.from_rows([row], {"live"}, 25, 0)


def test_a_frame_carried_twice_is_refused():
    with pytest.raises(ValueError, match="twice"):
        CarriedFrames.from_rows([{"f": 0, "cameraSegmentId": "live", "H": H, "quality": "good"}] * 2, {"live"}, 25, 0)


class Loader:
    """A worker context whose downloads come from a dict of objects, as the control plane serves them."""

    def __init__(self, tmp_path, monkeypatch, **over):
        self.chunk = b"".join(json.dumps({"f": f, "cameraSegmentId": "live", "H": H, "quality": "good"}).encode() + b"\n" for f in range(3))
        index = {"role": "calibration_frames", "proxy": {"fps": 25, "sourceOffsetMs": 0}, "chunks": [{"key": "inference/c/1/c0.jsonl", "sha256": sha(self.chunk)}]}
        index |= over.get("index", {})
        self.index = json.dumps(index).encode()
        self.objects = {"inference/c/1/index.json": self.index, "inference/c/1/c0.jsonl": over.get("chunk", self.chunk)}
        self.pin = pin(**({"indexChecksum": sha(self.index)} | over.get("pin", {})))
        self.ctx = SimpleNamespace(work_dir=tmp_path, job=SimpleNamespace(job_id="job"), client=SimpleNamespace(input_url=lambda job, role, key=None: key))

        def download(ctx, key, path):
            path.write_bytes(self.objects[key])
            return len(self.objects[key])
        monkeypatch.setattr(runner, "download", download)

    def load(self, fps=25, offset=0):
        return load(self.ctx, self.pin, {"live"}, fps, offset)


def test_the_pinned_run_is_read_whole_and_counted(tmp_path, monkeypatch):
    loader = Loader(tmp_path, monkeypatch)
    carried, read = loader.load()
    assert len(carried) == 3 and read == len(loader.index) + len(loader.chunk)
    assert not list(tmp_path.glob("carried-*.jsonl"))


@pytest.mark.parametrize("change", ["index checksum", "role", "fps", "offset", "chunk keys", "chunk changed"])
def test_a_run_that_is_not_the_one_pinned_is_refused(tmp_path, monkeypatch, change):
    over = {"index checksum": {"pin": {"indexChecksum": "f" * 64}}, "role": {"index": {"role": "camera_motion"}}, "fps": {}, "offset": {},
            "chunk keys": {"pin": {"chunkKeys": ["inference/c/1/other.jsonl"]}}, "chunk changed": {"chunk": b'{"f": 0, "cameraSegmentId": "live", "H": null}\n'}}[change]
    loader = Loader(tmp_path, monkeypatch, **over)
    with pytest.raises(ValueError):
        loader.load(fps=30 if change == "fps" else 25, offset=40 if change == "offset" else 0)


def carried_snapshot(c, **over):
    return {"proxyWidth": 1000, "proxyHeight": 500, "proxyVariantId": "proxy", "proxyKey": "proxy.mp4", "proxyChecksum": "b" * 64, "carried": pin(),
            "segments": [{"cameraSegmentId": s["cameraSegmentId"], "startMs": s["startMs"], "endMs": s["endMs"], "calibrationId": None, "quality": "carried",
                          "thresholdsVersion": "provisional/v1", "homography": None, "pitch": {"lengthM": 105, "widthM": 68}, "keyframeIds": ["k1"], **over} for s in c.segments]}


def test_possession_is_judged_through_each_frames_own_calibration_and_unknown_where_none_reached(tmp_path):
    c = clock()
    players = PlayerIndex(tmp_path / "p.sqlite", c, [track(c)])
    try:
        result = list(rows(c, balls(c), players, constraints=Constraints(c, carried_snapshot(c), carried=frames(6))))
    finally:
        players.close()
    # Frames 0-5 carried: continuity, then a candidate; 6-9 no keyframe reached: Unknown, nothing borrowed.
    assert [r["reason"] for r in result[:5]] == ["continuity_pending"] * 5
    assert result[5]["state"] == "candidate"
    assert all(r["reason"] == "calibration_unavailable" and r["localTrackId"] is None for r in result[6:])


@pytest.mark.parametrize("change", ["transform", "calibration id", "no keyframes", "repeated keyframe", "no thresholds", "no pitch", "no pin", "not loaded"])
def test_a_carried_declaration_is_refused_unless_whole(change):
    c = clock()
    over = {"transform": {"homography": H}, "calibration id": {"calibrationId": "cal"}, "no keyframes": {"keyframeIds": []}, "repeated keyframe": {"keyframeIds": ["k", "k"]},
            "no thresholds": {"thresholdsVersion": None}, "no pitch": {"pitch": None}}.get(change, {})
    snapshot = carried_snapshot(c, **over)
    if change == "no pin":
        del snapshot["carried"]
    with pytest.raises(ValueError):
        Constraints(c, snapshot, carried=None if change == "not loaded" else frames(6))


def test_a_pin_with_no_carried_segment_is_refused():
    c = clock()
    snapshot = carried_snapshot(c)
    snapshot["segments"][0] |= {"quality": "good", "calibrationId": "cal", "homography": H, "keyframeIds": None}
    with pytest.raises(ValueError, match="no carried segment"):
        Constraints(c, snapshot, carried=frames(6))


def test_a_carry_on_a_moving_camera_ends_where_the_calibration_stops():
    clock_, segments, players, snapshot = carry_fixture()
    snapshot["segments"][0] |= {"quality": "carried", "calibrationId": None, "homography": None, "keyframeIds": ["k1"]}
    snapshot["carried"] = pin()
    whole = propose(clock_, segments, players, carry_fixture()[3], {})
    # The fixture's camera: 50 frames from 1000 ms. Carried for the first 40 only.
    carried = propose(clock_, segments, players, snapshot, {}, frames(40, "camera", offset=1000, total=50, h=[1, 0, 0, 0, 1, 0, 0, 0, 1]))
    assert whole[0]["endMs"] == 2960
    assert len(carried) == 1 and carried[0]["startMs"] == 1000 and carried[0]["endMs"] == 1000 + 39 * 40
    with pytest.raises(ValueError):
        propose(clock_, segments, players, snapshot, {})


def test_game_state_places_a_moving_camera_frame_by_frame_and_says_where_it_could_not():
    walked = walk()  # 41 positions from 9000 ms at 25 fps: frames 225-265 of a proxy starting at 0.
    segments = SegmentIndex([Segment("seg-1", 0, 60_000, "carried", None, 105.0, 68.0)])
    carried = CarriedFrames.from_rows([{"f": 225 + i, "cameraSegmentId": "seg-1", "H": list(PIXEL_TO_PITCH), "quality": "good"} for i in range(20)], {"seg-1"}, 25, 0)
    placed = place_track(walked, segments, [], carried)
    assert all(r["x_m"] is not None and r["quality"] == "carried" and r["reason"] is None for r in placed[:20])
    assert abs(placed[0]["x_m"] - 10) < 0.01 and abs(placed[19]["x_m"] - 19.5) < 0.01
    assert all(r["x_m"] is None and r["reason"] == "calibration_not_carried" and r["camera_segment_id"] == "seg-1" for r in placed[20:])
    assert all(r["reason"] == "calibration_not_carried" for r in place_track(walked, segments, [], None))
