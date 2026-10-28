"""benchmark — score a model version's detections against a frozen gold version.

A CPU stage. The predictions needed a GPU; comparing them with reviewed boxes is
arithmetic, and routing arithmetic to a card would bill GPU rates for it.

What it reads, all by **declared key**: the dataset's FiftyOne export
(`samples.json`, boxes per frame, normalised, 1-based) and one `detect` artifact
per gold member, each produced by the model version under test. The control plane
listed those keys in the job; the worker may fetch exactly them and nothing else.
Only samples tagged `gold` are scored; a training dataset's train and val samples
are counted as `otherSplitSamples` and left alone.

What it refuses, before any number is produced:

- a detect artifact that names a different model version than the job -- scoring
  one model's boxes under another's name would be the registry lying about itself;
- a gold sample with no recorded frame size, because pixel boxes cannot be
  normalised against a size nobody wrote down;
- a gold member with no detect artifact listed, because a benchmark over a subset
  of the gold set is a benchmark of a different, undeclared dataset;
- an export with no gold sample at all.

See docs/vision/30-PHASE-3-INCREMENT-3.md.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..config import CONTRACT_VERSION
from ..evaluate import Prediction, evaluate, gold_from_export, predictions_from_artifact
from ..runner import StageContext, StageRefusal, StageResult, download, upload
from ..track_metrics import TrackedBox, gold_tracks_from_export, score_tracks, tracks_from_artifact

log = logging.getLogger(__name__)

ARTIFACT_ROLE = "benchmark"
#: The split tag the export gives gold members; the only split a benchmark scores.
GOLD_SPLIT = "gold"


def run_benchmark(ctx: StageContext) -> StageResult:
    inputs = ctx.job.inputs or {}
    params = inputs.get("params") or {}
    model_versions = inputs.get("modelVersionIds") or []
    if len(model_versions) != 1:
        raise StageRefusal(f"benchmark needs exactly one modelVersionId; got {model_versions!r}")
    model_version_id = model_versions[0]
    dataset_version_id = inputs.get("datasetVersionId")
    if not isinstance(dataset_version_id, str) or not dataset_version_id:
        raise StageRefusal("benchmark needs a datasetVersionId")

    run_id = params.get("benchmarkRunId")
    gold_key = params.get("goldLabelsKey")
    task = params.get("task") or "detect"
    if task not in ("detect", "track"):
        raise StageRefusal(f"benchmark cannot score task {task!r}")
    listed = params.get("predictions") or []
    threshold = params.get("iou")
    classes = params.get("classes") or []
    if not isinstance(run_id, str) or not isinstance(gold_key, str):
        raise StageRefusal("benchmark needs params.benchmarkRunId and params.goldLabelsKey")
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool) or not 0 < threshold <= 1:
        raise StageRefusal(f"benchmark needs params.iou in (0, 1]; got {threshold!r}")
    if not isinstance(classes, list) or not classes:
        raise StageRefusal("benchmark needs params.classes")
    if not isinstance(listed, list):
        raise StageRefusal("benchmark needs params.predictions as a list")

    ctx.progress.set("download")
    gold_path = ctx.work_dir / "gold.json"
    bytes_read = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=gold_key), gold_path)
    exported = json.loads(gold_path.read_bytes())["samples"]
    # A training dataset's export holds every split, each sample tagged with its own
    # (`tags`, FiftyOne's idiom). Only gold is scored: the control plane lists predictions
    # for gold members alone, so a train or val sample read as gold was refused as having
    # nothing to score. An untagged sample, as in a hand-made export, is still read as gold.
    samples = [s for s in exported if not s.get("tags") or GOLD_SPLIT in s["tags"]]
    other_split_samples = len(exported) - len(samples)
    if not samples:
        raise StageRefusal(f"the export has no gold sample to score against ({other_split_samples} in other splits)")
    gold = gold_tracks_from_export(samples) if task == "track" else gold_from_export(samples)
    sizes: dict[str, tuple[float | None, float | None]] = {
        str((s.get("provenance") or {}).get("video_asset_id")): (
            (s.get("metadata") or {}).get("frame_width"),
            (s.get("metadata") or {}).get("frame_height"),
        )
        for s in samples
    }

    by_asset = {str(d.get("videoAssetId")): str(d.get("key")) for d in listed if isinstance(d, dict)}
    missing = [g.asset_id for g in gold if g.asset_id not in by_asset]
    if missing:
        raise StageRefusal(
            f"{len(missing)} gold member(s) have no {task} artifact listed: {', '.join(missing[:5])}"
        )

    predictions: dict[str, dict[int, list[Prediction]]] = {}
    tracked: dict[str, dict[int, list[TrackedBox]]] = {}
    for index, (asset_id, key) in enumerate(by_asset.items()):
        ctx.progress.set("download", fraction=index / max(1, len(by_asset)))
        width, height = sizes.get(asset_id, (None, None))
        if not width or not height:
            raise StageRefusal(f"the gold export records no frame size for asset {asset_id}")
        path = ctx.work_dir / f"detections-{index}.json"
        bytes_read += download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=key), path)
        artifact = json.loads(path.read_bytes())
        produced_by = artifact.get("trackerVersionId") if task == "track" else artifact.get("modelVersionId")
        if produced_by != model_version_id:
            raise StageRefusal(
                f"{task} artifact {key} was produced by model version {produced_by!r}, "
                f"but this benchmark scores {model_version_id}"
            )
        if task == "track":
            tracked[asset_id] = tracks_from_artifact(artifact, float(width), float(height))
        else:
            predictions[asset_id] = predictions_from_artifact(artifact, float(width), float(height))

    ctx.progress.set("score")
    if task == "track":
        report = score_tracks(gold, tracked, [str(c) for c in classes], float(threshold))  # type: ignore[arg-type]
    else:
        report = evaluate(gold, predictions, [str(c) for c in classes], float(threshold))  # type: ignore[arg-type]

    ctx.progress.set("upload")
    key = f"{ctx.job.output_prefix}benchmark.json"
    payload: dict[str, Any] = {
        "contractVersion": CONTRACT_VERSION,
        "role": ARTIFACT_ROLE,
        "benchmarkRunId": run_id,
        "modelVersionId": model_version_id,
        "datasetVersionId": dataset_version_id,
        "goldLabelsKey": gold_key,
        "task": task,
        "predictions": [{"videoAssetId": a, "key": k} for a, k in by_asset.items()],
        "otherSplitSamples": other_split_samples,
        **report,
    }
    artifact_path = ctx.work_dir / "benchmark.json"
    artifact_path.write_bytes(json.dumps(payload).encode())
    put_url = ctx.client.presign_output(ctx.job.job_id, key, "application/json")
    written = upload(ctx, put_url, artifact_path, "application/json")

    return StageResult(
        artifacts=[
            {"key": key, "bucket": "models", "bytes": written, "contentType": "application/json", "role": ARTIFACT_ROLE}
        ],
        summary={
            "benchmarkRunId": run_id,
            "modelVersionId": model_version_id,
            "datasetVersionId": dataset_version_id,
            "task": task,
            "otherSplitSamples": other_split_samples,
            **report,
        },
        # The stage ran no model; it scored one. The registry checks this list against
        # the job's task, and a benchmark is not a model-bound job.
        model_version_ids=[],
        bytes_read=bytes_read,
        bytes_written=written,
        class_a_operations=1,
        class_b_operations=1 + len(by_asset),
    )
