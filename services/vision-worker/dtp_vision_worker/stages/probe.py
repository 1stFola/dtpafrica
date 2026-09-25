"""probe — read container metadata.

The only media fact the control plane records without a worker having decoded
anything. Cheap, fast, and the prerequisite for transcode: there is no point
normalising a file whose codec or duration we cannot read.
"""

from __future__ import annotations

import json
import logging

from ..media import probe
from ..runner import StageContext, StageResult, download

log = logging.getLogger(__name__)


def run_probe(ctx: StageContext) -> StageResult:
    ctx.progress.set("download")
    url = ctx.client.input_url(ctx.job.job_id, "source")
    source = ctx.work_dir / "source"
    read = download(ctx, url, source)

    ctx.progress.set("ffprobe")
    meta = probe(source)

    # The full ffprobe payload goes to object storage; only the fields the
    # control plane indexes on come back over HTTP.
    key = f"{ctx.job.output_prefix}ffprobe.json"
    ctx.progress.set("upload")
    body = json.dumps(meta.raw, indent=2).encode()
    artifact_path = ctx.work_dir / "ffprobe.json"
    artifact_path.write_bytes(body)

    put_url = ctx.client.presign_output(ctx.job.job_id, key, "application/json")
    from ..runner import upload

    written = upload(ctx, put_url, artifact_path, "application/json")

    if meta.is_variable_frame_rate:
        # Not fatal, but it decides how the proxy has to be built: annotating VFR
        # footage against wall-clock time is how timestamps silently drift.
        log.warning("source is variable-frame-rate; proxy will be forced to CFR")

    return StageResult(
        artifacts=[
            {
                "key": key,
                "bucket": "derived",
                "bytes": written,
                "contentType": "application/json",
                "role": "ffprobe",
            }
        ],
        summary=meta.as_summary(),
        bytes_read=read,
        bytes_written=written,
        class_a_operations=1,
        class_b_operations=1,
    )
