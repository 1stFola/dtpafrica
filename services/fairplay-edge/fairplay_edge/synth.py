"""Synthetic camera feeds for development and the fixtures. NOT FOR PRODUCTION USE.

Each feed is an ffmpeg test pattern with the source label, a burned-in clock (wall clock
plus an optional deliberate offset, to millisecond resolution) and the frame number, pushed
to MediaMTX like a camera would. No real footage is involved, so no rights question arises
(docs/fairplay/phase-plan.md, prerequisite P6).

This is the one place in the package that encodes video, and it runs only where a test
asks for it: on a developer machine, never on the Edge's recording path and never on AWS.
"""

from __future__ import annotations

import math
import shutil
import subprocess
import time
from dataclasses import dataclass

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
PATTERNS = ("testsrc2", "smptehdbars", "mandelbrot", "rgbtestsrc")


@dataclass(frozen=True)
class Feed:
    source: str
    url: str
    label: str
    pattern: str = "testsrc2"
    size: str = "1280x720"
    rate: int = 25
    clock_offset_ms: int = 0
    audio: bool = True
    duration_s: float | None = None
    marker_every_s: int = 60
    bitrate: str = "2500k"


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def build_command(feed: Feed, base_epoch: float) -> list[str]:
    if feed.pattern not in PATTERNS:
        raise ValueError(f"pattern must be one of {', '.join(PATTERNS)}")
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    burned = base_epoch + feed.clock_offset_ms / 1000
    whole = math.floor(burned)
    frac = burned - whole
    gop = feed.rate * 2
    clock = (
        f"%{{pts\\:gmtime\\:{whole}\\:%Y-%m-%d %H\\\\\\:%M\\\\\\:%S}}"
        f".%{{eif\\:mod((t+{frac:.3f})*1000\\,1000)\\:d\\:3}}Z"
    )
    overlay = ",".join([
        f"drawtext=fontfile={FONT}:text='{_escape(feed.label)}':x=24:y=24:fontsize=44:"
        "fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=10",
        f"drawtext=fontfile={FONT}:text='{clock}':x=24:y=96:fontsize=40:"
        "fontcolor=yellow:box=1:boxcolor=black@0.65:boxborderw=10",
        f"drawtext=fontfile={FONT}:text='frame %{{n}}  offset {feed.clock_offset_ms} ms':x=24:y=160:fontsize=32:"
        "fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=8",
        # A one-second marker at every whole multiple of marker_every_s on the burned clock:
        # a visible event at a known instant, for calibration tests.
        f"drawbox=x=0:y=0:w=iw:h=ih:color=red@0.35:t=fill:"
        f"enable='lt(mod({whole % feed.marker_every_s}+t+{frac:.3f}\\,{feed.marker_every_s})\\,1)'",
    ])
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "warning", "-nostats", "-re",
           "-f", "lavfi", "-i", f"{feed.pattern}=size={feed.size}:rate={feed.rate}"]
    if feed.audio:
        cmd += ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"]
    if feed.duration_s:
        cmd += ["-t", f"{feed.duration_s:.3f}"]
    cmd += ["-vf", overlay,
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-pix_fmt", "yuv420p",
            "-g", str(gop), "-keyint_min", str(gop), "-sc_threshold", "0",
            "-b:v", feed.bitrate, "-maxrate", feed.bitrate, "-bufsize", feed.bitrate]
    if feed.audio:
        cmd += ["-c:a", "aac", "-b:a", "96k"]
    cmd += ["-f", "rtsp", "-rtsp_transport", "tcp", feed.url]
    return cmd


def run(feed: Feed) -> int:
    # Start on a whole second, so the burned clock and the wall clock begin together.
    time.sleep(1 - (time.time() % 1))
    cmd = build_command(feed, time.time())
    return subprocess.call(cmd)
