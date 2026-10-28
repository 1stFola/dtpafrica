"""Structural check of a fragmented MP4 segment, without decoding it.

MediaMTX writes `ftyp`, `moov`, then one `moof` + `mdat` pair per part. A crash or power
cut leaves the last part half-written. That is detectable from the box headers alone: a
box whose declared size runs past the end of the file, or a `moof` with no `mdat` after it.

`complete_bytes` is where the last whole `moof`+`mdat` pair ends, which is what a repair
keeps. Nothing here edits a file.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Structure:
    file_bytes: int
    complete_bytes: int
    boxes: tuple[str, ...]
    fragments: int
    problems: tuple[str, ...] = field(default=())

    @property
    def is_complete(self) -> bool:
        return not self.problems and self.complete_bytes == self.file_bytes

    @property
    def has_media(self) -> bool:
        return self.fragments > 0


def inspect(path: Path) -> Structure:
    size = path.stat().st_size
    boxes: list[str] = []
    problems: list[str] = []
    fragments = 0
    complete = 0
    pending_moof = False
    seen_moov = False
    offset = 0
    with path.open("rb") as fh:
        while offset < size:
            fh.seek(offset)
            header = fh.read(8)
            if len(header) < 8:
                problems.append(f"truncated box header at byte {offset}")
                break
            box_size, kind_raw = struct.unpack(">I4s", header)
            kind = kind_raw.decode("latin-1")
            header_len = 8
            if box_size == 1:
                large = fh.read(8)
                if len(large) < 8:
                    problems.append(f"truncated 64-bit size of {kind!r} at byte {offset}")
                    break
                box_size = struct.unpack(">Q", large)[0]
                header_len = 16
            elif box_size == 0:
                # "Extends to end of file" is legal only for a finished last box and is not
                # what MediaMTX writes; treat it as unverifiable rather than complete.
                problems.append(f"box {kind!r} at byte {offset} has no declared size")
                break
            if box_size < header_len:
                problems.append(f"box {kind!r} at byte {offset} declares an impossible size {box_size}")
                break
            end = offset + box_size
            if end > size:
                problems.append(f"box {kind!r} at byte {offset} runs {end - size} bytes past the end of the file")
                break
            boxes.append(kind)
            if kind == "moov":
                seen_moov = True
                complete = end
            elif kind == "ftyp" and not seen_moov:
                complete = end
            elif kind == "moof":
                pending_moof = True
            elif kind == "mdat" and pending_moof:
                pending_moof = False
                fragments += 1
                complete = end
            elif not pending_moof and seen_moov:
                # Any other whole box between fragments (free, sidx, ...) keeps the file whole.
                complete = end
            offset = end
    if pending_moof and not problems:
        problems.append("the last fragment has a moof but no mdat")
    if not seen_moov:
        problems.append("no moov box: the initialisation segment is missing")
    return Structure(
        file_bytes=size,
        complete_bytes=complete if seen_moov else 0,
        boxes=tuple(boxes),
        fragments=fragments,
        problems=tuple(problems),
    )
