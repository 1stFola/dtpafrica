"""Game state: every track's foot point on the pitch, in metres, frame by frame.

The first thing in the engine that is a coordinate rather than a pixel, and so
the first thing the suppression rule governs end to end (docs/vision/09
§ Calibration and game state). A position is placed only through the calibration
of the camera segment covering its moment, and only when that calibration passed
the bar; under no segment, no calibration, a failed one, beyond the horizon or
off the pitch it is written as *suppressed* with the reason, never as a number
with a caveat. Each position also reads on the match clock when the clock is
anchored.

Output is Parquet in object storage, chunked by source time, with a small JSON
index naming the chunks and the coverage -- the Phase 5 gate's valid-frame
coverage is the share of the frames the tracker was given on which a position
was placed. Rows are flat so any reader, in any language, can filter them
without this module.
"""

from __future__ import annotations

import bisect
import json
import math
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .jsonstream import fields, items

Homography = Sequence[float]

#: Source milliseconds per chunk. A minute at 25fps and 22 tracks is ~33k rows,
#: a few hundred kilobytes of Parquet: small enough to fetch for a minimap window,
#: large enough that a match is ninety files and not nine thousand.
DEFAULT_CHUNK_MS = 60_000

PASSING_QUALITIES = frozenset({"good", "usable"})

#: How far outside the lines a placed point may be and still be a position. Players
#: take throw-ins and corners from off the pitch and run past the goal line; five
#: metres covers that. Beyond it the "position" is a pixel near the horizon read
#: through a homography that stretches a few pixels into a hundred metres.
OFF_PITCH_MARGIN_M = 5.0

CHUNK_SCHEMA = [
    ("frame_index", "int32"),
    ("source_ms", "int64"),
    ("half", "int8"),
    ("match_minute", "float64"),
    ("local_track_id", "int32"),
    ("class", "string"),
    ("x_m", "float64"),
    ("y_m", "float64"),
    ("camera_segment_id", "string"),
    ("quality", "string"),
    ("reason", "string"),
]


@dataclass(frozen=True)
class Segment:
    """A camera segment with its current calibration, or none (`quality` None)."""

    camera_segment_id: str
    start_ms: int
    end_ms: int
    quality: str | None
    homography: tuple[float, ...] | None
    pitch_length_m: float | None
    pitch_width_m: float | None

    @property
    def passing(self) -> bool:
        return self.quality in PASSING_QUALITIES and self.homography is not None and len(self.homography) == 9

    @property
    def carried(self) -> bool:
        """Calibrated by keyframes: each frame's homography is read from the pinned calibrate run."""
        return self.quality == "carried"


@dataclass(frozen=True)
class Anchor:
    half: int
    source_ms: int
    end_ms: int | None


BASE_MINUTE = {1: 0, 2: 45, 3: 90, 4: 105}


def project(h: Homography, x: float, y: float) -> tuple[float, float] | None:
    """A proxy pixel through a pixel-to-pitch homography, or None at or beyond the horizon.

    The sign of `w` says which side of the horizon a pixel is on, so the matrix has
    to arrive oriented: positive `w` for what the camera sees. A homography is only
    defined up to scale, and one multiplied by -1 maps every pixel to the same
    point with every `w` negated -- this function would then suppress the whole
    pitch. The control plane orients each matrix by its clicked points before it
    declares it (`orientHomography`, docs/vision/56); nothing here can, because
    the worker is not given a point known to be in view.
    """
    w = h[6] * x + h[7] * y + h[8]
    if not math.isfinite(w) or w <= 1e-9:
        return None
    return ((h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w)


def on_pitch(segment: Segment, x_m: float, y_m: float, margin_m: float = OFF_PITCH_MARGIN_M) -> bool:
    """Whether a placed point is on the pitch or within the margin around it.

    The pitch runs 0..length by 0..width. Just under the horizon a pixel maps to
    hundreds of metres, and a number like that is not a position. With no pitch
    dimensions declared there is nothing to judge by, and the point stands.
    """
    if segment.pitch_length_m is None or segment.pitch_width_m is None:
        return True
    return -margin_m <= x_m <= segment.pitch_length_m + margin_m and -margin_m <= y_m <= segment.pitch_width_m + margin_m


def clock_at(anchors: Sequence[Anchor], source_ms: int) -> tuple[int, float] | None:
    """(half, match minute as a float) for a source millisecond, or None when off the clock."""
    ordered = sorted(anchors, key=lambda a: a.half)
    current: Anchor | None = None
    for a in ordered:
        if a.source_ms <= source_ms:
            current = a
    if current is None:
        return None
    if current.end_ms is not None and source_ms > current.end_ms:
        return None
    return current.half, BASE_MINUTE.get(current.half, 0) + (source_ms - current.source_ms) / 60_000


class SegmentIndex:
    """Camera segments by time, half-open: a segment covers `start <= t < end`.

    Cuts produce adjacent segments -- one ends at the millisecond the next starts
    -- and that millisecond is the first frame of the new camera. Read inclusively
    at both ends it belonged to both, the earlier one won, and the first frame
    after every cut was placed through the previous camera's homography
    (docs/vision/50, appendix C). Where segments overlap, which they should not,
    the one that started latest covers the moment.
    """

    def __init__(self, segments: Sequence[Segment]) -> None:
        self._segments = sorted(segments, key=lambda s: (s.start_ms, s.end_ms))
        self._starts = [s.start_ms for s in self._segments]

    def at(self, source_ms: int) -> Segment | None:
        i = bisect.bisect_right(self._starts, source_ms) - 1
        while i >= 0:
            s = self._segments[i]
            if source_ms < s.end_ms:
                return s
            i -= 1
        return None


def segment_at(segments: Sequence[Segment], source_ms: int) -> Segment | None:
    return SegmentIndex(segments).at(source_ms)


def place_track(track: dict[str, Any], segments: SegmentIndex, anchors: Sequence[Anchor], carried: Any = None) -> list[dict[str, Any]]:
    """One flat row per position of one track, in the track's own order.

    On a segment calibrated by keyframes the position is placed through its own
    frame's carried homography (docs/vision/94); a frame no keyframe reached is
    suppressed as `calibration_not_carried`.
    """
    rows: list[dict[str, Any]] = []
    local_id = int(track["localTrackId"])
    cls = str(track.get("class", "player"))
    for p in track.get("positions") or []:
        frame = int(p["frameIndex"])
        source_ms = int(p["sourceTimeMs"])
        box = p["box"]
        clock = clock_at(anchors, source_ms)
        row: dict[str, Any] = {
            "frame_index": frame,
            "source_ms": source_ms,
            "half": clock[0] if clock else None,
            "match_minute": round(clock[1], 4) if clock else None,
            "local_track_id": local_id,
            "class": cls,
            "x_m": None,
            "y_m": None,
            "camera_segment_id": None,
            "quality": None,
            "reason": None,
        }
        seg = segments.at(source_ms)
        homography = None
        if seg is not None and seg.carried:
            homography = carried.at_ms(source_ms, seg.camera_segment_id) if carried is not None else None
        elif seg is not None and seg.passing:
            homography = seg.homography
        if seg is None:
            row["reason"] = "no_camera_segment"
        elif seg.carried and homography is None:
            row["camera_segment_id"] = seg.camera_segment_id
            row["quality"] = seg.quality
            row["reason"] = "calibration_not_carried"
        elif not seg.carried and not seg.passing:
            row["camera_segment_id"] = seg.camera_segment_id
            row["quality"] = seg.quality
            row["reason"] = "calibration_failed" if seg.quality == "failed" else "segment_not_calibrated"
        else:
            assert homography is not None
            point = project(homography, float(box["x"]) + float(box["width"]) / 2, float(box["y"]) + float(box["height"]))
            row["camera_segment_id"] = seg.camera_segment_id
            row["quality"] = seg.quality
            if point is None:
                row["reason"] = "beyond_horizon"
            elif not on_pitch(seg, point[0], point[1]):
                row["reason"] = "off_pitch"
            else:
                row["x_m"] = round(point[0], 3)
                row["y_m"] = round(point[1], 3)
        rows.append(row)
    return rows


def _row_order(r: dict[str, Any]) -> tuple[int, int, int]:
    return (r["source_ms"], r["frame_index"], r["local_track_id"])


def place(
    tracks: Sequence[dict[str, Any]],
    segments: Sequence[Segment],
    anchors: Sequence[Anchor],
) -> list[dict[str, Any]]:
    """One flat row per (frame, track) from a track artifact's positions.

    The foot point is the bottom centre of the box. A row is placed -- `x_m`,
    `y_m` set -- only through a passing calibration covering its moment, and only
    onto the pitch; otherwise `x_m`/`y_m` are None and `reason` says why. Rows are
    in frame order, then track. For a whole match use `build`, which never holds
    the rows of more than one chunk.
    """
    index = SegmentIndex(segments)
    rows: list[dict[str, Any]] = []
    for t in tracks:
        rows.extend(place_track(t, index, anchors))
    rows.sort(key=_row_order)
    return rows


def chunk_rows(rows: Sequence[dict[str, Any]], chunk_ms: int = DEFAULT_CHUNK_MS) -> list[tuple[int, list[dict[str, Any]]]]:
    """Rows grouped by `source_ms // chunk_ms`, in order. Empty input gives no chunks."""
    if chunk_ms <= 0:
        raise ValueError("chunk_ms must be positive")
    groups: dict[int, list[dict[str, Any]]] = {}
    for r in rows:
        groups.setdefault(int(r["source_ms"]) // chunk_ms, []).append(r)
    return sorted(groups.items())


@dataclass
class Tally:
    """Counts over rows, added up chunk by chunk so a match's rows are never all held."""

    rows: int = 0
    placed: int = 0
    frames: int = 0
    valid_frames: int = 0
    reasons: dict[str, int] = field(default_factory=dict)

    def add(self, other: Tally) -> None:
        self.rows += other.rows
        self.placed += other.placed
        self.frames += other.frames
        self.valid_frames += other.valid_frames
        for reason, count in other.reasons.items():
            self.reasons[reason] = self.reasons.get(reason, 0) + count

    def result(self, frames_tracked: int | None = None) -> dict[str, Any]:
        """The coverage record. `frames_tracked` is how many frames the tracker was
        given over the same stretch; without it the share is over frames that have
        at least one row, and `coverageBasis` says so."""
        denominator = frames_tracked if frames_tracked is not None else self.frames
        return {
            "rows": self.rows,
            "frames": self.frames,
            "framesTracked": frames_tracked,
            "placed": self.placed,
            "suppressed": self.rows - self.placed,
            "reasons": dict(self.reasons),
            "validFrameCoverage": round(min(1.0, self.valid_frames / denominator), 4) if denominator else None,
            "coverageBasis": "frames_tracked" if frames_tracked is not None else "frames_with_tracks",
        }


def tally(rows: Sequence[dict[str, Any]]) -> Tally:
    """Count rows whose frames are all in one stretch (a chunk, or a small whole)."""
    frames: set[int] = set()
    valid: set[int] = set()
    out = Tally()
    for r in rows:
        out.rows += 1
        frames.add(int(r["frame_index"]))
        if r["x_m"] is not None:
            out.placed += 1
            valid.add(int(r["frame_index"]))
        else:
            out.reasons[r["reason"]] = out.reasons.get(r["reason"], 0) + 1
    out.frames = len(frames)
    out.valid_frames = len(valid)
    return out


def coverage(rows: Sequence[dict[str, Any]], frames_tracked: int | None = None) -> dict[str, Any]:
    """Frames, placed and suppressed rows, reasons, and valid-frame coverage.

    Valid-frame coverage is the share of the frames the tracker was given
    (`frames_tracked`) on which at least one row was placed through a passing
    calibration. It used to be the share of frames *that had a track on them*,
    which leaves out every frame where nothing was tracked and so overstates the
    number the Phase 5 gate reads (docs/vision/50, appendix C). That older share
    is still what comes back when `frames_tracked` is not known, labelled
    `frames_with_tracks`.
    """
    return tally(rows).result(frames_tracked)


def write_chunk(rows: Sequence[dict[str, Any]], path: Path) -> int:
    """Write rows as Parquet with the fixed schema; returns bytes written."""
    import pyarrow as pa  # noqa: PLC0415 - the CPU image carries it; tests that never write need not
    import pyarrow.parquet as pq  # noqa: PLC0415

    types = {"int32": pa.int32(), "int64": pa.int64(), "int8": pa.int8(), "float64": pa.float64(), "string": pa.string()}
    schema = pa.schema([(name, types[kind]) for name, kind in CHUNK_SCHEMA])
    table = pa.table({name: [r[name] for r in rows] for name, _ in CHUNK_SCHEMA}, schema=schema)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Snappy, not zstd: the minimap decodes a chunk in the browser with hyparquet, which
    # carries snappy alone; every other codec would mean a second package shipped to the client.
    pq.write_table(table, path, compression="snappy")
    return path.stat().st_size


def read_chunk(path: Path) -> list[dict[str, Any]]:
    """Rows back out of a chunk, for the tests and the gate."""
    import pyarrow.parquet as pq  # noqa: PLC0415

    return pq.read_table(path).to_pylist()


def parse_segments(raw: Sequence[dict[str, Any]]) -> list[Segment]:
    out = []
    for c in raw:
        quality = c.get("quality")
        homography = c.get("homography")
        pitch = c.get("pitch") or {}
        out.append(
            Segment(
                camera_segment_id=str(c["cameraSegmentId"]),
                start_ms=int(c["startMs"]),
                end_ms=int(c["endMs"]),
                quality=str(quality) if quality is not None else None,
                homography=tuple(float(v) for v in homography) if homography else None,
                pitch_length_m=float(pitch["lengthM"]) if "lengthM" in pitch else None,
                pitch_width_m=float(pitch["widthM"]) if "widthM" in pitch else None,
            )
        )
    return out


def parse_anchors(raw: Sequence[dict[str, Any]]) -> list[Anchor]:
    return [Anchor(half=int(a["half"]), source_ms=int(a["sourceMs"]), end_ms=(int(a["endMs"]) if a.get("endMs") is not None else None)) for a in raw]


def parse_tracked_frames(raw: Any) -> list[tuple[int, int]] | None:
    """`[[frameIndex, sourceTimeMs], ...]` from a track artifact, or None when it carries none."""
    if not isinstance(raw, list):
        return None
    return [(int(pair[0]), int(pair[1])) for pair in raw]


_COLUMNS = [name for name, _ in CHUNK_SCHEMA]


def build(
    tracks: Iterable[dict[str, Any]],
    segments: Sequence[Segment],
    anchors: Sequence[Anchor],
    out_dir: Path,
    chunk_ms: int = DEFAULT_CHUNK_MS,
    tracked_frames: Sequence[tuple[int, int]] | None = None,
    carried: Any = None,
) -> dict[str, Any]:
    """Place, chunk, write, and index. Returns the index, with chunk file names relative to `out_dir`.

    `tracks` may be an iterator over a streamed artifact. Each track is placed on
    its own and its rows are spilled to a file per chunk; the chunks are then
    sorted and written one at a time. A ninety-minute match is three million rows,
    and held as dicts that is several gigabytes; this holds one track and one
    chunk (docs/vision/50, appendix C).

    `tracked_frames` is every frame the tracker was given, as `(frameIndex,
    sourceTimeMs)`: the denominator of valid-frame coverage. See `coverage`.
    """
    if chunk_ms <= 0:
        raise ValueError("chunk_ms must be positive")
    index = SegmentIndex(segments)
    out_dir.mkdir(parents=True, exist_ok=True)
    spill = out_dir / ".spill"
    spill.mkdir(exist_ok=True)

    track_count = 0
    touched: set[int] = set()
    for t in tracks:
        track_count += 1
        groups: dict[int, list[list[Any]]] = {}
        for row in place_track(t, index, anchors, carried):
            groups.setdefault(int(row["source_ms"]) // chunk_ms, []).append([row[name] for name in _COLUMNS])
        for chunk_index, batch in groups.items():
            touched.add(chunk_index)
            with (spill / f"{chunk_index}.jsonl").open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(batch))
                handle.write("\n")

    tracked_per_chunk: dict[int, int] | None = None
    if tracked_frames is not None:
        tracked_per_chunk = {}
        for _frame, source_ms in tracked_frames:
            tracked_per_chunk[source_ms // chunk_ms] = tracked_per_chunk.get(source_ms // chunk_ms, 0) + 1

    chunks = []
    total = Tally()
    for chunk_index in sorted(touched):
        path = spill / f"{chunk_index}.jsonl"
        rows: list[dict[str, Any]] = []
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                rows.extend(dict(zip(_COLUMNS, values, strict=True)) for values in json.loads(line))
        path.unlink()
        rows.sort(key=_row_order)
        name = f"chunk-{chunk_index:05d}.parquet"
        size = write_chunk(rows, out_dir / name)
        counted = tally(rows)
        total.add(counted)
        in_chunk = tracked_per_chunk.get(chunk_index, 0) if tracked_per_chunk is not None else None
        chunks.append({"index": chunk_index, "file": name, "fromMs": chunk_index * chunk_ms, "toMs": (chunk_index + 1) * chunk_ms, "bytes": size, **counted.result(in_chunk)})
    spill.rmdir()
    return {"chunkMs": chunk_ms, "chunks": chunks, **total.result(len(tracked_frames) if tracked_frames is not None else None), "tracks": track_count}


def main(argv: Sequence[str] | None = None) -> int:
    """`python -m dtp_vision_worker.gamestate --tracks tracks.json --segments segments.json [--anchors anchors.json] --out-dir DIR [--chunk-ms N]`"""
    import argparse  # noqa: PLC0415

    parser = argparse.ArgumentParser(prog="dtp-vision-gamestate")
    parser.add_argument("--tracks", required=True, help="a track artifact")
    parser.add_argument("--segments", required=True, help="[{cameraSegmentId, startMs, endMs, quality|null, homography|null, pitch|null}]")
    parser.add_argument("--anchors", help="[{half, sourceMs, endMs}]")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--chunk-ms", type=int, default=DEFAULT_CHUNK_MS)
    args = parser.parse_args(argv)
    header = fields(Path(args.tracks), "tracks")
    with open(args.segments, encoding="utf-8") as handle:
        segments = parse_segments(json.load(handle))
    anchors: list[Anchor] = []
    if args.anchors:
        with open(args.anchors, encoding="utf-8") as handle:
            anchors = parse_anchors(json.load(handle))
    index = build(items(Path(args.tracks), "tracks"), segments, anchors, Path(args.out_dir), args.chunk_ms, parse_tracked_frames(header.get("trackedFrames")))
    json.dump(index, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
