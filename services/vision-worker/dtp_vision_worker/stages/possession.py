"""CPU possession candidates over pinned trajectory and player observations."""
from __future__ import annotations

import json
import re
from typing import Iterator

from ..ball_trajectory import Smoother, VERSION as BALL_VERSION, INDEX_ROLE as BALL_ROLE
from ..config import CONTRACT_VERSION
from ..jsonstream import fields, items, JsonStreamError
from ..media import sha256_file
from ..possession import Config, PlayerIndex, build, INDEX_ROLE, CHUNK_ROLE
from ..possession_constraints import Constraints, FootballConfig
from ..runner import StageContext, StageRefusal, StageResult, download, upload


def run_possession(ctx: StageContext) -> StageResult:
    inputs = ctx.job.inputs or {}
    params = inputs.get("params") or {}
    ball = params.get("ball") or {}
    tracks = params.get("tracks") or {}
    if inputs.get("modelVersionIds") or not ball.get("key") or not tracks.get("key"):
        raise StageRefusal("possession needs declared ball and track inputs and loads no new model")
    for value in (params.get("sourceChecksum"), params.get("proxyChecksum"), params.get("detectionsChecksum"), ball.get("indexChecksum"), tracks.get("checksum")):
        if not isinstance(value, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", value):
            raise StageRefusal("possession needs pinned source, proxy, detections, ball and track checksums")
    players = None
    try:
        proxy = params.get("proxy") or {}
        clock = Smoother(fps=proxy.get("fps"), source_offset_ms=proxy.get("sourceOffsetMs"), source_duration_ms=params.get("sourceDurationMs"),
                         proxy_duration_ms=params.get("proxyDurationMs"), width=params.get("imageWidth"), height=params.get("imageHeight"), segments=params.get("segments"))
        config = Config.parse(params.get("possessionConfig"))
        mode = params.get("constraintMode", "image")
        if mode not in {"image", "calibrated"} or (mode == "image" and ("footballConfig" in params or "calibrationSnapshot" in params)):
            raise ValueError("calibration evidence/configuration requires calibrated mode")
        constraints = Constraints(clock, params.get("calibrationSnapshot"), FootballConfig.parse(params.get("footballConfig"))) if mode == "calibrated" else None
        if constraints and constraints.snapshot.get("proxyChecksum") != params["proxyChecksum"]:
            raise ValueError("calibration proxy bytes differ from the pinned observations")
        chunk_ms = params.get("chunkMs", 60_000)
        if not isinstance(chunk_ms, int) or isinstance(chunk_ms, bool) or not 10_000 <= chunk_ms <= 600_000:
            raise ValueError("possession chunkMs must be 10000–600000")
        chunk_keys = ball.get("chunkKeys")
        if not isinstance(chunk_keys, list) or not chunk_keys or len(chunk_keys) > 6000 or any(not isinstance(k, str) or not k for k in chunk_keys) or len(set(chunk_keys)) != len(chunk_keys):
            raise ValueError("ball chunk keys must be explicit, distinct and bounded")
        ctx.progress.set("download")
        ball_path = ctx.work_dir / "ball-index.json"
        read = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=ball["key"]), ball_path)
        if sha256_file(ball_path) != ball["indexChecksum"]:
            raise ValueError("ball index checksum changed")
        index = json.loads(ball_path.read_text(encoding="utf-8"))
        if index.get("role") != BALL_ROLE or index.get("calculationVersion") != BALL_VERSION or index.get("videoAssetId") != inputs.get("videoAssetId"):
            raise ValueError("ball index role, calculation or asset mismatch")
        for name in ("sourceChecksum", "proxyChecksum", "detectionsChecksum", "imageWidth", "imageHeight", "proxy", "segments"):
            if index.get(name) != params.get(name):
                raise ValueError(f"ball index {name} differs from queued evidence")
        if index.get("detectorJobId") != params.get("detectorJobId") or index.get("detectorVersionId") != params.get("detectorVersionId") or index.get("frames") != clock.frames or index.get("windowStartMs") != clock.offset or index.get("windowEndMs") != clock.end_ms:
            raise ValueError("ball index detector or source window mismatch")
        chunks = index.get("chunks")
        if not isinstance(chunks, list) or any(not isinstance(c, dict) for c in chunks) or [c.get("key") for c in chunks] != chunk_keys:
            raise ValueError("ball index chunks differ from declared keys")
        track_path = ctx.work_dir / "tracks.json"
        read += download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=tracks["key"]), track_path)
        if sha256_file(track_path) != tracks["checksum"]:
            raise ValueError("track artifact checksum changed")
        header = fields(track_path, "tracks")
        if header.get("role") != "tracks" or header.get("videoAssetId") != inputs.get("videoAssetId") or header.get("trackerVersionId") != tracks.get("trackerVersionId") or header.get("detectJobId") != params.get("detectorJobId") or header.get("detectorVersionId") != params.get("detectorVersionId"):
            raise ValueError("tracks have different asset, tracker or detector lineage")
        for name in ("sourceChecksum", "proxyChecksum", "detectionsChecksum", "imageWidth", "imageHeight", "proxyDurationMs", "proxy"):
            if header.get(name) != params.get(name):
                raise ValueError(f"tracks {name} differs from queued evidence")
        cuts = header.get("cameraCuts")
        if not isinstance(cuts, list) or any(s["startMs"] not in cuts for s in clock.segments[1:]):
            raise ValueError("tracker must break at every declared camera boundary")
        if header.get("sampleFps") != clock.fps:
            raise ValueError("possession needs full-rate player observations")
        players = PlayerIndex(ctx.work_dir / "players.sqlite", clock, items(track_path, "tracks"))
        def ball_rows() -> Iterator[dict]:
            nonlocal read
            for n, chunk in enumerate(chunks):
                path = ctx.work_dir / f"ball-{n}.jsonl"
                read += download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=chunk["key"]), path)
                if sha256_file(path) != chunk.get("checksumSha256"):
                    raise ValueError("ball chunk checksum changed")
                count = 0
                with path.open(encoding="utf-8") as handle:
                    for line in handle:
                        count += 1
                        yield json.loads(line)
                if count != chunk.get("rows"):
                    raise ValueError("ball chunk row count mismatch")
                path.unlink()  # only this job's downloaded temporary chunk
        ctx.progress.set("propose")
        out_dir = ctx.work_dir / "possession"
        result = build(clock, ball_rows(), players, out_dir, config, chunk_ms, constraints)
    except (ValueError, TypeError, KeyError, AttributeError, JsonStreamError) as exc:
        raise StageRefusal(f"invalid possession evidence: {exc}") from exc
    finally:
        if players:
            players.close()
    ctx.progress.set("upload")
    artifacts = []
    written = 0
    for chunk in result["chunks"]:
        key = f"{ctx.job.output_prefix}possession/{chunk['file']}"
        size = upload(ctx, ctx.client.presign_output(ctx.job.job_id, key, "application/x-ndjson"), out_dir / chunk["file"], "application/x-ndjson")
        written += size
        chunk["key"] = key
        artifacts.append({"key": key, "bucket": "derived", "bytes": size, "contentType": "application/x-ndjson", "role": CHUNK_ROLE})
    payload = {"contractVersion": CONTRACT_VERSION, "role": INDEX_ROLE, "videoAssetId": inputs.get("videoAssetId"),
               "sourceChecksum": params["sourceChecksum"], "proxyChecksum": params["proxyChecksum"], "detectionsChecksum": params["detectionsChecksum"],
               "ballJobId": ball["jobId"], "ballIndexChecksum": ball["indexChecksum"], "trackJobId": tracks["jobId"], "tracksChecksum": tracks["checksum"],
               "trackerVersionId": tracks["trackerVersionId"], "detectorJobId": params["detectorJobId"], "detectorVersionId": params["detectorVersionId"],
               "proxy": proxy, "imageWidth": clock.width, "imageHeight": clock.height, "cameraSegments": clock.segments,
               "reviewState": "unreviewed", "coordinateBasis": "image_foot_proximity", **result}
    path = ctx.work_dir / "possession.json"
    path.write_text(json.dumps(payload, allow_nan=False), encoding="utf-8")
    key = f"{ctx.job.output_prefix}possession.json"
    size = upload(ctx, ctx.client.presign_output(ctx.job.job_id, key, "application/json"), path, "application/json")
    written += size
    artifacts.append({"key": key, "bucket": "derived", "bytes": size, "contentType": "application/json", "role": INDEX_ROLE})
    summary = {k: result[k] for k in ("calculationVersion", "frames", "candidateFrames", "unknownFrames", "candidateFrameCoverage", "reasons", "segments", "windowStartMs", "windowEndMs")}
    summary.update({"sourceChecksum": params["sourceChecksum"], "ballJobId": ball["jobId"], "trackJobId": tracks["jobId"],
                    "ballIndexChecksum": ball["indexChecksum"], "tracksChecksum": tracks["checksum"], "indexChecksum": sha256_file(path),
                    "chunks": len(result["chunks"]), "coordinateBasis": "image_foot_proximity", "reviewState": "unreviewed"})
    if constraints:
        summary.update(constraints.evidence())
    return StageResult(artifacts=artifacts, summary=summary, bytes_read=read, bytes_written=written, class_a_operations=len(artifacts), class_b_operations=2 + len(chunks))
