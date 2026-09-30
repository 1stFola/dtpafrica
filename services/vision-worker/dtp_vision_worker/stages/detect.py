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

**The detector is injected.** Nothing above `run_detect` imports torch, and the import
happens inside the function that needs it. That matters for two reasons: the CPU image
has no torch and must not fail at start-up merely because the stage registry mentions
this module, and a test needs to exercise the sampling, envelope and accounting without
a 2 GB download.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from dataclasses import dataclass, field

from ..config import CONTRACT_VERSION
from ..media import DETECT_SAMPLE_FPS, frame_timestamp_ms, sample_frames
from ..runner import StageContext, StageResult, download, upload

log = logging.getLogger(__name__)

#: COCO classes worth keeping. The model knows eighty; a football pipeline cares about
#: two, and carrying the rest would bloat every artifact with detected handbags.
KEEP_CLASSES = {"person", "sports ball"}

#: Below this the boxes are noise. Deliberately low for the ball, which is small, often
#: blurred and the hardest thing in the frame — S0 needs to learn how bad that is rather
#: than hide it behind a confident-looking threshold.
MIN_SCORE = 0.30

#: A batch that fits a 24 GB card at 720p with room for the model itself.
BATCH_SIZE = 8

#: One frame's detections: [{label, score, box:[x1,y1,x2,y2]}]
FrameDetections = list[dict[str, Any]]

#: Given a batch of frame paths, return one list of detections per frame.
Detector = Callable[[Sequence[Path]], list[FrameDetections]]


@dataclass
class DetectionRun:
    """What a pass over sampled frames produced: the per-frame boxes and the summary."""

    frames: list[dict[str, Any]] = field(default_factory=list)
    summary: dict[str, Any] = field(default_factory=dict)


def detect_frames(
    frames: Sequence[Path],
    run: Detector,
    fps: float = DETECT_SAMPLE_FPS,
    on_batch: Callable[[int, int], None] | None = None,
) -> DetectionRun:
    """Batch the frames through the detector and count what came back.

    Extracted from the stage body so the benchmark harness (`dtp_vision_worker.bench`)
    measures the code that actually runs in production rather than a paraphrase of it. A
    throughput number produced by a second implementation of this loop would be measuring
    the wrong thing, and any drift between the two would be invisible.
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
            ball_here = False
            for d in detections:
                if d["label"] == "person":
                    people += 1
                elif d["label"] == "sports ball":
                    balls += 1
                    ball_here = True
            if ball_here:
                frames_with_ball += 1
            kept += len(detections)
            per_frame.append(
                {
                    "frameIndex": index,
                    "proxyTimestampMs": frame_timestamp_ms(index, fps),
                    "detections": detections,
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


def _detect(ctx: StageContext, detector: Detector | None) -> StageResult:
    """The stage body, with the detector separable so a test can supply its own."""
    params = ctx.job.inputs or {}
    fps = float(params.get("sampleFps") or DETECT_SAMPLE_FPS)

    ctx.progress.set("download")
    # The proxy, never the source: it is constant-frame-rate, so a frame index maps to
    # a timestamp by arithmetic rather than by asking the decoder.
    url = ctx.client.input_url(ctx.job.job_id, "proxy")
    proxy = ctx.work_dir / "proxy.mp4"
    read = download(ctx, url, proxy)

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
    )
    inference_seconds = time.perf_counter() - inference_started
    # The detector says which device it ran on, so nothing here imports torch to find out.
    # An injected test detector has no `device`, so it reports no GPU time -- which is the
    # truth about a test.
    on_gpu = getattr(run, "device", None) == "cuda"

    ctx.progress.set("upload")
    key = f"{ctx.job.output_prefix}detections.json"
    payload = {
        "contractVersion": CONTRACT_VERSION,
        "sampleFps": fps,
        "minScore": MIN_SCORE,
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
                "role": "detections",
            }
        ],
        # Summary, not predictions. The bulk goes to object storage; only what the
        # control plane indexes on comes back over HTTP.
        summary=outcome.summary,
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
    return run
