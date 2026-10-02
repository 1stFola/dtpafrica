"""Game state: positions placed through a calibration, suppressed without one, chunked and indexed."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from dtp_vision_worker.config import CONTRACT_VERSION
from dtp_vision_worker.control_plane import JobSpec
from dtp_vision_worker.gamestate import (
    Anchor,
    Segment,
    build,
    chunk_rows,
    clock_at,
    coverage,
    main,
    place,
    project,
    read_chunk,
)
from dtp_vision_worker.runner import StageContext, StageRefusal
from dtp_vision_worker.stages import gamestate as gamestate_stage

# The synthetic camera from the calibration gate, inverted: proxy pixels -> metres.
CAMERA = (9.2, -3.1, 160, 0.4, 2.6, 80, 0.0004, 0.011, 1)


def invert(m: tuple[float, ...]) -> tuple[float, ...]:
    a, b, c, d, e, f, g, h, i = m
    A, B, C = e * i - f * h, -(d * i - f * g), d * h - e * g
    det = a * A + b * B + c * C
    return (A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det)


PIXEL_TO_PITCH = invert(CAMERA)


def see(x_m: float, y_m: float) -> tuple[float, float]:
    p = project(CAMERA, x_m, y_m)
    assert p is not None
    return p


def walk(local_id: int = 1, frames: int = 41, start_ms: int = 9000, fps: int = 25, first_frame: int = 0) -> dict[str, Any]:
    """A player walking from (10, 34) to (30, 34) metres, seen by the camera; foot at the box's bottom centre."""
    positions = []
    for i in range(frames):
        foot = see(10 + i * 0.5, 34)
        ms = start_ms + round(i / fps * 1000)
        positions.append({"frameIndex": first_frame + i, "proxyTimeMs": ms - 9000, "sourceTimeMs": ms, "box": {"x": foot[0] - 20, "y": foot[1] - 80, "width": 40, "height": 80}, "confidence": 0.9})
    return {"localTrackId": local_id, "class": "player", "positions": positions}


def cal(quality: str | None = "good", start_ms: int = 0, end_ms: int = 60_000, segment: str = "seg-1") -> Segment:
    if quality is None:
        return Segment(segment, start_ms, end_ms, None, None, None, None)
    return Segment(segment, start_ms, end_ms, quality, PIXEL_TO_PITCH, 105.0, 68.0)


def test_a_pixel_goes_through_the_homography_and_the_horizon_is_none() -> None:
    x, y = see(52.5, 34)
    back = project(PIXEL_TO_PITCH, x, y)
    assert back is not None and abs(back[0] - 52.5) < 1e-6 and abs(back[1] - 34) < 1e-6
    # A camera whose horizon crosses the picture: a point beyond it has w <= 0.
    low = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -0.01, 1.0)
    assert project(low, 0, 200) is None


def test_the_clock_reads_broadcast_minutes_and_nothing_off_it() -> None:
    anchors = [Anchor(1, 9000, 9000 + 45 * 60_000), Anchor(2, 3_000_000, None)]
    assert clock_at(anchors, 9000 + 12 * 60_000 + 30_000) == (1, 12.5)
    assert clock_at(anchors, 3_000_000 + 132_000) == (2, 47.2)
    assert clock_at(anchors, 5000) is None
    assert clock_at(anchors, 2_800_000) is None
    assert clock_at([], 9000) is None


def test_positions_are_placed_through_a_passing_calibration() -> None:
    rows = place([walk()], [cal()], [Anchor(1, 9000, None)])
    assert len(rows) == 41
    first, last = rows[0], rows[-1]
    assert abs(first["x_m"] - 10) < 0.01 and abs(first["y_m"] - 34) < 0.01
    assert abs(last["x_m"] - 30) < 0.01
    assert first["camera_segment_id"] == "seg-1" and first["quality"] == "good" and first["reason"] is None
    assert first["half"] == 1 and first["match_minute"] == 0.0
    assert last["match_minute"] == pytest.approx(1.6 / 60, abs=1e-3)


def test_positions_are_suppressed_and_say_why() -> None:
    # The walk under a failed calibration, then a declared segment nobody calibrated, then a
    # stretch under no segment, and a usable one at the end.
    cals = [cal("failed", 0, 9500, "seg-a"), cal(None, 9501, 9900, "seg-n"), cal("usable", 10_200, 60_000, "seg-b")]
    rows = place([walk()], cals, [])
    reasons = {}
    for r in rows:
        reasons[r["reason"]] = reasons.get(r["reason"], 0) + 1
    assert reasons[None] > 0 and reasons["calibration_failed"] > 0 and reasons["segment_not_calibrated"] > 0 and reasons["no_camera_segment"] > 0
    failed = next(r for r in rows if r["reason"] == "calibration_failed")
    assert failed["x_m"] is None and failed["camera_segment_id"] == "seg-a" and failed["quality"] == "failed"
    uncalibrated = next(r for r in rows if r["reason"] == "segment_not_calibrated")
    assert uncalibrated["x_m"] is None and uncalibrated["camera_segment_id"] == "seg-n" and uncalibrated["quality"] is None
    nowhere = next(r for r in rows if r["reason"] == "no_camera_segment")
    assert nowhere["camera_segment_id"] is None
    # A passing quality with no homography cannot place either.
    broken = Segment("seg-x", 0, 60_000, "good", None, None, None)
    assert all(r["reason"] == "segment_not_calibrated" for r in place([walk()], [broken], []))
    assert all(r["half"] is None and r["match_minute"] is None for r in rows)


def test_a_point_beyond_the_horizon_is_suppressed_not_mirrored() -> None:
    low = Segment("seg", 0, 60_000, "good", (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -0.01, 1.0), 105, 68)
    track = {"localTrackId": 1, "class": "player", "positions": [{"frameIndex": 0, "sourceTimeMs": 100, "box": {"x": 0, "y": 150, "width": 10, "height": 50}}]}
    rows = place([track], [low], [])
    assert rows[0]["reason"] == "beyond_horizon" and rows[0]["x_m"] is None


def test_rows_are_in_time_order_across_tracks_and_chunked_by_source_time() -> None:
    rows = place([walk(2, start_ms=9000), walk(1, start_ms=9000)], [cal()], [])
    assert [r["local_track_id"] for r in rows[:2]] == [1, 2]
    chunks = chunk_rows(rows, 1000)
    assert [index for index, _ in chunks] == [9, 10]
    assert sum(len(g) for _, g in chunks) == len(rows)
    assert [r["source_ms"] for r in chunks[0][1]] == sorted(r["source_ms"] for r in chunks[0][1])
    assert all(9000 <= r["source_ms"] < 10_000 for r in chunks[0][1])
    # Chunks come out in order whatever order the rows went in.
    assert [index for index, _ in chunk_rows(list(reversed(rows)), 1000)] == [9, 10]
    assert chunk_rows([], 1000) == []
    with pytest.raises(ValueError):
        chunk_rows(rows, 0)


def test_a_segment_covers_both_of_its_ends() -> None:
    # The walk runs 9000..10600. One segment ends exactly on the first frame, another starts
    # exactly on the last: both frames are placed, through their own segment.
    rows = place([walk()], [cal("good", 0, 9000, "first"), cal("good", 10_600, 60_000, "last")], [])
    assert rows[0]["camera_segment_id"] == "first" and rows[0]["x_m"] is not None
    assert rows[-1]["camera_segment_id"] == "last" and rows[-1]["x_m"] is not None
    assert all(r["reason"] == "no_camera_segment" for r in rows[1:-1])


def test_coverage_is_the_share_of_frames_a_passing_calibration_covered() -> None:
    rows = place([walk()], [cal("good", 0, 9800)], [])
    c = coverage(rows)
    placed_frames = {r["frame_index"] for r in rows if r["x_m"] is not None}
    assert c["frames"] == 41 and c["placed"] == len(placed_frames) and c["suppressed"] == 41 - len(placed_frames)
    assert c["validFrameCoverage"] == pytest.approx(len(placed_frames) / 41, abs=1e-4)
    assert c["reasons"] == {"no_camera_segment": 41 - len(placed_frames)}
    assert coverage([])["validFrameCoverage"] is None


def test_coverage_is_over_frames_not_rows() -> None:
    # Two tracks on the same frames under a low camera: one on the grass, one beyond the horizon.
    low = Segment("seg", 0, 60_000, "good", (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -0.01, 1.0), 105, 68)
    at = lambda y: [{"frameIndex": i, "sourceTimeMs": 100 + i * 40, "box": {"x": 0, "y": y - 50, "width": 10, "height": 50}} for i in range(5)]
    rows = place([{"localTrackId": 1, "class": "player", "positions": at(50)}, {"localTrackId": 2, "class": "player", "positions": at(150)}], [low], [])
    c = coverage(rows)
    assert c["rows"] == 10 and c["placed"] == 5 and c["suppressed"] == 5 and c["frames"] == 5
    assert c["validFrameCoverage"] == 1.0  # every frame had a placed row; half the rows did not


def test_build_writes_parquet_chunks_that_read_back_and_an_index(tmp_path: Path) -> None:
    index = build([walk()], [cal()], [Anchor(1, 9000, None)], tmp_path, chunk_ms=1000)
    assert [c["index"] for c in index["chunks"]] == [9, 10]
    assert index["chunks"][0]["file"] == "chunk-00009.parquet"
    assert (index["chunks"][0]["fromMs"], index["chunks"][0]["toMs"]) == (9000, 10_000)
    assert (index["chunks"][1]["fromMs"], index["chunks"][1]["toMs"]) == (10_000, 11_000)
    assert index["placed"] == 41 and index["validFrameCoverage"] == 1.0 and index["tracks"] == 1
    rows = read_chunk(tmp_path / "chunk-00009.parquet")
    assert len(rows) == index["chunks"][0]["rows"]
    assert rows[0]["frame_index"] == 0 and abs(rows[0]["x_m"] - 10) < 0.01 and rows[0]["half"] == 1
    assert set(rows[0]) == {"frame_index", "source_ms", "half", "match_minute", "local_track_id", "class", "x_m", "y_m", "camera_segment_id", "quality", "reason"}


def test_the_cli_builds_from_files(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    (tmp_path / "tracks.json").write_text(json.dumps({"tracks": [walk()]}), encoding="utf-8")
    (tmp_path / "segments.json").write_text(json.dumps([{"cameraSegmentId": "seg-1", "startMs": 0, "endMs": 60_000, "quality": "good", "homography": list(PIXEL_TO_PITCH), "pitch": {"lengthM": 105, "widthM": 68}}, {"cameraSegmentId": "seg-2", "startMs": 60_001, "endMs": 70_000, "quality": None, "homography": None, "pitch": None}]), encoding="utf-8")
    (tmp_path / "anchors.json").write_text(json.dumps([{"half": 1, "sourceMs": 9000, "endMs": None}]), encoding="utf-8")
    out = tmp_path / "out"
    assert main(["--tracks", str(tmp_path / "tracks.json"), "--segments", str(tmp_path / "segments.json"), "--anchors", str(tmp_path / "anchors.json"), "--out-dir", str(out)]) == 0
    index = json.loads(capsys.readouterr().out)
    assert index["placed"] == 41 and len(index["chunks"]) == 1 and (out / "chunk-00000.parquet").exists()


# ── the stage ──────────────────────────────────────────────────────────────────

TRK_KEY = "inference/job-t/1/tracks.json"


def spec(params: dict[str, Any] | None = None) -> JobSpec:
    return JobSpec.from_payload({
        "contractVersion": CONTRACT_VERSION, "jobId": "job-g", "type": "gamestate", "resourceClass": "cpu_small", "attemptNumber": 1,
        "inputs": {"videoAssetId": "asset-1", "params": params if params is not None else {
            "videoAssetId": "asset-1",
            "tracks": {"jobId": "job-t", "key": TRK_KEY, "trackerVersionId": "trk"},
            "segments": [{"cameraSegmentId": "seg-1", "startMs": 0, "endMs": 60_000, "quality": "good", "homography": list(PIXEL_TO_PITCH), "pitch": {"lengthM": 105, "widthM": 68}}],
            "anchors": [{"half": 1, "sourceMs": 9000, "endMs": None}],
            "chunkMs": 1000,
            "readKeys": [{"bucket": "derived", "key": TRK_KEY}],
        }},
        "outputPrefix": "inference/job-g/1/", "budget": {"maxRuntimeSeconds": 600, "maxCostUsdCents": 50},
    })


class FakeClient:
    def __init__(self, objects: dict[str, Any]) -> None:
        self.objects = objects
        self.asked: list[tuple[str, str | None]] = []
        self.presigned: list[str] = []

    def input_url(self, _job_id: str, role: str, key: str | None = None) -> str:
        self.asked.append((role, key))
        return f"https://storage.test/{key}"

    def presign_output(self, _job_id: str, key: str, _ct: str) -> str:
        self.presigned.append(key)
        return f"https://storage.test/put/{key}"


class FakeProgress:
    def set(self, *_a: object, **_k: object) -> None:
        pass


@pytest.fixture
def ctx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    objects = {TRK_KEY: {"trackerVersionId": "trk", "tracks": [walk(), walk(2, start_ms=70_000, first_frame=1525)]}}
    client = FakeClient(objects)
    context = StageContext(job=spec(), work_dir=tmp_path, client=client, http=None, progress=FakeProgress())  # type: ignore[arg-type]
    uploaded: dict[str, int] = {}

    def fake_download(_c: object, url: str, target: Path) -> int:
        body = json.dumps(objects[url.removeprefix("https://storage.test/")]).encode()
        target.write_bytes(body)
        return len(body)

    def fake_upload(_c: object, url: str, source: Path, _ct: str) -> int:
        uploaded[url.removeprefix("https://storage.test/put/")] = source.stat().st_size
        return source.stat().st_size

    monkeypatch.setattr(gamestate_stage, "download", fake_download)
    monkeypatch.setattr(gamestate_stage, "upload", fake_upload)
    context.uploaded = uploaded  # type: ignore[attr-defined]
    context.objects = objects  # type: ignore[attr-defined]
    return context


def test_the_stage_reads_the_declared_artifact_and_writes_chunks_and_an_index(ctx) -> None:
    result = gamestate_stage._gamestate(ctx)
    assert ctx.client.asked == [("declared", TRK_KEY)]
    roles = [a["role"] for a in result.artifacts]
    assert roles == ["gamestate_chunk"] * 4 + ["gamestate"]
    assert result.artifacts[0]["key"] == "inference/job-g/1/gamestate/chunk-00009.parquet"
    assert result.artifacts[0]["contentType"] == "application/vnd.apache.parquet"
    assert result.artifacts[-1]["key"] == "inference/job-g/1/gamestate.json"
    assert result.summary["rows"] == 82 and result.summary["placed"] == 41 and result.summary["suppressed"] == 41
    assert result.summary["chunks"] == 4 and result.summary["validFrameCoverage"] == 0.5 and result.summary["tracks"] == 2
    assert result.summary["reasons"] == {"no_camera_segment": 41}
    assert result.summary["trackJobId"] == "job-t" and result.summary["trackerVersionId"] == "trk"
    assert set(ctx.uploaded) == set(a["key"] for a in result.artifacts)
    index = json.loads((ctx.work_dir / "gamestate.json").read_bytes())
    assert index["role"] == "gamestate" and index["chunks"][0]["key"] == result.artifacts[0]["key"]
    assert index["segments"][0]["quality"] == "good" and index["anchors"][0]["half"] == 1


def test_the_stage_refuses_a_tracker_other_than_declared(ctx) -> None:
    ctx.objects[TRK_KEY] = {"trackerVersionId": "someone-else", "tracks": []}
    with pytest.raises(StageRefusal, match="declared tracker"):
        gamestate_stage._gamestate(ctx)


@pytest.mark.parametrize(
    "params",
    [
        {"segments": []},
        {"tracks": {"key": TRK_KEY}},
        {"tracks": {"key": TRK_KEY}, "segments": [], "chunkMs": 0},
    ],
    ids=["no-tracks", "no-segments", "bad-chunk"],
)
def test_refuses_a_misdispatched_job_before_reading(ctx, params) -> None:
    ctx.job = spec(params)
    with pytest.raises(StageRefusal):
        gamestate_stage._gamestate(ctx)
    assert ctx.client.asked == []
