"""Bounded CPU carry artifact producer; no ledger, metrics or publication writes."""
import json
import re

from ..ball_trajectory import Smoother
from ..event_carry import VERSION, MANIFEST_CHECKSUM, propose
from ..jsonstream import fields, items, JsonStreamError
from ..media import sha256_file
from ..carried_frames import load as load_carried
from ..evidence import same_evidence
from ..possession import PlayerIndex
from ..possession_constraints import carried_segment_ids
from ..runner import StageRefusal, StageResult, download, upload

MAX_BYTES = 256 * 1024


def run_events(ctx):
    inputs = ctx.job.inputs or {}
    params = inputs.get("params") or {}
    model = params.get("eventAlgorithm") or {}
    ids = inputs.get("modelVersionIds") or []
    players = None
    try:
        if ctx.job.resource_class != "cpu_small" or len(ids) != 1 or model.get("modelVersionId") != ids[0] or model.get("configKey") != VERSION or model.get("manifestChecksum") != MANIFEST_CHECKSUM or model.get("weightsChecksum") is not None:
            raise ValueError("events needs one registered weight-free carry rule version on CPU")
        if any(not isinstance(model.get(k), str) or not model[k].strip() for k in ("gitCommit", "workerImage")):
            raise ValueError("event rule needs commit and image provenance")
        index = params.get("possessionIndex")
        if not isinstance(index, dict) or index.get("calculationVersion") != "possession-candidates/v2" or index.get("constraintMode") != "calibrated" or index.get("videoAssetId") != inputs.get("videoAssetId") or index.get("role") != "possession":
            raise ValueError("events needs original calibrated possession evidence")
        source, tracks = params.get("possession") or {}, params.get("tracks") or {}
        for digest in (params.get("sourceChecksum"), source.get("indexChecksum"), tracks.get("checksum")):
            if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
                raise ValueError("events needs pinned source/possession/track bytes")
        if index.get("sourceChecksum") != params["sourceChecksum"] or index.get("tracksChecksum") != tracks["checksum"] or index.get("trackJobId") != tracks.get("jobId") or index.get("trackerVersionId") != tracks.get("trackerVersionId"):
            raise ValueError("queued event evidence has inconsistent track/source lineage")
        original = params.get("possessionSource") or {}
        clock = Smoother(fps=index["proxy"]["fps"], source_offset_ms=index["proxy"]["sourceOffsetMs"], source_duration_ms=params.get("sourceDurationMs"),
                         proxy_duration_ms=original.get("proxyDurationMs"), width=index.get("imageWidth"), height=index.get("imageHeight"), segments=index.get("cameraSegments"))
        if params.get("windowStartMs") != clock.offset or params.get("windowEndMs") != clock.end_ms or clock.end_ms - clock.offset > 300_000 or index.get("frames") != clock.frames:
            raise ValueError("events completes one original source window of at most five minutes")
        ctx.progress.set("download")
        path = ctx.work_dir / "possession.json"
        read = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=source["key"]), path)
        if path.stat().st_size > 1024 * 1024 or sha256_file(path) != source["indexChecksum"]:
            raise ValueError("original possession index changed")
        pinned = json.loads(path.read_bytes())
        if not same_evidence(pinned, index):
            raise ValueError("original possession index changed")
        index = pinned  # the checksum-pinned bytes, with the producer's own digits
        chunks = index.get("chunks")
        if not isinstance(chunks, list) or not chunks or len(chunks) > 256:
            raise ValueError("possession chunks must be explicit and bounded")
        track_path = ctx.work_dir / "tracks.json"
        read += download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=tracks["key"]), track_path)
        if sha256_file(track_path) != tracks["checksum"]:
            raise ValueError("original track bytes changed")
        header = fields(track_path, "tracks")
        if header.get("role") != "tracks" or header.get("videoAssetId") != inputs.get("videoAssetId") or header.get("trackerVersionId") != tracks["trackerVersionId"] or header.get("detectJobId") != index.get("detectorJobId") or header.get("detectorVersionId") != index.get("detectorVersionId") or header.get("sampleFps") != clock.fps:
            raise ValueError("event player evidence has different detector/tracker/frame lineage")
        for name in ("sourceChecksum", "proxyChecksum", "detectionsChecksum", "imageWidth", "imageHeight", "proxy"):
            if header.get(name) != index.get(name):
                raise ValueError(f"event player {name} differs from original possession")
        if header.get("proxyDurationMs") != original.get("proxyDurationMs") or not isinstance(header.get("cameraCuts"), list) or any(s["startMs"] not in header["cameraCuts"] for s in clock.segments[1:]):
            raise ValueError("player evidence must break at every camera boundary")
        players = PlayerIndex(ctx.work_dir / "players.sqlite", clock, items(track_path, "tracks"))
        carried = None
        if carried_segment_ids(index["calibrationSnapshot"]):
            # The possession run's pinned calibrate run: the same per-frame homographies it was judged with.
            carried, carried_read = load_carried(ctx, index["calibrationSnapshot"].get("carried"), carried_segment_ids(index["calibrationSnapshot"]), clock.fps, clock.offset)
            read += carried_read

        def rows():
            nonlocal read
            total, count = 0, 0
            for n, chunk in enumerate(chunks):
                path = ctx.work_dir / f"possession-{n}.jsonl"
                size = download(ctx, ctx.client.input_url(ctx.job.job_id, "declared", key=chunk["key"]), path)
                read += size; total += size
                if size > 4 * 1024 * 1024 or total > 16 * 1024 * 1024 or sha256_file(path) != chunk.get("checksumSha256"):
                    raise ValueError("possession chunk exceeds bounds or changed checksum")
                chunk_count = 0
                with path.open(encoding="utf-8") as handle:
                    for line in handle:
                        count += 1; chunk_count += 1
                        if count > 20_000:
                            raise ValueError("too many original possession segments")
                        yield json.loads(line)
                if chunk_count != chunk.get("segments"):
                    raise ValueError("possession chunk row count changed")
                path.unlink()
            if count != index.get("segments"):
                raise ValueError("possession index row count differs")
        ctx.progress.set("propose")
        events = propose(clock, rows(), players, index["calibrationSnapshot"], index["footballConfig"], carried)
        producer = {"algorithm": VERSION, "manifestChecksum": MANIFEST_CHECKSUM, "possessionJobId": source["jobId"], "possessionIndexChecksum": source["indexChecksum"],
                    "tracksChecksum": tracks["checksum"], "calibrationSnapshot": index["calibrationSnapshot"], "cameraSegments": index["cameraSegments"]}
        payload = {"schemaVersion": "event-inference/v2", "jobId": ctx.job.job_id, "attemptNumber": ctx.job.attempt_number, "videoAssetId": inputs["videoAssetId"],
                   "sourceChecksum": params["sourceChecksum"], "modelVersionId": ids[0], "weightsChecksum": None, "configKey": VERSION, "gitCommit": model["gitCommit"],
                   "workerImage": model["workerImage"], "taxonomyVersion": "2026.10.0", "coverage": {"startMs": clock.offset, "endMs": clock.end_ms, "complete": True}, "producer": producer, "events": events}
        body = json.dumps(payload, allow_nan=False).encode()
        if len(body) > MAX_BYTES:
            raise ValueError("split footage: event artifact exceeds 256 KiB")
    except (ValueError, TypeError, KeyError, AttributeError, JsonStreamError) as exc:
        raise StageRefusal(f"invalid event carry evidence: {exc}") from exc
    finally:
        if players:
            players.close()
    ctx.progress.set("upload")
    path = ctx.work_dir / "events.json"
    path.write_bytes(body)
    key = f"{ctx.job.output_prefix}events.json"
    size = upload(ctx, ctx.client.presign_output(ctx.job.job_id, key, "application/json"), path, "application/json")
    return StageResult(artifacts=[{"key": key, "bucket": "derived", "role": "event_inference", "contentType": "application/json", "bytes": size}],
                       summary={"modelVersionId": ids[0], "weightsSha256": None, "sourceChecksum": params["sourceChecksum"], "windowStartMs": clock.offset, "windowEndMs": clock.end_ms,
                                "eventCount": len(events), "eventArtifactSha256": sha256_file(path), "producer": producer, "reviewState": "unreviewed"},
                       model_version_ids=ids, bytes_read=read, bytes_written=size, class_a_operations=1, class_b_operations=2 + len(chunks))
