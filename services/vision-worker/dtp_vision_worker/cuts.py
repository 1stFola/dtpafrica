"""Camera cuts, proposed from the proxy.

A cut resets calibration rather than carrying a stale homography across it
(docs/vision/09 § Calibration), so the camera segment is calibration's unit, and
a person declaring every segment of a ninety-minute match by hand is not a plan.
FFmpeg's scene-change score -- the fraction of the picture that changed between
two frames -- is a cheap, licence-free proposer: a frame whose score clears a
threshold is a cut, and the stretches between cuts are segments. Proposals, not
facts: a person calibrates a segment or deletes it, and a segment a person
declared is never overwritten by one a filter guessed.

The arithmetic is here, apart from FFmpeg, so it can be tested on a log FFmpeg
once printed and run by the gate on a machine with no FFmpeg at all.
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Sequence
from typing import Any

#: Scene-change score at or above which a frame starts a new segment. FFmpeg's
#: score is the mean absolute difference of the frame from the previous one,
#: 0-1; a real cut is usually above 0.5, a fast pan rarely above 0.3.
DEFAULT_THRESHOLD = 0.4

#: Two cuts closer than this are one cut: a flash, a transition, a two-frame
#: insert. A segment shorter than this cannot be calibrated anyway.
DEFAULT_MIN_SEGMENT_MS = 2000

_PTS = re.compile(r"pts_time:\s*([0-9.]+)")
_SCENE = re.compile(r"lavfi\.scene_score=([0-9.]+)")


def parse_showinfo(log: str) -> list[dict[str, float]]:
    """Cuts from FFmpeg's stderr: the `showinfo` line of each selected frame, and the
    `metadata` line carrying its scene score when one was asked for.

    `select='gt(scene,T)'` keeps only frames above the threshold, so every
    `showinfo` line with a `pts_time` is a cut; that is the moment in the proxy.
    In the chain `select,metadata=print,showinfo` a frame passes `metadata` first,
    so FFmpeg prints a frame's score *before* its `showinfo` line. The score read
    is held for the cut that follows it. It used to be given to the cut before,
    which put every score on the wrong cut and dropped the first
    (docs/vision/50, appendix C).
    """
    cuts: list[dict[str, float]] = []
    pending: float | None = None
    for line in log.splitlines():
        pts = _PTS.search(line)
        if pts and "showinfo" in line:
            cuts.append({"proxyMs": round(float(pts.group(1)) * 1000), "score": pending if pending is not None else 0.0})
            pending = None
            continue
        score = _SCENE.search(line)
        if score:
            pending = round(float(score.group(1)), 4)
    return cuts


def segments_from_cuts(cuts_ms: Sequence[int], duration_ms: int, min_segment_ms: int = DEFAULT_MIN_SEGMENT_MS) -> list[dict[str, int]]:
    """The stretches between cuts, in proxy milliseconds, [start, end).

    Cuts are sorted and de-duplicated; a cut within `min_segment_ms` of the previous
    boundary is absorbed into the segment before it rather than making a sliver, and
    a trailing sliver is absorbed into the last segment. A cut at or past the end is
    ignored. With no cuts the whole proxy is one segment.
    """
    if duration_ms <= 0:
        return []
    boundaries = [0]
    for cut in sorted(set(int(c) for c in cuts_ms)):
        if cut <= 0 or cut >= duration_ms:
            continue
        if cut - boundaries[-1] < min_segment_ms:
            continue
        boundaries.append(cut)
    if duration_ms - boundaries[-1] < min_segment_ms and len(boundaries) > 1:
        boundaries.pop()
    boundaries.append(duration_ms)
    return [{"startMs": boundaries[i], "endMs": boundaries[i + 1]} for i in range(len(boundaries) - 1)]


def propose(log: str, duration_ms: int, source_offset_ms: int, min_segment_ms: int = DEFAULT_MIN_SEGMENT_MS) -> dict[str, Any]:
    """Cuts and segments from a showinfo log, in proxy and source time."""
    cuts = parse_showinfo(log)
    segments = segments_from_cuts([c["proxyMs"] for c in cuts], duration_ms, min_segment_ms)
    return {
        "cuts": [{**c, "sourceMs": int(c["proxyMs"]) + source_offset_ms} for c in cuts],
        "segments": [{"startMs": s["startMs"] + source_offset_ms, "endMs": s["endMs"] + source_offset_ms, "proxyStartMs": s["startMs"], "proxyEndMs": s["endMs"]} for s in segments],
        "durationMs": duration_ms,
        "minSegmentMs": min_segment_ms,
    }


def main(argv: Sequence[str] | None = None) -> int:
    """`python -m dtp_vision_worker.cuts --showinfo log.txt --duration-ms N [--offset-ms N] [--min-segment-ms N]`"""
    import argparse  # noqa: PLC0415

    parser = argparse.ArgumentParser(prog="dtp-vision-cuts")
    parser.add_argument("--showinfo", required=True, help="FFmpeg stderr from select+showinfo")
    parser.add_argument("--duration-ms", type=int, required=True)
    parser.add_argument("--offset-ms", type=int, default=0)
    parser.add_argument("--min-segment-ms", type=int, default=DEFAULT_MIN_SEGMENT_MS)
    args = parser.parse_args(argv)
    with open(args.showinfo, encoding="utf-8", errors="replace") as handle:
        log = handle.read()
    json.dump(propose(log, args.duration_ms, args.offset_ms, args.min_segment_ms), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
