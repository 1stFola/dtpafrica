"""Game state: every track's foot point on the pitch, in metres, frame by frame.

The first thing in the engine that is a coordinate rather than a pixel, and so
the first thing the suppression rule governs end to end (docs/vision/09
§ Calibration and game state). A position is placed only through the calibration
of the camera segment covering its moment, and only when that calibration passed
the bar; under no segment, no calibration, a failed one, or beyond the horizon it
is written as *suppressed* with the reason, never as a number with a caveat. Each
position also reads on the match clock when the clock is anchored.

Output is Parquet in object storage, chunked by source time, with a small JSON
index naming the chunks and the coverage -- the Phase 5 gate's valid-frame
coverage is the share of frames a passing calibration covered. Rows are flat so
any reader, in any language, can filter them without this module.
"""

from __future__ import annotations

import json
import math
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

Homography = Sequence[float]

#: Source milliseconds per chunk. A minute at 25fps and 22 tracks is ~33k rows,
#: a few hundred kilobytes of Parquet: small enough to fetch for a minimap window,
#: large enough that a match is ninety files and not nine thousand.
DEFAULT_CHUNK_MS = 60_000

PASSING_QUALITIES = frozenset({"good", "usable"})

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


@dataclass(frozen=True)
class Anchor:
    half: int
    source_ms: int
    end_ms: int | None


BASE_MINUTE = {1: 0, 2: 45, 3: 90, 4: 105}


def project(h: Homography, x: float, y: float) -> tuple[float, float] | None:
    """A proxy pixel through a pixel-to-pitch homography, or None at or beyond the horizon."""
    w = h[6] * x + h[7] * y + h[8]
    if not math.isfinite(w) or w <= 1e-9:
        return None
    return ((h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w)


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


def segment_at(segments: Sequence[Segment], source_ms: int) -> Segment | None:
    for s in segments:
        if s.start_ms <= source_ms <= s.end_ms:
            return s
    return None


def place(
    tracks: Sequence[dict[str, Any]],
    segments: Sequence[Segment],
    anchors: Sequence[Anchor],
) -> list[dict[str, Any]]:
    """One flat row per (frame, track) from a track artifact's positions.

    The foot point is the bottom centre of the box. A row is placed -- `x_m`,
    `y_m` set -- only through a passing calibration covering its moment; otherwise
    `x_m`/`y_m` are None and `reason` says why. Rows are in frame order, then track.
    """
    rows: list[dict[str, Any]] = []
    for t in tracks:
        local_id = int(t["localTrackId"])
        cls = str(t.get("class", "player"))
        for p in t.get("positions") or []:
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
            seg = segment_at(segments, source_ms)
            if seg is None:
                row["reason"] = "no_camera_segment"
            elif not seg.passing:
                row["camera_segment_id"] = seg.camera_segment_id
                row["quality"] = seg.quality
                row["reason"] = "calibration_failed" if seg.quality == "failed" else "segment_not_calibrated"
            else:
                assert seg.homography is not None
                point = project(seg.homography, float(box["x"]) + float(box["width"]) / 2, float(box["y"]) + float(box["height"]))
                row["camera_segment_id"] = seg.camera_segment_id
                row["quality"] = seg.quality
                if point is None:
                    row["reason"] = "beyond_horizon"
                else:
                    row["x_m"] = round(point[0], 3)
                    row["y_m"] = round(point[1], 3)
            rows.append(row)
    rows.sort(key=lambda r: (r["source_ms"], r["frame_index"], r["local_track_id"]))
    return rows


def chunk_rows(rows: Sequence[dict[str, Any]], chunk_ms: int = DEFAULT_CHUNK_MS) -> list[tuple[int, list[dict[str, Any]]]]:
    """Rows grouped by `source_ms // chunk_ms`, in order. Empty input gives no chunks."""
    if chunk_ms <= 0:
        raise ValueError("chunk_ms must be positive")
    groups: dict[int, list[dict[str, Any]]] = {}
    for r in rows:
        groups.setdefault(int(r["source_ms"]) // chunk_ms, []).append(r)
    return sorted(groups.items())


def coverage(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Frames, placed and suppressed rows, reasons, and valid-frame coverage: the
    share of distinct frames on which at least one row was placed through a passing
    calibration -- which, a calibration being per moment, is the share of frames a
    passing calibration covered."""
    frames: set[int] = set()
    valid_frames: set[int] = set()
    placed = 0
    reasons: dict[str, int] = {}
    for r in rows:
        frames.add(int(r["frame_index"]))
        if r["x_m"] is not None:
            placed += 1
            valid_frames.add(int(r["frame_index"]))
        else:
            reasons[r["reason"]] = reasons.get(r["reason"], 0) + 1
    return {
        "rows": len(rows),
        "frames": len(frames),
        "placed": placed,
        "suppressed": len(rows) - placed,
        "reasons": reasons,
        "validFrameCoverage": round(len(valid_frames) / len(frames), 4) if frames else None,
    }


def write_chunk(rows: Sequence[dict[str, Any]], path: Path) -> int:
    """Write rows as Parquet with the fixed schema; returns bytes written."""
    import pyarrow as pa  # noqa: PLC0415 - the CPU image carries it; tests that never write need not
    import pyarrow.parquet as pq  # noqa: PLC0415

    types = {"int32": pa.int32(), "int64": pa.int64(), "int8": pa.int8(), "float64": pa.float64(), "string": pa.string()}
    schema = pa.schema([(name, types[kind]) for name, kind in CHUNK_SCHEMA])
    table = pa.table({name: [r[name] for r in rows] for name, _ in CHUNK_SCHEMA}, schema=schema)
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, path, compression="zstd")
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


def build(
    tracks: Sequence[dict[str, Any]],
    segments: Sequence[Segment],
    anchors: Sequence[Anchor],
    out_dir: Path,
    chunk_ms: int = DEFAULT_CHUNK_MS,
) -> dict[str, Any]:
    """Place, chunk, write, and index. Returns the index, with chunk file names relative to `out_dir`."""
    rows = place(tracks, segments, anchors)
    chunks = []
    for index, group in chunk_rows(rows, chunk_ms):
        name = f"chunk-{index:05d}.parquet"
        size = write_chunk(group, out_dir / name)
        chunks.append({"index": index, "file": name, "fromMs": index * chunk_ms, "toMs": (index + 1) * chunk_ms, "bytes": size, **coverage(group)})
    return {"chunkMs": chunk_ms, "chunks": chunks, **coverage(rows), "tracks": len(tracks)}


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
    with open(args.tracks, encoding="utf-8") as handle:
        tracks = (json.load(handle).get("tracks")) or []
    with open(args.segments, encoding="utf-8") as handle:
        segments = parse_segments(json.load(handle))
    anchors: list[Anchor] = []
    if args.anchors:
        with open(args.anchors, encoding="utf-8") as handle:
            anchors = parse_anchors(json.load(handle))
    index = build(tracks, segments, anchors, Path(args.out_dir), args.chunk_ms)
    json.dump(index, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
