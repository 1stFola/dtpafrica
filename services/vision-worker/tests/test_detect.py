"""The detect stage: sampling arithmetic, the envelope, and what it counts.

The model itself is not under test here — it is torchvision's, it needs a GPU to be
worth timing, and this suite has never run FFmpeg either. What *is* under test is
everything around it, which is where the mistakes that survive to production live: a
frame index mapped to the wrong timestamp, a ball counted twice, bytes not accounted.

`_detect` takes the detector as an argument precisely so this can exist.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from dtp_vision_worker.config import CONTRACT_VERSION
from dtp_vision_worker.control_plane import JobSpec
from dtp_vision_worker.media import frame_timestamp_ms
from dtp_vision_worker.runner import StageContext
from dtp_vision_worker.stages import detect as detect_stage


def spec(inputs: dict[str, Any] | None = None) -> JobSpec:
    return JobSpec.from_payload(
        {
            "contractVersion": CONTRACT_VERSION,
            "jobId": "job-detect",
            "type": "detect",
            "resourceClass": "gpu_24gb",
            "attemptNumber": 1,
            "inputs": inputs if inputs is not None else {"videoAssetId": "asset-1"},
            "outputPrefix": "inference/job-detect/1/",
            "budget": {"maxRuntimeSeconds": 3600, "maxCostUsdCents": 500},
        }
    )


class FakeClient:
    def input_url(self, _job_id: str, role: str) -> str:
        self.asked_for = role
        return f"https://storage.test/{role}"

    def presign_output(self, _job_id: str, key: str, _ct: str) -> str:
        self.output_key = key
        return f"https://storage.test/put/{key}"


class FakeProgress:
    def __init__(self) -> None:
        self.stages: list[str] = []

    def set(self, stage: str, fraction: float | None = None) -> None:
        self.stages.append(stage)


@pytest.fixture
def ctx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A stage context whose download, upload and frame sampling are all stubbed.

    FFmpeg is not installed in CI or on a developer machine, and the existing suite has
    never invoked it. Stubbing the sampler keeps this about the arithmetic.
    """
    client = FakeClient()
    context = StageContext(
        job=spec(),
        work_dir=tmp_path,
        client=client,  # type: ignore[arg-type]
        http=None,  # type: ignore[arg-type]
        progress=FakeProgress(),  # type: ignore[arg-type]
    )

    monkeypatch.setattr(detect_stage, "download", lambda *_a, **_k: 4096)

    uploaded: dict[str, Any] = {}

    def fake_upload(_c: object, _url: str, source: Path, _ct: str) -> int:
        uploaded["payload"] = json.loads(source.read_bytes())
        return source.stat().st_size

    monkeypatch.setattr(detect_stage, "upload", fake_upload)
    context.uploaded = uploaded  # type: ignore[attr-defined]
    return context


def stub_frames(monkeypatch: pytest.MonkeyPatch, count: int):
    """Pretend FFmpeg sampled `count` frames."""

    def fake_sample(_source: Path, out_dir: Path, fps: float = 2.0, **_k: object) -> list[Path]:
        out_dir.mkdir(parents=True, exist_ok=True)
        paths = []
        for i in range(1, count + 1):
            path = out_dir / f"frame_{i:06d}.jpg"
            path.write_bytes(b"jpeg")
            paths.append(path)
        return paths

    monkeypatch.setattr(detect_stage, "sample_frames", fake_sample)


def detector_returning(*per_frame: list[dict[str, Any]]):
    """A detector that replays a fixed script, batch by batch."""
    script = list(per_frame)

    def run(batch):
        out = [script.pop(0) if script else [] for _ in batch]
        return out

    return run


PERSON = {"label": "person", "score": 0.9, "box": [0.0, 0.0, 10.0, 20.0]}
BALL = {"label": "sports ball", "score": 0.5, "box": [5.0, 5.0, 8.0, 8.0]}


def test_counts_people_balls_and_frames(ctx, monkeypatch):
    stub_frames(monkeypatch, 3)
    result = detect_stage._detect(
        ctx,
        detector=detector_returning([PERSON, PERSON, BALL], [PERSON], []),
    )

    assert result.summary["framesSampled"] == 3
    assert result.summary["people"] == 3
    assert result.summary["balls"] == 1
    assert result.summary["detections"] == 4


def test_ball_visibility_is_frames_not_detections(ctx, monkeypatch):
    """The number S0 exists to learn, and the easy way to get it wrong.

    Two balls in one frame is one frame with a ball. Counting detections would report
    200% visibility and quietly flatter the footage.
    """
    stub_frames(monkeypatch, 4)
    result = detect_stage._detect(
        ctx,
        detector=detector_returning([BALL, BALL], [], [BALL], []),
    )
    assert result.summary["balls"] == 3
    assert result.summary["framesWithBall"] == 2
    assert result.summary["ballVisibilityPct"] == 50.0


def test_first_frame_sits_at_time_zero(ctx, monkeypatch):
    """`frame_000001.jpg` is t=0, not one interval in.

    Off by one here would put every detection in a 96-minute match half a second late.
    """
    stub_frames(monkeypatch, 3)
    detect_stage._detect(ctx, detector=detector_returning([PERSON], [PERSON], [PERSON]))
    frames = ctx.uploaded["payload"]["frames"]
    assert [f["proxyTimestampMs"] for f in frames] == [0, 500, 1000]


def test_timestamps_follow_the_sample_rate(ctx, monkeypatch):
    stub_frames(monkeypatch, 3)
    ctx.job = spec({"videoAssetId": "asset-1", "sampleFps": 1})
    detect_stage._detect(ctx, detector=detector_returning([], [], []))
    frames = ctx.uploaded["payload"]["frames"]
    assert [f["proxyTimestampMs"] for f in frames] == [0, 1000, 2000]


def test_reads_the_proxy_not_the_source(ctx, monkeypatch):
    """The proxy is constant-frame-rate, which is what makes the arithmetic above true."""
    stub_frames(monkeypatch, 1)
    detect_stage._detect(ctx, detector=detector_returning([]))
    assert ctx.client.asked_for == "proxy"


def test_predictions_go_to_storage_and_only_a_summary_comes_back(ctx, monkeypatch):
    stub_frames(monkeypatch, 2)
    result = detect_stage._detect(ctx, detector=detector_returning([PERSON], [BALL]))

    assert result.artifacts[0]["role"] == "detections"
    assert result.artifacts[0]["key"].endswith("detections.json")
    # The per-frame boxes are in the artifact, not in the summary.
    assert "frames" not in result.summary
    assert len(ctx.uploaded["payload"]["frames"]) == 2


def test_artifact_records_the_contract_and_the_settings(ctx, monkeypatch):
    """A prediction file that does not say how it was produced cannot be reproduced."""
    stub_frames(monkeypatch, 1)
    detect_stage._detect(ctx, detector=detector_returning([]))
    payload = ctx.uploaded["payload"]
    assert payload["contractVersion"] == CONTRACT_VERSION
    assert payload["sampleFps"] == 2.0
    assert payload["minScore"] == detect_stage.MIN_SCORE


def test_accounts_for_bytes_and_operations(ctx, monkeypatch):
    """Cost accounting is the point of the spike; a stage that under-reports is useless."""
    stub_frames(monkeypatch, 1)
    result = detect_stage._detect(ctx, detector=detector_returning([]))
    assert result.bytes_read == 4096
    assert result.bytes_written > 0
    assert result.class_a_operations == 1
    assert result.class_b_operations == 1


def test_batches_across_more_frames_than_one_batch(ctx, monkeypatch):
    """Batch boundaries are where an index calculation goes wrong."""
    count = detect_stage.BATCH_SIZE * 2 + 3
    stub_frames(monkeypatch, count)
    result = detect_stage._detect(ctx, detector=lambda batch: [[] for _ in batch])
    frames = ctx.uploaded["payload"]["frames"]
    assert result.summary["framesSampled"] == count
    assert len(frames) == count
    assert [f["frameIndex"] for f in frames] == list(range(1, count + 1))
    assert frames[-1]["proxyTimestampMs"] == frame_timestamp_ms(count, 2.0)


def test_refuses_a_detector_that_loses_a_frame(ctx, monkeypatch):
    """Silently dropping a frame would shift every timestamp after it."""
    stub_frames(monkeypatch, 2)
    with pytest.raises(RuntimeError, match="returned 1 results for 2 frames"):
        detect_stage._detect(ctx, detector=lambda _batch: [[]])


def test_gpu_seconds_are_reported_only_when_the_detector_was_on_a_gpu(ctx, monkeypatch):
    """The cost ledger hardcoded `gpuSeconds: 0`, which was true while every stage was
    CPU. `detect` is the first stage for which it is a lie, and GPU seconds are the
    expensive half of the unit economics Spike S0 exists to measure.

    The detector advertises its device; a CPU run reports no GPU time rather than
    pretending, which also keeps a local run from inventing GPU cost.
    """
    stub_frames(monkeypatch, 2)

    def on_cuda(batch):
        return [[] for _ in batch]

    on_cuda.device = "cuda"
    assert detect_stage._detect(ctx, detector=on_cuda).gpu_seconds is not None

    def on_cpu(batch):
        return [[] for _ in batch]

    on_cpu.device = "cpu"
    assert detect_stage._detect(ctx, detector=on_cpu).gpu_seconds is None
    # And a plain lambda, which is what most of this file passes.
    assert detect_stage._detect(ctx, detector=lambda b: [[] for _ in b]).gpu_seconds is None


def test_the_real_detector_advertises_the_device_it_ran_on():
    """A source scan, because `_torchvision_detector` cannot be called without torch.

    It is the one link in the GPU-seconds chain no test above can exercise: if the real
    detector stops setting `device`, `_detect` sees no GPU, every detect job bills zero GPU
    seconds, and the cost model quietly loses the expensive half of the pipeline. Mutation
    testing found this hole -- removing the assignment broke nothing.
    """
    source = Path(detect_stage.__file__).read_text(encoding="utf-8")
    body = source[source.index("def _torchvision_detector") :]
    assert "run.device = device" in body, (
        "_torchvision_detector must advertise its device; _detect reads it to decide "
        "whether the time it measured was GPU time."
    )
