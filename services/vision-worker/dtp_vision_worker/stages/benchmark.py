"""benchmark — score a model version's detections against a frozen gold version.

A CPU stage. The predictions needed a GPU; comparing them with reviewed boxes is
arithmetic, and routing arithmetic to a card would bill GPU rates for it.

What it reads, all by **declared key**: the gold dataset's FiftyOne export
(`samples.json`, boxes per frame, normalised, 1-based) and one `detect` artifact
per gold member, each produced by the model version under test. The control plane
listed those keys in the job; the worker may fetch exactly them and nothing else.

What it refuses, before any number is produced:

- a detect artifact that names a different model version than the job -- scoring
  one model's boxes under another's name would be the registry lying about itself;
- a gold sample with no recorded frame size, because pixel boxes cannot be
  normalised against a size nobody wrote down;
- a gold member with no detect artifact listed, because a benchmark over a subset
  of the gold set is a benchmark of a different, undeclared dataset.

See docs/vision/30-PHASE-3-INCREMENT-3.md.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..config import CONTRACT_VERSION
from ..evaluate import Prediction, evaluate, gold_from_export, predictions_from_artifact
from ..runner import StageContext, StageRefusal, StageResult, download, upload

log = logging.getLogger(__name__)

ARTIFACT_ROLE = "benchmark"


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
    listed = params.get("detections") or []
    threshold = params.get("iou")
    classes = params.get("classes") or []
    if not isinstance(run_id, str) or not isinstance(gold_key, str):
        raise StageRefusal("benchmark needs params.benchmarkRunId and params.goldLabelsKey")
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool) or not 0 < threshold <= 1:
        raise StageRefusal(f"benchmark needs params.iou in (0, 1]; got {threshold!r}")
    if not isinstance(classes, list) or not classes:
        raise StageRefusal("benchmark needs params.classes")
    if not isinstance(listed, list):
        raise StageRefusal("benchmark needs params.detections as a list")

    ctx.progress.set("download")
    gold_path = ctx.work_dir / "gold.json"
    bytes_read = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=gold_key), gold_path)
    samples = json.loads(gold_path.read_bytes())["samples"]
    gold = gold_from_export(samples)
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
            f"{len(missing)} gold member(s) have no detect artifact listed: {', '.join(missing[:5])}"
        )

    predictions: dict[str, dict[int, list[Prediction]]] = {}
    for index, (asset_id, key) in enumerate(by_asset.items()):
        ctx.progress.set("download", fraction=index / max(1, len(by_asset)))
        width, height = sizes.get(asset_id, (None, None))
        if not width or not height:
            raise StageRefusal(f"the gold export records no frame size for asset {asset_id}")
        path = ctx.work_dir / f"detections-{index}.json"
        bytes_read += download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=key), path)
        artifact = json.loads(path.read_bytes())
        produced_by = artifact.get("modelVersionId")
        if produced_by != model_version_id:
            raise StageRefusal(
                f"detect artifact {key} was produced by model version {produced_by!r}, "
                f"but this benchmark scores {model_version_id}"
            )
        predictions[asset_id] = predictions_from_artifact(artifact, float(width), float(height))

    ctx.progress.set("score")
    report = evaluate(gold, predictions, [str(c) for c in classes], float(threshold))

    ctx.progress.set("upload")
    key = f"{ctx.job.output_prefix}benchmark.json"
    payload: dict[str, Any] = {
        "contractVersion": CONTRACT_VERSION,
        "role": ARTIFACT_ROLE,
        "benchmarkRunId": run_id,
        "modelVersionId": model_version_id,
        "datasetVersionId": dataset_version_id,
        "goldLabelsKey": gold_key,
        "detections": [{"videoAssetId": a, "key": k} for a, k in by_asset.items()],
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
