"""train — fine-tune the Faster R-CNN baseline on a frozen dataset (docs/vision/98 step 4, /102).

A GPU stage. What it reads, all by **declared key**: the dataset's FiftyOne export
(`samples.json`, pinned by the checksum the control plane recorded when the run was
asked for) and the proxy of every train and val member. It decodes each labelled frame
once, fine-tunes, scores the val split with the benchmark's own evaluation, and writes
three objects to the models bucket under the job's prefix: the weights, the config they
were trained under, and the metrics.

What it refuses, before any GPU time is spent:
- an export whose bytes are not the ones the run was asked for;
- an export that disagrees with the member list (a member missing, or tagged with
  another split), or holds a label outside the contract's classes;
- no labelled train frame, or no labelled val frame: a run that cannot be scored is
  not worth paying for;
- a job that names a model version: a run produces one, it does not run one.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any, Callable

from ..config import CONTRACT_VERSION
from ..evaluate import ALL, GoldSample, Truth, evaluate
from ..runner import StageContext, StageRefusal, StageResult, download, upload
from ..train_data import ExportMismatch, Item, TrainFrame, frames_from_export

log = logging.getLogger(__name__)

TRAIN_VERSION = "train-fasterrcnn/v1"
TRAINED_DETECTOR_CONFIG = "trained/torchvision/fasterrcnn_resnet50_fpn/v1"
BASE_CONFIG = "builtin/torchvision/fasterrcnn_resnet50_fpn/COCO_V1"
CLASSES = ("player", "goalkeeper", "referee", "ball")
ROLES = {"weights": "weights", "config": "train_config", "metrics": "train_metrics"}
#: IoU for the val evaluation: the benchmark's.
VAL_IOU = 0.5
LIMITS = {"epochs": (1, 60), "batchSize": (1, 16), "learningRate": (1e-5, 0.1), "minSize": (256, 1440), "maxSize": (512, 2560)}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _hyperparameters(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise StageRefusal("train needs params.hyperparameters")
    out: dict[str, Any] = {}
    for name, (low, high) in LIMITS.items():
        value = raw.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
            raise StageRefusal(f"train needs hyperparameters.{name} in [{low}, {high}]; got {value!r}")
        out[name] = value
    for name in ("epochs", "batchSize", "minSize", "maxSize"):
        if not float(out[name]).is_integer():
            raise StageRefusal(f"train needs hyperparameters.{name} as a whole number; got {out[name]!r}")
        out[name] = int(out[name])
    seed = raw.get("seed")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise StageRefusal(f"train needs hyperparameters.seed as an integer; got {seed!r}")
    out["seed"] = seed
    return out


def _extract(proxy: Path, frames: list[TrainFrame], out_dir: Path) -> dict[tuple[str, int], tuple[Path, int, int]]:
    """Each wanted 1-based frame of one proxy as a JPEG: path, width, height. A frame that will not decode is left out."""
    import cv2  # noqa: PLC0415 - in both images, but only this stage needs it here

    out_dir.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(proxy))
    if not capture.isOpened():
        raise StageRefusal(f"the proxy {proxy.name} cannot be opened")
    found: dict[tuple[str, int], tuple[Path, int, int]] = {}
    try:
        for frame in sorted(frames, key=lambda f: f.frame_number):
            capture.set(cv2.CAP_PROP_POS_FRAMES, frame.frame_number - 1)
            ok, image = capture.read()
            if not ok or image is None:
                # Seeking to a clip's very last frame can fail; the caller counts what is missing.
                log.warning("frame %d of asset %s cannot be decoded", frame.frame_number, frame.asset_id)
                continue
            path = out_dir / f"{frame.asset_id}-{frame.frame_number:06d}.jpg"
            cv2.imwrite(str(path), image, [cv2.IMWRITE_JPEG_QUALITY, 95])
            found[(frame.asset_id, frame.frame_number)] = (path, int(image.shape[1]), int(image.shape[0]))
    finally:
        capture.release()
    return found


def _ball_and_mean(report: dict[str, Any]) -> dict[str, float | None]:
    by_name = {m["metric"]: m["value"] for m in report.get("metrics", []) if m.get("slice") == ALL}
    return {"ballRecall": by_name.get("recall:ball"), "ballAp": by_name.get("ap:ball"), "meanAp": by_name.get(f"ap:{ALL}")}


def run_train(ctx: StageContext, fit: Callable[..., Any] | None = None) -> StageResult:
    inputs = ctx.job.inputs or {}
    params = inputs.get("params") or {}
    if inputs.get("modelVersionIds"):
        raise StageRefusal("train produces a model version; it does not run one, so the job must name none")
    dataset_version_id = inputs.get("datasetVersionId")
    if not isinstance(dataset_version_id, str) or not dataset_version_id:
        raise StageRefusal("train needs a datasetVersionId")
    if params.get("version") != TRAIN_VERSION:
        raise StageRefusal(f"train needs params.version {TRAIN_VERSION!r}; got {params.get('version')!r}")
    if (params.get("base") or {}).get("configKey") != BASE_CONFIG:
        raise StageRefusal(f"train fine-tunes {BASE_CONFIG} only; got {(params.get('base') or {}).get('configKey')!r}")
    if list(params.get("classes") or []) != list(CLASSES):
        raise StageRefusal(f"train needs params.classes {list(CLASSES)}; got {params.get('classes')!r}")
    export = params.get("export") or {}
    export_key, export_checksum = export.get("key"), export.get("checksum")
    if not isinstance(export_key, str) or not isinstance(export_checksum, str) or len(export_checksum) != 64:
        raise StageRefusal("train needs params.export.key and a sha256 params.export.checksum")
    members_raw = params.get("members")
    if not isinstance(members_raw, list) or not members_raw:
        raise StageRefusal("train needs params.members")
    members: dict[str, str] = {}
    proxies: dict[str, str] = {}
    for m in members_raw:
        if not isinstance(m, dict) or m.get("split") not in ("train", "val") or not isinstance(m.get("videoAssetId"), str) or not isinstance(m.get("proxyKey"), str):
            raise StageRefusal(f"train member is not {{videoAssetId, split: train|val, proxyKey}}: {m!r}")
        members[m["videoAssetId"]] = m["split"]
        proxies[m["videoAssetId"]] = m["proxyKey"]
    hyper = _hyperparameters(params.get("hyperparameters"))

    ctx.progress.set("download")
    export_path = ctx.work_dir / "samples.json"
    bytes_read = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=export_key), export_path)
    if _sha256(export_path) != export_checksum.lower():
        raise StageRefusal("the export is not the one this run was asked for: its checksum differs")
    samples = json.loads(export_path.read_bytes()).get("samples") or []
    try:
        dataset = frames_from_export(samples, members, CLASSES)
    except ExportMismatch as exc:
        raise StageRefusal(str(exc)) from exc
    train_frames, val_frames = dataset.split("train"), dataset.split("val")
    if not train_frames or not val_frames:
        raise StageRefusal(f"train needs labelled frames in both splits; has {len(train_frames)} train and {len(val_frames)} val")

    # Decode every labelled frame once, proxy by proxy; boxes go to pixels here.
    by_asset: dict[str, list[TrainFrame]] = {}
    for frame in dataset.frames:
        by_asset.setdefault(frame.asset_id, []).append(frame)
    images: dict[tuple[str, int], tuple[Path, int, int]] = {}
    for index, (asset_id, frames) in enumerate(by_asset.items()):
        ctx.progress.set("decode", fraction=index / max(1, len(by_asset)))
        proxy_path = ctx.work_dir / "proxies" / f"{asset_id}.mp4"
        bytes_read += download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=proxies[asset_id]), proxy_path)
        images.update(_extract(proxy_path, frames, ctx.work_dir / "frames"))
        proxy_path.unlink(missing_ok=True)
    undecodable = [f for f in dataset.frames if (f.asset_id, f.frame_number) not in images]
    if len(undecodable) > max(1, len(dataset.frames) // 100):
        raise StageRefusal(f"{len(undecodable)} of {len(dataset.frames)} labelled frames cannot be decoded from their proxies")
    train_frames = [f for f in train_frames if (f.asset_id, f.frame_number) in images]
    val_frames = [f for f in val_frames if (f.asset_id, f.frame_number) in images]

    if fit is None:
        from .. import trainer  # noqa: PLC0415 - torch only on the GPU image

        fit = trainer.fit
        torch_version, torchvision_version = trainer.versions()
        from .detect import _loaded_weights_sha256 as weights_sha256  # noqa: PLC0415
    else:
        torch_version, torchvision_version, weights_sha256 = "injected", "injected", (lambda url: None)

    def item(frame: TrainFrame) -> Item:
        path, width, height = images[(frame.asset_id, frame.frame_number)]
        boxes = tuple((b.x * width, b.y * height, (b.x + b.width) * width, (b.y + b.height) * height) for b in frame.boxes)
        return Item(frame.asset_id, frame.frame_number, path, boxes, tuple(CLASSES.index(b.cls) + 1 for b in frame.boxes))

    def progress(stage: str, fraction: float) -> None:
        ctx.progress.set(stage, fraction=fraction)

    result = fit(
        train=[item(f) for f in train_frames], val=[item(f) for f in val_frames], classes=list(CLASSES),
        epochs=hyper["epochs"], batch_size=hyper["batchSize"], learning_rate=hyper["learningRate"], seed=hyper["seed"],
        min_size=hyper["minSize"], max_size=hyper["maxSize"], out_dir=ctx.work_dir / "out",
        on_progress=progress, weights_sha256=weights_sha256,
    )

    ctx.progress.set("score")
    gold: dict[str, GoldSample] = {}
    for frame in val_frames:
        sample = gold.setdefault(frame.asset_id, GoldSample(asset_id=frame.asset_id, slices=()))
        sample.frames[frame.frame_number] = [Truth(cls=b.cls, box=(b.x, b.y, b.width, b.height)) for b in frame.boxes]
    report = evaluate(list(gold.values()), result.predictions, list(CLASSES), VAL_IOU)
    headline = _ball_and_mean(report)

    ctx.progress.set("upload")
    weights_sha = _sha256(result.weights)
    prefix = ctx.job.output_prefix
    config = {
        "contractVersion": CONTRACT_VERSION, "version": TRAIN_VERSION, "configKey": TRAINED_DETECTOR_CONFIG,
        "architecture": "torchvision.models.detection.fasterrcnn_resnet50_fpn", "baseConfigKey": BASE_CONFIG,
        "baseWeightsSha256": result.base_weights_sha256, "classes": list(CLASSES), "numClasses": len(CLASSES) + 1,
        "labelIds": {c: i + 1 for i, c in enumerate(CLASSES)}, "minSize": hyper["minSize"], "maxSize": hyper["maxSize"],
        "hyperparameters": hyper, "datasetVersionId": dataset_version_id, "exportChecksum": export_checksum.lower(),
        "torch": torch_version, "torchvision": torchvision_version, "device": result.device, "weightsSha256": weights_sha,
    }
    metrics = {"contractVersion": CONTRACT_VERSION, "version": TRAIN_VERSION, "epochLosses": result.epoch_losses,
               "val": report, "headline": headline, "frames": {"train": len(train_frames), "val": len(val_frames),
               "skippedUncertain": dataset.skipped_uncertain, "undecodable": len(undecodable)}}
    written = 0
    artifacts: list[dict[str, Any]] = []
    for role, name, path, content_type in (
        (ROLES["weights"], "weights.pt", result.weights, "application/octet-stream"),
        (ROLES["config"], "train-config.json", None, "application/json"),
        (ROLES["metrics"], "train-metrics.json", None, "application/json"),
    ):
        if path is None:
            path = ctx.work_dir / name
            path.write_bytes(json.dumps(config if role == ROLES["config"] else metrics, indent=2).encode())
        key = f"{prefix}{name}"
        size = upload(ctx, ctx.client.presign_output(ctx.job.job_id, key, content_type), path, content_type)
        written += size
        artifacts.append({"key": key, "bucket": "models", "bytes": size, "contentType": content_type, "role": role})

    summary = {
        "version": TRAIN_VERSION, "configKey": TRAINED_DETECTOR_CONFIG, "datasetVersionId": dataset_version_id,
        "exportChecksum": export_checksum.lower(), "weightsKey": f"{prefix}weights.pt", "weightsSha256": weights_sha,
        "frames": {"train": len(train_frames), "val": len(val_frames), "skippedUncertain": dataset.skipped_uncertain, "undecodable": len(undecodable)},
        "boxes": {"train": dataset.box_counts("train"), "val": dataset.box_counts("val")},
        "epochs": hyper["epochs"], "finalLoss": result.epoch_losses[-1] if result.epoch_losses else None,
        "val": headline, "torch": torch_version, "torchvision": torchvision_version,
    }
    return StageResult(artifacts=artifacts, summary=summary, bytes_read=bytes_read, bytes_written=written,
                       class_a_operations=len(artifacts), class_b_operations=1 + len(by_asset),
                       gpu_seconds=result.gpu_seconds, model_version_ids=[])
