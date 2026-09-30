"""transcode — the normalised analysis proxy.

Produces the constant-frame-rate proxy everything downstream seeks against, plus
a few thumbnails. The master is never modified: it is write-once, and with no
object versioning available there is no undo. See docs/vision/05-STORAGE.md.
"""

from __future__ import annotations

import logging

from ..media import probe, thumbnail, transcode_proxy
from ..runner import StageContext, StageResult, download, upload

log = logging.getLogger(__name__)

#: Spread across the match rather than clustered at the start, so the poster
#: frames are not all of an empty pitch during the walk-out.
THUMBNAIL_POSITIONS = (0.05, 0.25, 0.5, 0.75)


def run_transcode(ctx: StageContext) -> StageResult:
    ctx.progress.set("download")
    url = ctx.client.input_url(ctx.job.job_id, "source")
    source = ctx.work_dir / "source"
    bytes_read = download(ctx, url, source)

    ctx.progress.set("probe")
    meta = probe(source)

    ctx.progress.set("transcode", 0.0)
    proxy_path = ctx.work_dir / "proxy.mp4"
    proxy_info = transcode_proxy(source, proxy_path)

    artifacts: list[dict] = []
    bytes_written = 0
    class_a = 0

    ctx.progress.set("upload", 0.6)
    proxy_key = f"{ctx.job.output_prefix}proxy.mp4"
    put_url = ctx.client.presign_output(ctx.job.job_id, proxy_key, "video/mp4")
    bytes_written += upload(ctx, put_url, proxy_path, "video/mp4")
    class_a += 1
    artifacts.append(
        {
            "key": proxy_key,
            "bucket": "derived",
            "bytes": proxy_path.stat().st_size,
            "contentType": "video/mp4",
            "role": "proxy",
        }
    )

    # Thumbnails come off the proxy, not the master: same timebase as everything
    # the reviewer will actually see.
    ctx.progress.set("thumbnails", 0.85)
    duration_ms = proxy_duration_ms(proxy_path) or meta.duration_ms
    if duration_ms:
        for fraction in THUMBNAIL_POSITIONS:
            at_ms = int(duration_ms * fraction)
            thumb_path = ctx.work_dir / f"t-{at_ms}.jpg"
            try:
                thumbnail(proxy_path, thumb_path, at_ms)
            except Exception as exc:  # noqa: BLE001
                # A missing thumbnail must not fail a transcode that succeeded.
                log.warning("thumbnail at %sms failed: %s", at_ms, exc)
                continue

            key = f"{ctx.job.output_prefix}t-{at_ms}.jpg"
            thumb_url = ctx.client.presign_output(ctx.job.job_id, key, "image/jpeg")
            bytes_written += upload(ctx, thumb_url, thumb_path, "image/jpeg")
            class_a += 1
            artifacts.append(
                {
                    "key": key,
                    "bucket": "derived",
                    "bytes": thumb_path.stat().st_size,
                    "contentType": "image/jpeg",
                    "role": "thumbnail",
                }
            )
    else:
        log.warning("no duration available; skipping thumbnails")

    return StageResult(
        artifacts=artifacts,
        summary={
            "proxy": {
                "key": proxy_key,
                "fps": proxy_info["fps"],
                "height": proxy_info["height"],
                "bytes": proxy_info["bytes"],
                "settingsHash": proxy_info["settingsHash"],
                # Which FFmpeg build made this file. The settings hash covers the recipe
                # only, and two images run it with different encoders.
                "encoder": proxy_info["encoder"],
                "durationMs": duration_ms,
            },
            "source": meta.as_summary(),
            # Carried forward because it changes how downstream stages treat
            # timestamps, and the control plane stores it on the asset.
            "sourceIsVariableFrameRate": meta.is_variable_frame_rate,
            "thumbnailCount": sum(1 for a in artifacts if a["role"] == "thumbnail"),
        },
        bytes_read=bytes_read,
        bytes_written=bytes_written,
        class_a_operations=class_a,
        class_b_operations=1,
    )


def proxy_duration_ms(path) -> int | None:
    """The proxy's own duration, which is what downstream seeking uses."""
    try:
        return probe(path).duration_ms
    except Exception as exc:  # noqa: BLE001
        log.warning("could not probe the proxy: %s", exc)
        return None
