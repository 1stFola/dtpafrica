"""The identify stage: what it reads, what it refuses, and what it writes, with the
frame decoder injected so no FFmpeg is needed."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from dtp_vision_worker.control_plane import JobSpec
from dtp_vision_worker.config import CONTRACT_VERSION
from dtp_vision_worker.runner import StageContext, StageRefusal
from dtp_vision_worker.stages import identify as identify_stage

IDENTIFY = "6a1b2c3d-0000-4000-8000-00000000000c"
TRACKER = "6a1b2c3d-0000-4000-8000-00000000000a"
TRK_KEY = "inference/job-t/1/tracks.json"
W, H = 640, 360


def artifact(tracker: str = TRACKER) -> dict[str, Any]:
    # Two players left (red) and right (blue) of a 640x360 proxy, plus a goalkeeper in the middle.
    def track(local_id: int, cls: str, x: float) -> dict[str, Any]:
        return {"localTrackId": local_id, "class": cls, "positions": [
            {"frameIndex": f, "box": {"x": x, "y": 100, "width": 80, "height": 160}} for f in range(10)
        ]}
    return {"trackerVersionId": tracker, "proxy": {"fps": 25, "sourceOffsetMs": 0}, "tracks": [track(1, "player", 100), track(2, "player", 400), track(3, "goalkeeper", 250)]}


def painted_decoder(path: Path, frame: int, fps: float) -> tuple[int, int, bytes]:
    """A 640x360 frame: green pitch, a red figure where track 1 is, blue for track 2, yellow for the keeper."""
    px = bytearray((40, 160, 50) * (W * H))
    def paint(x0: int, y0: int, w: int, h: int, rgb: tuple[int, int, int]) -> None:
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                i = (y * W + x) * 3
                px[i:i + 3] = bytes(rgb)
    paint(100, 100, 80, 160, (220, 30, 30))
    paint(400, 100, 80, 160, (30, 40, 220))
    paint(250, 100, 80, 160, (230, 220, 40))
    return W, H, bytes(px)


def spec(inputs: dict[str, Any] | None = None) -> JobSpec:
    return JobSpec.from_payload({
        "contractVersion": CONTRACT_VERSION, "jobId": "job-id", "type": "identify", "resourceClass": "cpu_small", "attemptNumber": 1,
        "inputs": inputs if inputs is not None else {
            "videoAssetId": "asset-1", "modelVersionIds": [IDENTIFY],
            "params": {"videoAssetId": "asset-1", "proxy": {"fps": 25, "sourceOffsetMs": 0},
                       "tracks": {"jobId": "job-t", "key": TRK_KEY, "trackerVersionId": TRACKER},
                       "readKeys": [{"bucket": "derived", "key": TRK_KEY}]},
        },
        "outputPrefix": "inference/job-id/1/", "budget": {"maxRuntimeSeconds": 600, "maxCostUsdCents": 50},
    })


class FakeClient:
    def __init__(self, objects: dict[str, Any]) -> None:
        self.objects = objects
        self.asked: list[tuple[str, str | None]] = []

    def input_url(self, _job_id: str, role: str, key: str | None = None) -> str:
        self.asked.append((role, key))
        return f"https://storage.test/{key or role}"

    def presign_output(self, _job_id: str, key: str, _ct: str) -> str:
        return f"https://storage.test/put/{key}"


class FakeProgress:
    def set(self, *_a: object, **_k: object) -> None:
        pass


@pytest.fixture
def ctx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    objects = {TRK_KEY: artifact(), "proxy": b"not a video"}
    client = FakeClient(objects)
    context = StageContext(job=spec(), work_dir=tmp_path, client=client, http=None, progress=FakeProgress())  # type: ignore[arg-type]

    def fake_download(_c: object, url: str, target: Path) -> int:
        obj = objects[url.removeprefix("https://storage.test/")]
        body = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
        target.write_bytes(body)
        return len(body)

    uploaded: dict[str, Any] = {}

    def fake_upload(_c: object, _url: str, source: Path, _ct: str) -> int:
        uploaded["payload"] = json.loads(source.read_bytes())
        return source.stat().st_size

    monkeypatch.setattr(identify_stage, "download", fake_download)
    monkeypatch.setattr(identify_stage, "upload", fake_upload)
    context.uploaded = uploaded  # type: ignore[attr-defined]
    context.objects = objects  # type: ignore[attr-defined]
    return context


def test_assigns_the_two_players_to_two_sides_and_leaves_the_keeper_alone(ctx) -> None:
    result = identify_stage._identify(ctx, decoder=painted_decoder)
    rows = {r["localTrackId"]: r for r in result.summary["teamRows"]}
    assert rows[1]["team"] is not None and rows[2]["team"] is not None
    assert rows[1]["team"] != rows[2]["team"]
    assert rows[3] == {"localTrackId": 3, "class": "goalkeeper", "team": None, "nearest": None, "confidence": None, "method": "not_clustered", "samples": 5}
    assert {k["description"] for k in result.summary["kits"]} == {"red", "blue"}
    assert result.summary["framesDecoded"] == 5  # five sampled frames shared by all tracks
    assert result.summary["identifyVersionId"] == IDENTIFY
    assert result.summary["trackerVersionId"] == TRACKER
    assert result.model_version_ids == [IDENTIFY]


def test_reads_the_tracks_by_declared_key_and_the_proxy_by_role(ctx) -> None:
    identify_stage._identify(ctx, decoder=painted_decoder)
    assert ctx.client.asked == [("declared", TRK_KEY), ("proxy", None)]


def test_the_artifact_names_both_versions_and_keeps_the_features(ctx) -> None:
    result = identify_stage._identify(ctx, decoder=painted_decoder)
    payload = ctx.uploaded["payload"]
    assert payload["role"] == "identity"
    assert payload["identifyVersionId"] == IDENTIFY and payload["trackerVersionId"] == TRACKER
    assert set(payload["features"]) == {"1", "2", "3"}
    assert payload["params"]["minMargin"] > 0
    assert result.artifacts[0]["key"] == "inference/job-id/1/identity.json"


def test_an_undecodable_frame_is_skipped_not_fatal(ctx) -> None:
    calls = {"n": 0}

    def flaky(path: Path, frame: int, fps: float) -> tuple[int, int, bytes]:
        calls["n"] += 1
        if frame == 4:
            raise RuntimeError("corrupt frame")
        return painted_decoder(path, frame, fps)

    result = identify_stage._identify(ctx, decoder=flaky)
    assert result.summary["framesDecoded"] == 4
    assert result.summary["assigned"] == 2


def test_refuses_a_tracker_other_than_declared(ctx) -> None:
    ctx.objects[TRK_KEY] = artifact(tracker="someone-else")
    with pytest.raises(StageRefusal, match="declared tracker"):
        identify_stage._identify(ctx, decoder=painted_decoder)


@pytest.mark.parametrize(
    "inputs",
    [
        {"videoAssetId": "a", "modelVersionIds": [], "params": {"proxy": {"fps": 25}, "tracks": {"key": TRK_KEY}}},
        {"videoAssetId": "a", "modelVersionIds": [IDENTIFY], "params": {"proxy": {"fps": 25}}},
        {"videoAssetId": "a", "modelVersionIds": [IDENTIFY], "params": {"tracks": {"key": TRK_KEY}}},
    ],
    ids=["no-version", "no-tracks", "no-clock"],
)
def test_refuses_a_misdispatched_job_before_reading(ctx, inputs) -> None:
    ctx.job = spec(inputs)
    with pytest.raises(StageRefusal):
        identify_stage._identify(ctx, decoder=painted_decoder)
    assert ctx.client.asked == []
