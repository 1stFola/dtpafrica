"""fingerprint — content identity.

Two hashes with different jobs. SHA-256 proves a dataset member is exactly the
bytes it claims to be. The perceptual fingerprint groups re-uploads of the same
match at different qualities, so they cannot be split across a train/test
boundary and inflate a benchmark.
"""

from __future__ import annotations

import logging

from ..media import perceptual_fingerprint, sha256_file
from ..runner import StageContext, StageResult, download

log = logging.getLogger(__name__)


def run_fingerprint(ctx: StageContext) -> StageResult:
    ctx.progress.set("download")
    url = ctx.client.input_url(ctx.job.job_id, "source")
    source = ctx.work_dir / "source"
    read = download(ctx, url, source)

    ctx.progress.set("sha256")
    checksum = sha256_file(source)

    ctx.progress.set("perceptual")
    # None is a valid answer for a clip too short or damaged to sample. An unknown
    # fingerprint is better than a misleading one that mis-groups a match.
    perceptual = perceptual_fingerprint(source)
    if perceptual is None:
        log.warning("could not compute a perceptual fingerprint for %s", ctx.job.job_id)

    return StageResult(
        summary={
            "checksumSha256": checksum,
            "perceptualFingerprint": perceptual,
            "bytes": source.stat().st_size,
        },
        bytes_read=read,
        class_b_operations=1,
    )
