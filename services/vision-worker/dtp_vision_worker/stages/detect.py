"""detect — find players and the ball in a sampled proxy.

The first GPU stage, and the one Spike S0 exists to measure: *download → probe →
proxy → sample → off-the-shelf detector*. The contract has declared `detect` since
increment 2 and routed it to `gpu_24gb`, but no worker could run it — so the control
plane has been promising a stage that did not exist.

**Why torchvision rather than YOLO.** Ultralytics is the obvious off-the-shelf choice
and is AGPL-3.0, which would put a copyleft obligation on a pipeline DTP intends to
run as a service. `docs/licenses/OSS_REGISTER.md` exists because this project treats a
licence as a build input, so the default detector is torchvision's COCO-pretrained
Faster R-CNN: BSD-3-Clause, no dependency beyond the torch stack the GPU image already
needs, and COCO gives `person` and `sports ball` directly — which is exactly what S0
has to prove is findable in Nigerian grassroots footage.

It is a floor, not a recommendation. Phase 3 trains RF-DETR against the real dataset;
this is here to produce a number and a set of surprises.

**Every prediction names its model and its source time.** Phase 3's gate
(docs/vision/10-EVALUATION-AND-GATES.md) says every prediction carries model version,
source frame/time and confidence. So the stage refuses to run unless the job names
exactly one model version and the proxy's clock, writes both into the artifact, and
reports the model version on completion — where the control plane checks it against
the job it dispatched. A detection nobody can attribute is not evidence.

**The detector is injected.** Nothing above `run_detect` imports torch, and the import
happens inside the function that needs it. That matters for two reasons: the CPU image
has no torch and must not fail at start-up merely because the stage registry mentions
this module, and a test needs to exercise the sampling, envelope and accounting without
a 2 GB download.
"""

from __future__ import annotations

import json
import logging
import math
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..config import CONTRACT_VERSION
from ..media import DETECT_SAMPLE_FPS, PROXY_FPS, frame_timestamp_ms, sample_frames, sha256_file, probe
from ..runner import StageContext, StageRefusal, StageResult, download, upload

log = logging.getLogger(__name__)

#: The contract's detection classes (`DETECTION_CLASSES` in
#: packages/vision-contracts/src/prediction.ts). Mirrored here so a detector cannot
#: emit a class the review UI has never heard of; `tests/test_contract.py` checks the
#: two lists agree.
CONTRACT_CLASSES: tuple[str, ...] = ("player", "goalkeeper", "referee", "ball")

#: How the baseline detector's COCO vocabulary maps onto the contract.
#:
#: COCO has no goalkeeper and no referee, so every `person` is a `player` until a model
#: trained on DTP footage can tell them apart. That is a limitation of the baseline and
#: not a claim about the footage, which is why the mapping is written into every
#: artifact rather than assumed by whoever reads it.
DETECTION_CLASS_BY_LABEL: dict[str, str] = {"person": "player", "sports ball": "ball"}

#: COCO classes worth keeping. The model knows eighty; a football pipeline cares about
#: two, and carrying the rest would bloat every artifact with detected handbags.
KEEP_CLASSES = frozenset(DETECTION_CLASS_BY_LABEL)

#: Below this the boxes are noise. Deliberately low for the ball, which is small, often
#: blurred and the hardest thing in the frame — S0 needs to learn how bad that is rather
#: than hide it behind a confident-looking threshold.
MIN_SCORE = 0.30

#: A batch that fits a 24 GB card at 720p with room for the model itself.
BATCH_SIZE = 8

#: The artifact role the control plane looks for (`DETECTION_ARTIFACT_ROLE`).
ARTIFACT_ROLE = "detections"

#: One frame's raw detections, as the detector hands them back:
#: [{label, score, box:[x1,y1,x2,y2]}]
FrameDetections = list[dict[str, Any]]

#: Given a batch of frame paths, return one list of raw detections per frame.
Detector = Callable[[Sequence[Path]], list[FrameDetections]]


@dataclass
class DetectionRun:
    """What a pass over sampled frames produced: the per-frame boxes and the summary."""

    frames: list[dict[str, Any]] = field(default_factory=list)
    summary: dict[str, Any] = field(default_factory=dict)


def proxy_frame_index(proxy_ms: int, proxy_fps: float) -> int:
    """The proxy frame holding a proxy timestamp.

    Floored, not rounded, for the same reason the dataset export floors
    (docs/vision/26-PHASE-2-INCREMENT-5.md): the frame at index *n* covers
    `[n/fps, (n+1)/fps)`, so a timestamp inside that window belongs to *n*. The small
    epsilon absorbs float noise like `24.999999` that would otherwise floor to the
    frame before.
    """
    return int(math.floor(proxy_ms * proxy_fps / 1000 + 1e-9))


def to_prediction(raw: dict[str, Any]) -> dict[str, Any]:
    """One raw detector box into the contract's `DetectionPrediction` shape.

    Refuses a label outside the mapping rather than dropping it: a detector emitting a
    class this pipeline has no word for is a wiring bug, and silently discarding its
    output would turn that bug into a quietly emptier artifact.
    """
    label = raw["label"]
    cls = DETECTION_CLASS_BY_LABEL.get(label)
    if cls is None:
        raise RuntimeError(f"detector returned label {label!r}, which maps to no contract class")
    x1, y1, x2, y2 = (float(v) for v in raw["box"])
    return {
        "class": cls,
        "confidence": round(float(raw["score"]), 4),
        "box": {
            "x": round(x1, 1),
            "y": round(y1, 1),
            "width": round(x2 - x1, 1),
            "height": round(y2 - y1, 1),
        },
        "rawLabel": label,
    }


def detect_frames(
    frames: Sequence[Path],
    run: Detector,
    fps: float = DETECT_SAMPLE_FPS,
    on_batch: Callable[[int, int], None] | None = None,
    *,
    proxy_fps: float = PROXY_FPS,
    source_offset_ms: int = 0,
) -> DetectionRun:
    """Batch the frames through the detector and count what came back.

    Extracted from the stage body so the benchmark harness (`dtp_vision_worker.bench`)
    measures the code that actually runs in production rather than a paraphrase of it. A
    throughput number produced by a second implementation of this loop would be measuring
    the wrong thing, and any drift between the two would be invisible.

    `proxy_fps` and `source_offset_ms` are the proxy's clock. The harness leaves them at
    their defaults because it measures throughput, not provenance; the stage passes the
    values the control plane resolved from the variant row.
    """
    per_frame: list[dict[str, Any]] = []
    kept = 0
    people = 0
    balls = 0
    frames_with_ball = 0

    for start in range(0, len(frames), BATCH_SIZE):
        batch = frames[start : start + BATCH_SIZE]
        results = run(batch)
        if len(results) != len(batch):
            # Silently dropping a frame would shift every timestamp after it, so the run
            # fails rather than producing a plausible-looking misaligned artifact.
            raise RuntimeError(
                f"detector returned {len(results)} results for {len(batch)} frames"
            )
        for offset, detections in enumerate(results):
            index = start + offset + 1  # frame_000001.jpg is the frame at t=0
            predictions = [to_prediction(d) for d in detections]
            ball_here = False
            for p in predictions:
                if p["class"] == "ball":
                    balls += 1
                    ball_here = True
                else:
                    people += 1
            if ball_here:
                frames_with_ball += 1
            kept += len(predictions)
            proxy_ms = frame_timestamp_ms(index, fps)
            per_frame.append(
                {
                    "sampleIndex": index,
                    "frameIndex": proxy_frame_index(proxy_ms, proxy_fps),
                    "proxyTimeMs": proxy_ms,
                    "sourceTimeMs": proxy_ms + source_offset_ms,
                    # Unknown beats wrong. No ball is a flag on the frame, never a box
                    # carried forward from the last frame that had one.
                    "qualityFlags": [] if ball_here else ["ball_unknown"],
                    "detections": predictions,
                }
            )
        if on_batch is not None:
            on_batch(start + len(batch), len(frames))

    return DetectionRun(
        frames=per_frame,
        summary={
            "framesSampled": len(frames),
            "sampleFps": fps,
            "detections": kept,
            "people": people,
            "balls": balls,
            # The single most useful number out of S0 after cost: if the ball is visible
            # in a fraction of frames, every downstream plan that assumes ball position
            # has to be rewritten. Better to learn it from one match than from a phase.
            "framesWithBall": frames_with_ball,
            "ballVisibilityPct": round(100 * frames_with_ball / max(1, len(frames)), 1),
        },
    )


def run_detect(ctx: StageContext) -> StageResult:
    return _detect(ctx, detector=None)


def _provenance(ctx: StageContext) -> tuple[str, str | None, float, int]:
    """The model version and proxy clock this job was dispatched with, or a refusal.

    Both come from the control plane. The worker could not invent either: it does not
    know which model the operator meant to run, and it cannot ask a presigned URL what
    its source offset is. Running without them would produce boxes that are unreviewable
    (no model) or misplaced in the source (no offset), so the stage refuses -- and marks
    the refusal non-retryable, because the next attempt would get the same inputs.
    """
    inputs = ctx.job.inputs or {}
    model_versions = inputs.get("modelVersionIds") or []
    if len(model_versions) != 1 or not isinstance(model_versions[0], str):
        raise StageRefusal(
            f"detect needs exactly one modelVersionId in the job inputs; got {model_versions!r}. "
            "The control plane resolves it at enqueue; a job without one predates contract 1.1.0."
        )

    params = inputs.get("params") or {}
    proxy = params.get("proxy") or {}
    fps = proxy.get("fps")
    offset = proxy.get("sourceOffsetMs")
    if not isinstance(fps, (int, float)) or isinstance(fps, bool) or fps <= 0:
        raise StageRefusal(
            f"detect needs params.proxy.fps (the proxy's constant frame rate); got {fps!r}"
        )
    if not isinstance(offset, int) or isinstance(offset, bool):
        raise StageRefusal(
            f"detect needs params.proxy.sourceOffsetMs as an integer; got {offset!r}"
        )

    dataset = inputs.get("datasetVersionId")
    return model_versions[0], (dataset if isinstance(dataset, str) else None), float(fps), offset


def _detect(ctx: StageContext, detector: Detector | None) -> StageResult:
    """The stage body, with the detector separable so a test can supply its own."""
    model_version_id, dataset_version_id, proxy_fps, source_offset_ms = _provenance(ctx)

    inputs = ctx.job.inputs or {}
    # Stage parameters live under `inputs.params`: that is where the control plane
    # puts the job's `inputSpec` when it builds the spec a worker claims. The first
    # version of this stage read `sampleFps` off the top level of `inputs`, where the
    # control plane never writes it, so the operator's sample rate was silently
    # ignored in favour of the default.
    params = inputs.get("params") or {}
    fps = float(params.get("sampleFps") or DETECT_SAMPLE_FPS)

    ctx.progress.set("download")
    # The proxy, never the source: it is constant-frame-rate, so a frame index maps to
    # a timestamp by arithmetic rather than by asking the decoder.
    url = ctx.client.input_url(ctx.job.job_id, "proxy")
    proxy = ctx.work_dir / "proxy.mp4"
    read = download(ctx, url, proxy)
    # Ball trajectory must normalize against the actual image that produced the
    # boxes, not a later proxy rendition with different dimensions.
    proxy_meta = probe(proxy)
    proxy_checksum = sha256_file(proxy)

    ctx.progress.set("sample")
    frames_dir = ctx.work_dir / "frames"
    frames = sample_frames(proxy, frames_dir, fps=fps)
    log.info("sampled %d frames at %s fps", len(frames), fps)

    ctx.progress.set("detect")
    run = detector or _torchvision_detector()
    inference_started = time.perf_counter()
    outcome = detect_frames(
        frames,
        run,
        fps=fps,
        on_batch=lambda done, total: ctx.progress.set(
            "detect", fraction=done / max(1, total)
        ),
        proxy_fps=proxy_fps,
        source_offset_ms=source_offset_ms,
    )
    inference_seconds = time.perf_counter() - inference_started
    # The detector says which device it ran on, so nothing here imports torch to find out.
    # An injected test detector has no `device`, so it reports no GPU time -- which is the
    # truth about a test.
    device = getattr(run, "device", None)
    on_gpu = device == "cuda"
    # Likewise the weights: the real detector hashes the checkpoint it loaded, and the
    # control plane records that hash on the model version the first time it is seen,
    # then refuses any later completion whose hash differs. A test detector has none,
    # and reports none, rather than a plausible-looking fake.
    weights_sha256 = getattr(run, "weights_sha256", None)

    ctx.progress.set("upload")
    key = f"{ctx.job.output_prefix}detections.json"
    payload = {
        "contractVersion": CONTRACT_VERSION,
        "role": ARTIFACT_ROLE,
        "videoAssetId": inputs.get("videoAssetId"),
        "modelVersionId": model_version_id,
        "datasetVersionId": dataset_version_id,
        "proxy": {"fps": proxy_fps, "sourceOffsetMs": source_offset_ms},
        "proxyChecksum": proxy_checksum,
        "imageWidth": proxy_meta.width,
        "imageHeight": proxy_meta.height,
        "proxyDurationMs": proxy_meta.duration_ms,
        "sourceChecksum": params.get("sourceChecksum"),
        "sampleFps": fps,
        "minScore": MIN_SCORE,
        "classes": dict(DETECTION_CLASS_BY_LABEL),
        "detector": {"weightsSha256": weights_sha256, "device": device},
        "frames": outcome.frames,
    }
    artifact = ctx.work_dir / "detections.json"
    artifact.write_bytes(json.dumps(payload).encode())
    put_url = ctx.client.presign_output(ctx.job.job_id, key, "application/json")
    written = upload(ctx, put_url, artifact, "application/json")

    return StageResult(
        artifacts=[
            {
                "key": key,
                "bucket": "derived",
                "bytes": written,
                "contentType": "application/json",
                "role": ARTIFACT_ROLE,
            }
        ],
        # Summary, not predictions. The bulk goes to object storage; only what the
        # control plane indexes on comes back over HTTP -- including the provenance it
        # will check before it accepts the completion.
        summary={
            **outcome.summary,
            "modelVersionId": model_version_id,
            "datasetVersionId": dataset_version_id,
            "weightsSha256": weights_sha256,
            "proxyFps": proxy_fps,
            "sourceOffsetMs": source_offset_ms,
            "proxyChecksum": proxy_checksum,
            "imageWidth": proxy_meta.width,
            "imageHeight": proxy_meta.height,
            "proxyDurationMs": proxy_meta.duration_ms,
            "sourceChecksum": params.get("sourceChecksum"),
        },
        model_version_ids=[model_version_id],
        bytes_read=read,
        bytes_written=written,
        class_a_operations=1,
        class_b_operations=1,
        # Inference time only. Download, sampling and upload are billed as wall clock like
        # any other stage; counting them as GPU seconds would flatter nothing and confuse
        # the one measurement Spike S0 exists to produce.
        gpu_seconds=inference_seconds if on_gpu else None,
    )


def _torchvision_detector() -> Detector:
    """COCO-pretrained Faster R-CNN, on the GPU when there is one.

    Imported here rather than at module scope so the CPU image can load the stage
    registry without the torch stack installed.
    """
    import torch  # noqa: PLC0415 — see the module note
    from torchvision.io import read_image  # noqa: PLC0415
    from torchvision.models.detection import (  # noqa: PLC0415
        FasterRCNN_ResNet50_FPN_Weights,
        fasterrcnn_resnet50_fpn,
    )

    weights = FasterRCNN_ResNet50_FPN_Weights.DEFAULT
    model = fasterrcnn_resnet50_fpn(weights=weights)
    model.eval()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        # Not fatal — it is how the stage is exercised locally — but on a match it is
        # the difference between minutes and hours, and a silent CPU fallback is how a
        # cost measurement comes out wrong by an order of magnitude.
        log.warning("no CUDA device visible; detecting on CPU will be far slower")
    model.to(device)

    categories = weights.meta["categories"]
    transforms = weights.transforms()

    def run(batch: Sequence[Path]) -> list[FrameDetections]:
        images = [transforms(read_image(str(path))).to(device) for path in batch]
        with torch.inference_mode():
            outputs = model(images)

        results: list[FrameDetections] = []
        for output in outputs:
            frame: FrameDetections = []
            for box, label, score in zip(
                output["boxes"].tolist(),
                output["labels"].tolist(),
                output["scores"].tolist(),
                strict=True,
            ):
                if score < MIN_SCORE:
                    continue
                name = categories[label]
                if name not in KEEP_CLASSES:
                    continue
                frame.append(
                    {
                        "label": name,
                        "score": round(float(score), 4),
                        "box": [round(float(v), 1) for v in box],
                    }
                )
            results.append(frame)
        return results

    # Read by `_detect` to decide whether the time it just measured was GPU time. An
    # attribute rather than a return value so `Detector` stays a plain callable and a test
    # can pass a lambda.
    run.device = device  # type: ignore[attr-defined]
    # The checkpoint torchvision just loaded, hashed from the file it cached. Reported so
    # the control plane can pin a model version to the bytes that actually ran rather
    # than to a URL that may one day serve something else.
    run.weights_sha256 = _loaded_weights_sha256(weights.url)  # type: ignore[attr-defined]
    return run


def _loaded_weights_sha256(url: str) -> str | None:
    """SHA-256 of the checkpoint torchvision cached for `url`, or None if not found.

    torchvision keeps downloads under `<hub dir>/checkpoints/<basename of url>`. None
    rather than a guess when the file is not where expected: an unreported checksum
    is a gap the control plane can see, a wrong one is a lie it cannot.
    """
    from urllib.parse import urlparse  # noqa: PLC0415

    try:
        from torch.hub import get_dir  # noqa: PLC0415

        cached = Path(get_dir()) / "checkpoints" / Path(urlparse(url).path).name
        if cached.is_file():
            return sha256_file(cached)
        log.warning("weights not found at %s; the completion will carry no checksum", cached)
    except Exception as exc:  # noqa: BLE001 - provenance must not fail the job
        log.warning("could not hash the loaded weights: %s", exc)
    return None
