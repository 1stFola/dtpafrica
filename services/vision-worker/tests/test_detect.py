"""The detect stage: sampling arithmetic, the envelope, provenance, and what it counts.

The model itself is not under test here — it is torchvision's, it needs a GPU to be
worth timing, and this suite has never run FFmpeg either. What *is* under test is
everything around it, which is where the mistakes that survive to production live: a
frame index mapped to the wrong timestamp, a ball counted twice, bytes not accounted,
a prediction with no model version behind it.

`_detect` takes the detector as an argument precisely so this can exist.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from types import SimpleNamespace

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
    "params": {"videoAssetId": "asset-1", "proxy": {"fps": 25, "sourceOffsetMs": 0}, "sourceChecksum": "a" * 64,
               "detector": {"configKey": detect_stage.DETECTOR_CONFIG_BASE}},
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

    def fake_download(_ctx, _url, path):
        path.write_bytes(b"x" * 4096)
        return 4096
    monkeypatch.setattr(detect_stage, "download", fake_download)
    monkeypatch.setattr(detect_stage, "probe", lambda _path: SimpleNamespace(width=1280, height=720, duration_ms=2500))

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
    assert "run.weights_sha256 = trained.sha256 if trained else _loaded_weights_sha256(weights.url)" in body, (
        "_torchvision_detector must report the checksum of the weights it loaded."
    )


# ── The detector config, and the ball-tiles pass (docs/vision/95) ─────────────


@pytest.mark.parametrize("detector", [None, {}, {"configKey": "builtin/torchvision/retinanet/COCO_V1"}, "plain"])
def test_refuses_a_detector_config_it_cannot_run_before_downloading(ctx, monkeypatch, detector):
    params = {k: v for k, v in DISPATCHED["params"].items() if k != "detector"}
    if detector is not None:
        params["detector"] = detector
    ctx.job = spec({**DISPATCHED, "params": params})
    asked = []
    monkeypatch.setattr(detect_stage, "download", lambda *_a: asked.append(1) or 0)
    with pytest.raises(StageRefusal, match="detector.configKey"):
        detect_stage._detect(ctx, detector=lambda batch: [[] for _ in batch])
    assert not asked


@pytest.mark.parametrize("config", ["DETECTOR_CONFIG_BASE", "DETECTOR_CONFIG_BALL_TILES"])
def test_reports_the_config_it_ran_in_the_artifact_and_the_summary(ctx, monkeypatch, config):
    stub_frames(monkeypatch, 2)
    key = getattr(detect_stage, config)
    ctx.job = spec(dispatched(detector={"configKey": key}))

    def run(batch):
        return [[] for _ in batch]
    run.tile_balls_added = 3
    result = detect_stage._detect(ctx, detector=run)
    assert result.summary["detectorConfig"] == key == ctx.uploaded["payload"]["detectorConfig"]
    tiles = result.summary["ballTiles"]
    if config == "DETECTOR_CONFIG_BASE":
        assert tiles is None
    else:
        assert tiles == {"fraction": 0.6, "minScore": 0.7, "mergeIou": 0.3, "ballsAdded": 3} == ctx.uploaded["payload"]["ballTiles"]


def test_ball_tiles_are_four_overlapping_corners_covering_the_frame():
    windows = detect_stage.ball_tile_windows(1280, 720)
    assert windows == [(0, 0, 768, 432), (0, 288, 768, 432), (512, 0, 768, 432), (512, 288, 768, 432)]
    # Every pixel is in some tile, and the middle in all four.
    for x, y in [(0, 0), (1279, 719), (640, 360), (1279, 0), (0, 719)]:
        assert any(x0 <= x < x0 + w and y0 <= y < y0 + h for x0, y0, w, h in windows)
    assert all(x0 <= 640 < x0 + w and y0 <= 360 < y0 + h for x0, y0, w, h in windows)


def ball(x, y, score, size=14):
    return {"label": "sports ball", "score": score, "box": [x, y, x + size, y + size]}


def test_tiles_add_a_confident_ball_the_whole_frame_missed():
    person = {"label": "person", "score": 0.99, "box": [100, 100, 140, 200]}
    merged, added = detect_stage.merge_ball_tiles([person], [ball(500, 400, 0.98)])
    assert merged == [person, ball(500, 400, 0.98)] and added == 1


def test_tiles_never_move_or_double_a_ball_the_whole_frame_found():
    whole = [ball(500, 400, 0.5)]
    merged, added = detect_stage.merge_ball_tiles(whole, [ball(502, 401, 0.99), ball(501, 400, 0.95)])
    assert merged == whole and added == 0


def test_tiles_keep_one_of_two_tiles_seeing_the_same_ball_the_more_confident():
    merged, added = detect_stage.merge_ball_tiles([], [ball(501, 400, 0.8), ball(500, 400, 0.97)])
    assert merged == [ball(500, 400, 0.97)] and added == 1


def test_tiles_add_no_unconfident_ball_and_no_person():
    tiled = [ball(500, 400, 0.69), {"label": "person", "score": 0.99, "box": [0, 0, 30, 90]}]
    assert detect_stage.merge_ball_tiles([], tiled) == ([], 0)
    assert detect_stage.merge_ball_tiles([], [ball(500, 400, 0.7)])[1] == 1


# ── Ball-tiles/v2: the colour check and the tile marker (docs/vision/95) ──────


def patch(rgb, w=14, h=14, background=(60, 130, 60)):
    """A box of the given colour on grass, as the colour check sees it: an RGB uint8 array."""
    import numpy as np

    img = np.zeros((h, w, 3), np.uint8)
    img[:] = background
    import cv2
    cv2.ellipse(img, (w // 2, h // 2), (w // 2 - 1, h // 2 - 1), 0, 0, 360, rgb, -1)
    return img


@pytest.mark.parametrize("rgb,ok", [((235, 235, 230), True), ((200, 200, 205), True),
                                    ((230, 210, 40), False), ((240, 120, 30), False), ((200, 30, 40), False), ((60, 130, 60), False)])
def test_the_colour_check_keeps_a_white_ball_and_refuses_warm_colours_and_grass(rgb, ok):
    assert detect_stage.ball_colour_ok(patch(rgb)) is ok


def test_the_colour_check_refuses_a_box_that_is_not_near_square():
    assert detect_stage.ball_colour_ok(patch((235, 235, 230), w=14, h=24)) is False
    import numpy as np

    assert detect_stage.ball_colour_ok(np.zeros((0, 0, 3), np.uint8)) is False


def test_v2_merges_only_tiled_balls_that_pass_the_check_and_marks_them():
    merged, added = detect_stage.merge_ball_tiles([], [ball(500, 400, 0.98), ball(900, 300, 0.97)], accept=lambda d: d["box"][0] == 500, mark=True)
    assert merged == [{**ball(500, 400, 0.98), "source": "ball_tiles"}] and added == 1
    # The whole frame's ball is never put to the check, nor marked.
    whole = [ball(100, 100, 0.6)]
    assert detect_stage.merge_ball_tiles(whole, [], accept=lambda d: False, mark=True) == (whole, 0)


def test_a_marked_ball_keeps_its_marker_in_the_contract_shape_and_nothing_else_does():
    assert detect_stage.to_prediction({**ball(10, 10, 0.9), "source": "ball_tiles"})["source"] == "ball_tiles"
    assert "source" not in detect_stage.to_prediction({**ball(10, 10, 0.9), "source": "elsewhere"})
    assert "source" not in detect_stage.to_prediction(ball(10, 10, 0.9))


def test_v2_reports_its_colour_settings_and_what_they_rejected(ctx, monkeypatch):
    stub_frames(monkeypatch, 2)
    ctx.job = spec(dispatched(detector={"configKey": detect_stage.DETECTOR_CONFIG_BALL_TILES_V2}))

    def run(batch):
        return [[] for _ in batch]
    run.tile_balls_added, run.tile_balls_rejected = 4, 7
    tiles = detect_stage._detect(ctx, detector=run).summary["ballTiles"]
    assert tiles["ballsAdded"] == 4 and tiles["colourRejected"] == 7 and tiles["source"] == "ball_tiles"
    assert tiles["colourCheck"] == {"ellipse": 0.4, "warmHueBelow": 38, "warmHueAbove": 165, "warmMinSaturation": 50, "warmMinValue": 70, "maxGreen": 0.15, "aspect": [0.85, 1.3]}


# ── Trained weights (docs/vision/103) ──────────────────────────────────────────

TRAINED_WEIGHTS = b"fine-tuned state dict"
TRAINED_SHA = hashlib.sha256(TRAINED_WEIGHTS).hexdigest()


def trained_job(**weights_over: Any) -> JobSpec:
    weights = {"key": "inference/train-1/1/weights.pt", "checksum": TRAINED_SHA, "configKey": "inference/train-1/1/train-config.json", **weights_over}
    return spec(dispatched(detector={"configKey": detect_stage.DETECTOR_CONFIG_TRAINED, "weights": weights}))


def serve_trained(ctx: StageContext, monkeypatch: pytest.MonkeyPatch, config: dict[str, Any] | None = None, weights: bytes = TRAINED_WEIGHTS) -> list[str]:
    """Downloads by key: the training config, the weights, then the proxy."""
    body = json.dumps(config if config is not None else {"configKey": detect_stage.DETECTOR_CONFIG_TRAINED, "weightsSha256": TRAINED_SHA,
                                                         "classes": list(detect_stage.TRAINED_CLASSES), "minSize": 720, "maxSize": 1280}).encode()
    fetched: list[str] = []
    ctx.client.input_url = lambda _job, role, key=None: f"https://storage.test/{key or role}"  # type: ignore[method-assign]

    def fake_download(_ctx, url, path):
        fetched.append(url.rsplit("/", 1)[-1])
        data = body if url.endswith("train-config.json") else weights if url.endswith("weights.pt") else b"x" * 4096
        path.write_bytes(data)
        return len(data)

    monkeypatch.setattr(detect_stage, "download", fake_download)
    return fetched


def test_a_trained_version_reports_its_own_classes_and_the_checksum_it_checked(ctx, monkeypatch):
    ctx.job = trained_job()
    fetched = serve_trained(ctx, monkeypatch)
    stub_frames(monkeypatch, 1)
    keeper = {"label": "goalkeeper", "score": 0.8, "box": [0.0, 0.0, 10.0, 30.0]}
    result = detect_stage._detect(ctx, detector=detector_returning([keeper, {"label": "ball", "score": 0.6, "box": [1.0, 1.0, 4.0, 4.0]}]))
    assert fetched == ["train-config.json", "weights.pt", "proxy"]  # weights checked before the proxy is fetched
    payload = ctx.uploaded["payload"]  # type: ignore[attr-defined]
    assert payload["classes"] == {c: c for c in detect_stage.TRAINED_CLASSES}
    assert [d["class"] for d in payload["frames"][0]["detections"]] == ["goalkeeper", "ball"]
    assert payload["detector"]["weightsSha256"] == TRAINED_SHA
    assert result.summary["weightsSha256"] == TRAINED_SHA
    assert result.summary["detectorConfig"] == detect_stage.DETECTOR_CONFIG_TRAINED


@pytest.mark.parametrize("weights_over,match", [({"checksum": None}, "needs params.detector.weights"), ({"configKey": None}, "needs params.detector.weights")])
def test_refuses_a_trained_version_without_its_weights(ctx, monkeypatch, weights_over, match):
    ctx.job = trained_job(**weights_over)
    serve_trained(ctx, monkeypatch)
    with pytest.raises(StageRefusal, match=match):
        detect_stage._detect(ctx, detector=detector_returning())


def test_refuses_weights_whose_bytes_are_not_the_versions(ctx, monkeypatch):
    ctx.job = trained_job()
    fetched = serve_trained(ctx, monkeypatch, weights=b"someone else's weights")
    with pytest.raises(StageRefusal, match="hash to"):
        detect_stage._detect(ctx, detector=detector_returning())
    assert "proxy" not in fetched


@pytest.mark.parametrize("config,match", [
    ({"configKey": "builtin/other", "weightsSha256": TRAINED_SHA, "classes": list(("player", "goalkeeper", "referee", "ball")), "minSize": 720, "maxSize": 1280}, "is for"),
    ({"configKey": "trained/torchvision/fasterrcnn_resnet50_fpn/v1", "weightsSha256": "0" * 64, "classes": ["player", "goalkeeper", "referee", "ball"], "minSize": 720, "maxSize": 1280}, "other weights"),
    ({"configKey": "trained/torchvision/fasterrcnn_resnet50_fpn/v1", "weightsSha256": TRAINED_SHA, "classes": ["player", "ball"], "minSize": 720, "maxSize": 1280}, "trained on classes"),
    ({"configKey": "trained/torchvision/fasterrcnn_resnet50_fpn/v1", "weightsSha256": TRAINED_SHA, "classes": ["player", "goalkeeper", "referee", "ball"]}, "no image sizes"),
])
def test_refuses_a_training_config_that_does_not_match(ctx, monkeypatch, config, match):
    ctx.job = trained_job()
    serve_trained(ctx, monkeypatch, config=config)
    with pytest.raises(StageRefusal, match=match):
        detect_stage._detect(ctx, detector=detector_returning())
