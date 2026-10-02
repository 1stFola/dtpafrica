"""The detect stage: sampling arithmetic, the envelope, provenance, and what it counts.

The model itself is not under test here — it is torchvision's, it needs a GPU to be
worth timing, and this suite has never run FFmpeg either. What *is* under test is
everything around it, which is where the mistakes that survive to production live: a
frame index mapped to the wrong timestamp, a ball counted twice, bytes not accounted,
a prediction with no model version behind it.

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
from dtp_vision_worker.runner import StageContext, StageRefusal
from dtp_vision_worker.stages import detect as detect_stage

MODEL = "6a1b2c3d-0000-4000-8000-000000000001"

#: Inputs exactly as the control plane builds them when a worker claims a job:
#: `modelVersionIds` and `datasetVersionId` at the top, the job's `inputSpec` under
#: `params`. The proxy clock is the one `VisionJobsService` resolves from the variant.
DISPATCHED = {
    "videoAssetId": "asset-1",
    "modelVersionIds": [MODEL],
    "params": {"videoAssetId": "asset-1", "proxy": {"fps": 25, "sourceOffsetMs": 0}},
}


def spec(inputs: dict[str, Any] | None = None) -> JobSpec:
    return JobSpec.from_payload(
        {
            "contractVersion": CONTRACT_VERSION,
            "jobId": "job-detect",
            "type": "detect",
            "resourceClass": "gpu_24gb",
            "attemptNumber": 1,
            "inputs": inputs if inputs is not None else DISPATCHED,
            "outputPrefix": "inference/job-detect/1/",
            "budget": {"maxRuntimeSeconds": 3600, "maxCostUsdCents": 500},
        }
    )


def dispatched(**overrides: Any) -> dict[str, Any]:
    """`DISPATCHED` with the stage parameters changed, keeping the rest intact."""
    params = {**DISPATCHED["params"], **overrides}
    return {**DISPATCHED, "params": params}


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


# ── counting ─────────────────────────────────────────────────────────────────


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


# ── clocks ───────────────────────────────────────────────────────────────────


def test_first_frame_sits_at_time_zero(ctx, monkeypatch):
    """`frame_000001.jpg` is t=0, not one interval in.

    Off by one here would put every detection in a 96-minute match half a second late.
    """
    stub_frames(monkeypatch, 3)
    detect_stage._detect(ctx, detector=detector_returning([PERSON], [PERSON], [PERSON]))
    frames = ctx.uploaded["payload"]["frames"]
    assert [f["proxyTimeMs"] for f in frames] == [0, 500, 1000]
    assert [f["sampleIndex"] for f in frames] == [1, 2, 3]


def test_timestamps_follow_the_sample_rate_from_params(ctx, monkeypatch):
    """`sampleFps` lives under `inputs.params`, where the control plane writes the
    job's inputSpec. The first version of the stage read it off the top level of
    `inputs` -- where nothing ever put it -- so an operator's sample rate was ignored
    in favour of the default and no test noticed, because the test made the same
    mistake."""
    stub_frames(monkeypatch, 3)
    ctx.job = spec(dispatched(sampleFps=1))
    detect_stage._detect(ctx, detector=detector_returning([], [], []))
    frames = ctx.uploaded["payload"]["frames"]
    assert [f["proxyTimeMs"] for f in frames] == [0, 1000, 2000]


def test_a_sample_rate_at_the_top_level_of_inputs_is_ignored(ctx, monkeypatch):
    """The other half of the bug above: the old location must not keep working, or the
    two places would drift apart again."""
    stub_frames(monkeypatch, 2)
    ctx.job = spec({**DISPATCHED, "sampleFps": 1})
    detect_stage._detect(ctx, detector=detector_returning([], []))
    assert [f["proxyTimeMs"] for f in ctx.uploaded["payload"]["frames"]] == [0, 500]


def test_source_time_is_proxy_time_plus_the_offset(ctx, monkeypatch):
    """Both clocks on every frame, like the envelope.

    A proxy trimmed nine seconds into the source has `sourceOffsetMs = 9000`; a label
    at proxy 500ms is at source 9500ms. Writing only proxy time would make every
    detection on a trimmed proxy nine seconds early the moment anyone compared it with
    an annotation, which is stored in source time.
    """
    stub_frames(monkeypatch, 3)
    ctx.job = spec(dispatched(proxy={"fps": 25, "sourceOffsetMs": 9000}))
    detect_stage._detect(ctx, detector=detector_returning([], [], []))
    frames = ctx.uploaded["payload"]["frames"]
    assert [f["proxyTimeMs"] for f in frames] == [0, 500, 1000]
    assert [f["sourceTimeMs"] for f in frames] == [9000, 9500, 10000]
    assert ctx.uploaded["payload"]["proxy"] == {"fps": 25.0, "sourceOffsetMs": 9000}


def test_frame_index_is_the_proxy_frame_floored(ctx, monkeypatch):
    """`frameIndex` is the envelope's: the frame in the 25fps proxy, not the sampled
    frame's ordinal. Sample 2 at 2fps is 500ms, which at 25fps is frame 12.5 -- and
    frame 12 covers [480ms, 520ms), so it is 12, not 13."""
    stub_frames(monkeypatch, 3)
    detect_stage._detect(ctx, detector=detector_returning([], [], []))
    frames = ctx.uploaded["payload"]["frames"]
    assert [f["frameIndex"] for f in frames] == [0, 12, 25]


def test_proxy_frame_index_floors_and_survives_float_noise():
    assert detect_stage.proxy_frame_index(500, 25) == 12
    assert detect_stage.proxy_frame_index(1000, 25) == 25
    # 999ms at 25fps is 24.975 -> frame 24; and a product that lands a hair under an
    # integer must not floor to the frame before.
    assert detect_stage.proxy_frame_index(999, 25) == 24
    assert detect_stage.proxy_frame_index(1000, 29.97) == 29
    assert detect_stage.proxy_frame_index(3000, 23.976) == 71


# ── the contract's shape ─────────────────────────────────────────────────────


def test_predictions_use_the_contract_classes_and_box_shape(ctx, monkeypatch):
    """The detector speaks COCO; the artifact speaks the contract. A reader of the
    artifact must never have to know what `sports ball` is."""
    stub_frames(monkeypatch, 1)
    detect_stage._detect(ctx, detector=detector_returning([PERSON, BALL]))
    detections = ctx.uploaded["payload"]["frames"][0]["detections"]
    assert detections == [
        {
            "class": "player",
            "confidence": 0.9,
            "box": {"x": 0.0, "y": 0.0, "width": 10.0, "height": 20.0},
            "rawLabel": "person",
        },
        {
            "class": "ball",
            "confidence": 0.5,
            "box": {"x": 5.0, "y": 5.0, "width": 3.0, "height": 3.0},
            "rawLabel": "sports ball",
        },
    ]
    # The mapping travels with the boxes, so the baseline's "every person is a
    # player" limitation is stated in the file rather than assumed by its reader.
    assert ctx.uploaded["payload"]["classes"] == {"person": "player", "sports ball": "ball"}


def test_every_mapped_class_is_one_the_contract_knows():
    for cls in detect_stage.DETECTION_CLASS_BY_LABEL.values():
        assert cls in detect_stage.CONTRACT_CLASSES


def test_a_frame_without_a_ball_says_so(ctx, monkeypatch):
    """Unknown beats wrong: no ball is a `ball_unknown` flag on the frame, never the
    last ball's box carried forward."""
    stub_frames(monkeypatch, 3)
    detect_stage._detect(ctx, detector=detector_returning([BALL], [PERSON], []))
    frames = ctx.uploaded["payload"]["frames"]
    assert [f["qualityFlags"] for f in frames] == [[], ["ball_unknown"], ["ball_unknown"]]
    assert frames[1]["detections"][0]["class"] == "player"
    assert frames[2]["detections"] == []


def test_refuses_a_label_the_contract_has_no_word_for(ctx, monkeypatch):
    """Dropping it silently would make a wiring bug look like an empty frame."""
    stub_frames(monkeypatch, 1)
    dog = {"label": "dog", "score": 0.9, "box": [0, 0, 1, 1]}
    with pytest.raises(RuntimeError, match="'dog'"):
        detect_stage._detect(ctx, detector=detector_returning([dog]))


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
    assert payload["role"] == "detections"
    assert payload["sampleFps"] == 2.0
    assert payload["minScore"] == detect_stage.MIN_SCORE
    assert payload["videoAssetId"] == "asset-1"


# ── provenance ───────────────────────────────────────────────────────────────


def test_the_artifact_and_the_completion_name_the_model_version(ctx, monkeypatch):
    """Phase 3's gate: every prediction carries its model version. It is written into
    the file, into the summary the control plane indexes, and onto the completion the
    control plane checks against the job it dispatched -- three places, because the
    file is in object storage, the summary is in Postgres, and the check is at the
    door."""
    stub_frames(monkeypatch, 1)
    result = detect_stage._detect(ctx, detector=detector_returning([PERSON]))
    assert ctx.uploaded["payload"]["modelVersionId"] == MODEL
    assert result.summary["modelVersionId"] == MODEL
    assert result.model_version_ids == [MODEL]


def test_carries_the_dataset_version_when_the_job_names_one(ctx, monkeypatch):
    stub_frames(monkeypatch, 1)
    ctx.job = spec({**DISPATCHED, "datasetVersionId": "dsv-9"})
    result = detect_stage._detect(ctx, detector=detector_returning([]))
    assert ctx.uploaded["payload"]["datasetVersionId"] == "dsv-9"
    assert result.summary["datasetVersionId"] == "dsv-9"


def test_a_pretrained_baseline_has_no_dataset_version(ctx, monkeypatch):
    """COCO weights were trained on nothing of DTP's; the artifact says `null`, not a
    plausible-looking id."""
    stub_frames(monkeypatch, 1)
    detect_stage._detect(ctx, detector=detector_returning([]))
    assert ctx.uploaded["payload"]["datasetVersionId"] is None


@pytest.mark.parametrize(
    "inputs",
    [
        {**DISPATCHED, "modelVersionIds": []},
        {**DISPATCHED, "modelVersionIds": [MODEL, "another"]},
        {k: v for k, v in DISPATCHED.items() if k != "modelVersionIds"},
    ],
    ids=["none", "two", "absent"],
)
def test_refuses_to_run_without_exactly_one_model_version(ctx, monkeypatch, inputs):
    """A detection nobody can attribute is not evidence. Refused before the proxy is
    downloaded, so a misdispatched job costs no transfer and no GPU minute."""
    stub_frames(monkeypatch, 1)
    ctx.job = spec(inputs)
    with pytest.raises(StageRefusal, match="exactly one modelVersionId"):
        detect_stage._detect(ctx, detector=detector_returning([]))
    assert ctx.progress.stages == []


@pytest.mark.parametrize(
    "proxy",
    [None, {}, {"fps": 25}, {"sourceOffsetMs": 0}, {"fps": 0, "sourceOffsetMs": 0},
     {"fps": 25, "sourceOffsetMs": "0"}, {"fps": True, "sourceOffsetMs": 0}],
    ids=["absent", "empty", "no-offset", "no-fps", "zero-fps", "string-offset", "bool-fps"],
)
def test_refuses_to_run_without_the_proxy_clock(ctx, monkeypatch, proxy):
    """Without the offset every source timestamp on a trimmed proxy is wrong by the
    trim; without the frame rate there is no frame index. Guessing either would
    produce a file that looks complete."""
    stub_frames(monkeypatch, 1)
    params = dict(DISPATCHED["params"])
    if proxy is None:
        params.pop("proxy")
    else:
        params["proxy"] = proxy
    ctx.job = spec({**DISPATCHED, "params": params})
    with pytest.raises(StageRefusal, match="params.proxy"):
        detect_stage._detect(ctx, detector=detector_returning([]))


def test_a_refusal_is_not_retryable():
    """The runner reads this to fail the job for good: the next attempt would be
    dispatched with the same inputs and refuse the same way."""
    assert StageRefusal("x").retryable is False


def test_reports_the_weights_checksum_the_detector_loaded(ctx, monkeypatch):
    """The control plane pins a model version to the first checksum it sees and refuses
    any later run whose weights differ. A detector that has none reports none -- a gap
    the control plane can see, rather than a fake it cannot."""
    stub_frames(monkeypatch, 1)

    def hashed(batch):
        return [[] for _ in batch]

    hashed.weights_sha256 = "f" * 64
    result = detect_stage._detect(ctx, detector=hashed)
    assert result.summary["weightsSha256"] == "f" * 64
    assert ctx.uploaded["payload"]["detector"]["weightsSha256"] == "f" * 64

    result = detect_stage._detect(ctx, detector=detector_returning([]))
    assert result.summary["weightsSha256"] is None


# ── accounting ───────────────────────────────────────────────────────────────


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
    assert [f["sampleIndex"] for f in frames] == list(range(1, count + 1))
    assert frames[-1]["proxyTimeMs"] == frame_timestamp_ms(count, 2.0)


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


def test_the_real_detector_advertises_its_device_and_its_weights():
    """A source scan, because `_torchvision_detector` cannot be called without torch.

    These are the two links in the provenance chain no test above can exercise: if the
    real detector stops setting `device`, every detect job bills zero GPU seconds; if
    it stops setting `weights_sha256`, every completion carries no checksum and the
    control plane can never pin a version to the bytes that ran. Mutation testing
    found the first hole -- removing the assignment broke nothing -- and the second is
    held the same way.
    """
    source = Path(detect_stage.__file__).read_text(encoding="utf-8")
    body = source[source.index("def _torchvision_detector") :]
    assert "run.device = device" in body, (
        "_torchvision_detector must advertise its device; _detect reads it to decide "
        "whether the time it measured was GPU time."
    )
    assert "run.weights_sha256 = _loaded_weights_sha256(weights.url)" in body, (
        "_torchvision_detector must report the checksum of the weights it loaded."
    )
