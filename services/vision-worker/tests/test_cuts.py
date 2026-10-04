"""Camera cuts from a showinfo log, and the stage around them."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from dtp_vision_worker.config import CONTRACT_VERSION
from dtp_vision_worker.control_plane import JobSpec
from dtp_vision_worker.cuts import main, parse_showinfo, propose, segments_from_cuts
from dtp_vision_worker.runner import StageContext, StageRefusal
from dtp_vision_worker.stages import cuts as cuts_stage

# As FFmpeg 5.1 prints it for `select='gt(scene,T)',metadata=print,showinfo`, in its order:
# the filter's two config lines, then for each kept frame the `metadata` pair (the frame, its
# score) *before* that frame's `showinfo` line and its colour line. A progress line can share
# a line with the next `metadata` line. The line order was taken from a real run in the worker
# image (FFmpeg 5.1.9); the times and scores are this fixture's own.
LOG = """
[Parsed_showinfo_2 @ 0x5fbb02fcf140] config in time_base: 1/25, frame_rate: 25/1
[Parsed_showinfo_2 @ 0x5fbb02fcf140] config out time_base: 0/0, frame_rate: 0/0
[Parsed_metadata_1 @ 0x5fbb02fce740] frame:0    pts:1530    pts_time:61.2
[Parsed_metadata_1 @ 0x5fbb02fce740] lavfi.scene_score=0.731000
[Parsed_showinfo_2 @ 0x5fbb02fcf140] n:   0 pts:   1530 pts_time:61.2     pos:  1624 fmt:yuv420p sar:1/1 s:1280x720 i:P iskey:1 type:I checksum:7EEB9ECA plane_checksum:[699A0ED0 B1DB541A F17B3BE0] mean:[41 240 110] stdev:[0.0 0.0 0.0]
[Parsed_showinfo_2 @ 0x5fbb02fcf140] color_range:unknown color_space:unknown color_primaries:unknown color_trc:unknown
[Parsed_metadata_1 @ 0x5fbb02fce740] frame:1    pts:1533    pts_time:61.32
[Parsed_metadata_1 @ 0x5fbb02fce740] lavfi.scene_score=0.512000
[Parsed_showinfo_2 @ 0x5fbb02fcf140] n:   1 pts:   1533 pts_time:61.32    pos:  2011 fmt:yuv420p sar:1/1 s:1280x720 i:P iskey:0 type:P checksum:0 plane_checksum:[0 0 0] mean:[41 240 110] stdev:[0.0 0.0 0.0]
[Parsed_showinfo_2 @ 0x5fbb02fcf140] color_range:unknown color_space:unknown color_primaries:unknown color_trc:unknown
frame=    2 fps=0.0 q=-0.0 size=N/A time=00:01:01.36 bitrate=N/A speed= 179x    [Parsed_metadata_1 @ 0x5fbb02fce740] frame:2    pts:4500   pts_time:180
[Parsed_metadata_1 @ 0x5fbb02fce740] lavfi.scene_score=0.904000
[Parsed_showinfo_2 @ 0x5fbb02fcf140] n:   2 pts:   4500 pts_time:180      pos:  2511 fmt:yuv420p sar:1/1 s:1280x720 i:P iskey:1 type:I checksum:B248C31F plane_checksum:[1A5EBB4D C5699A7E B4CD6D45] mean:[126 128 124] stdev:[71.5 70.6 71.6]
[Parsed_showinfo_2 @ 0x5fbb02fcf140] color_range:unknown color_space:unknown color_primaries:unknown color_trc:unknown
frame=    3 fps=0.0 q=-0.0 Lsize=N/A time=00:10:00.00 bitrate=N/A speed= 600x
"""


def test_a_score_belongs_to_the_cut_printed_after_it() -> None:
    # The first cut has a score and the last cut has its own: nothing is shifted by one.
    cuts = parse_showinfo(LOG)
    assert [c["score"] for c in cuts] == [0.731, 0.512, 0.904]
    # A cut with no score printed for it reads 0, and does not take the next cut's.
    partial = "\n".join(line for line in LOG.splitlines() if "scene_score=0.512" not in line)
    assert [c["score"] for c in parse_showinfo(partial)] == [0.731, 0.0, 0.904]
    # The filter's own config lines and the colour lines are not cuts.
    assert len(cuts) == 3


def test_cuts_are_read_off_showinfo_lines_with_their_scores() -> None:
    cuts = parse_showinfo(LOG)
    assert cuts == [
        {"proxyMs": 61200, "score": 0.731},
        {"proxyMs": 61320, "score": 0.512},
        {"proxyMs": 180000, "score": 0.904},
    ]
    assert parse_showinfo("frame=  0 fps=0.0\n") == []


def test_segments_are_the_stretches_between_cuts_with_slivers_absorbed() -> None:
    assert segments_from_cuts([61200, 61320, 180000], 600_000) == [
        {"startMs": 0, "endMs": 61200},
        {"startMs": 61200, "endMs": 180000},
        {"startMs": 180000, "endMs": 600_000},
    ]


def test_no_cuts_is_one_segment_and_cuts_outside_the_proxy_are_ignored() -> None:
    assert segments_from_cuts([], 5000) == [{"startMs": 0, "endMs": 5000}]
    assert segments_from_cuts([0, 5000, 7000, -3], 5000) == [{"startMs": 0, "endMs": 5000}]
    assert segments_from_cuts([3000], 0) == []


def test_a_trailing_sliver_joins_the_last_segment_and_duplicates_collapse() -> None:
    assert segments_from_cuts([10_000, 10_000, 59_500], 60_000) == [{"startMs": 0, "endMs": 10_000}, {"startMs": 10_000, "endMs": 60_000}]
    # A proxy shorter than the floor is still one segment.
    assert segments_from_cuts([500], 1000) == [{"startMs": 0, "endMs": 1000}]


def test_cuts_arrive_in_any_order_and_are_still_segments_in_order() -> None:
    assert segments_from_cuts([180000, 61200], 600_000) == segments_from_cuts([61200, 180000], 600_000)
    assert [s["startMs"] for s in segments_from_cuts([180000, 61200], 600_000)] == [0, 61200, 180000]


def test_the_floor_is_a_parameter() -> None:
    assert segments_from_cuts([61200, 61320], 100_000, min_segment_ms=100) == [
        {"startMs": 0, "endMs": 61200},
        {"startMs": 61200, "endMs": 61320},
        {"startMs": 61320, "endMs": 100_000},
    ]


def test_proposals_are_placed_in_source_time() -> None:
    out = propose(LOG, 600_000, 9000)
    assert out["cuts"][0] == {"proxyMs": 61200, "score": 0.731, "sourceMs": 70200}
    assert out["segments"][0] == {"startMs": 9000, "endMs": 70200, "proxyStartMs": 0, "proxyEndMs": 61200}
    assert out["segments"][-1]["endMs"] == 609_000
    assert out["durationMs"] == 600_000


def test_the_cli_proposes_from_a_log(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = tmp_path / "showinfo.txt"
    path.write_text(LOG, encoding="utf-8")
    assert main(["--showinfo", str(path), "--duration-ms", "600000", "--offset-ms", "9000"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert len(out["segments"]) == 3
    assert out["segments"][1] == {"startMs": 70200, "endMs": 189000, "proxyStartMs": 61200, "proxyEndMs": 180000}


# ── the stage ──────────────────────────────────────────────────────────────────


def spec(params: dict[str, Any] | None = None) -> JobSpec:
    return JobSpec.from_payload({
        "contractVersion": CONTRACT_VERSION, "jobId": "job-c", "type": "cuts", "resourceClass": "cpu_small", "attemptNumber": 1,
        "inputs": {"videoAssetId": "asset-1", "params": params if params is not None else {"videoAssetId": "asset-1", "proxy": {"fps": 25, "sourceOffsetMs": 9000}}},
        "outputPrefix": "inference/job-c/1/", "budget": {"maxRuntimeSeconds": 600, "maxCostUsdCents": 50},
    })


class FakeClient:
    def __init__(self) -> None:
        self.asked: list[str] = []

    def input_url(self, _job_id: str, role: str, key: str | None = None) -> str:
        self.asked.append(role)
        return f"https://storage.test/{role}"

    def presign_output(self, _job_id: str, key: str, _ct: str) -> str:
        return f"https://storage.test/put/{key}"


class FakeProgress:
    def set(self, *_a: object, **_k: object) -> None:
        pass


@pytest.fixture
def ctx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    context = StageContext(job=spec(), work_dir=tmp_path, client=FakeClient(), http=None, progress=FakeProgress())  # type: ignore[arg-type]
    uploaded: dict[str, Any] = {}

    def fake_download(_c: object, _url: str, target: Path) -> int:
        target.write_bytes(b"not a video")
        return 11

    def fake_upload(_c: object, _url: str, source: Path, _ct: str) -> int:
        uploaded["payload"] = json.loads(source.read_bytes())
        return source.stat().st_size

    monkeypatch.setattr(cuts_stage, "download", fake_download)
    monkeypatch.setattr(cuts_stage, "upload", fake_upload)
    context.uploaded = uploaded  # type: ignore[attr-defined]
    return context


def test_the_stage_reads_the_proxy_by_role_and_writes_proposals_in_source_time(ctx) -> None:
    seen: dict[str, float] = {}

    def detector(_path: Path, threshold: float) -> str:
        seen["threshold"] = threshold
        return LOG

    result = cuts_stage._cuts(ctx, detector=detector, duration=lambda _p: 600_000)
    assert ctx.client.asked == ["proxy"]
    assert seen["threshold"] == 0.4
    assert result.summary["cuts"] == 3
    assert [s["startMs"] for s in result.summary["segments"]] == [9000, 70200, 189000]
    assert result.artifacts[0]["role"] == "cuts"
    payload = ctx.uploaded["payload"]
    assert payload["role"] == "cuts" and payload["threshold"] == 0.4 and payload["proxy"]["sourceOffsetMs"] == 9000
    assert payload["cuts"][2]["sourceMs"] == 189000


def test_the_threshold_and_floor_are_parameters(ctx) -> None:
    ctx.job = spec({"proxy": {"fps": 25, "sourceOffsetMs": 0}, "threshold": 0.6, "minSegmentMs": 100})
    seen: dict[str, float] = {}

    def detector(_path: Path, threshold: float) -> str:
        seen["threshold"] = threshold
        return LOG

    result = cuts_stage._cuts(ctx, detector=detector, duration=lambda _p: 600_000)
    assert seen["threshold"] == 0.6
    assert len(result.summary["segments"]) == 4


@pytest.mark.parametrize(
    "params",
    [
        {"videoAssetId": "a"},
        {"proxy": {"fps": 25, "sourceOffsetMs": 0}, "threshold": 1.5},
        {"proxy": {"fps": 25, "sourceOffsetMs": 0}, "minSegmentMs": -1},
    ],
    ids=["no-clock", "bad-threshold", "bad-floor"],
)
def test_refuses_a_misdispatched_job_before_reading(ctx, params) -> None:
    ctx.job = spec(params)
    with pytest.raises(StageRefusal):
        cuts_stage._cuts(ctx, detector=lambda _p, _t: LOG, duration=lambda _p: 1000)
    assert ctx.client.asked == []


def test_refuses_a_proxy_with_no_duration(ctx) -> None:
    with pytest.raises(StageRefusal, match="duration"):
        cuts_stage._cuts(ctx, detector=lambda _p, _t: LOG, duration=lambda _p: 0)
