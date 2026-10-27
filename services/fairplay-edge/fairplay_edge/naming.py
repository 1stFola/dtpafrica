"""Recording file names, which MediaMTX writes as `<path>/<start>.mp4`.

The start time in the name is when MediaMTX began the segment: its receive time, since
`useAbsoluteTimestamp` is off. It is the `ingest_utc` of the first frame in the time model
(docs/fairplay/architecture.md §5), not the camera's clock and not the match clock.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import PurePosixPath

_STAMP = re.compile(
    r"^(?P<y>\d{4})-(?P<mo>\d{2})-(?P<d>\d{2})_(?P<h>\d{2})-(?P<mi>\d{2})-(?P<s>\d{2})-(?P<us>\d{6})"
    r"_(?P<tz>Z|[+-]\d{2}:?\d{2})$"
)


class NotASegment(ValueError):
    pass


def parse_start(stem: str) -> datetime:
    m = _STAMP.match(stem)
    if not m:
        raise NotASegment(f"not a MediaMTX segment name: {stem!r}")
    tz = m["tz"]
    if tz == "Z":
        offset = timezone.utc
    else:
        sign = 1 if tz[0] == "+" else -1
        digits = tz[1:].replace(":", "")
        offset = timezone(sign * timedelta(hours=int(digits[:2]), minutes=int(digits[2:])))
    local = datetime(
        int(m["y"]), int(m["mo"]), int(m["d"]), int(m["h"]), int(m["mi"]), int(m["s"]), int(m["us"]), offset
    )
    return local.astimezone(timezone.utc)


def parse_rel_path(rel: str) -> tuple[str, datetime]:
    """`ground/2026-10-27_14-03-11-123456_+0000.mp4` -> ("ground", start in UTC)."""
    path = PurePosixPath(rel)
    if path.suffix != ".mp4" or len(path.parts) != 2:
        raise NotASegment(f"not a MediaMTX segment path: {rel!r}")
    return path.parts[0], parse_start(path.stem)


def iso(dt: datetime) -> str:
    """RFC 3339 UTC with milliseconds and `Z`, the one format every contract uses."""
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError(f"timestamp without a time zone: {value!r}")
    return dt.astimezone(timezone.utc)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
