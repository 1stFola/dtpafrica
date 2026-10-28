"""ffprobe and SHA-256. The only media tools the Edge runs on recordings: it reads, never encodes."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

CHUNK = 4 * 1024 * 1024


class ProbeError(RuntimeError):
    pass


@dataclass(frozen=True)
class Probe:
    codec: str | None
    profile: str | None
    width: int | None
    height: int | None
    fps: str | None
    time_base: str | None
    start_pts: int | None
    start_time_s: float | None
    duration_ms: int | None
    has_audio: bool
    raw: dict


def sha256_file(path: Path, limit: int | None = None) -> str:
    """Hash a file, or its first `limit` bytes."""
    digest = hashlib.sha256()
    remaining = limit
    with path.open("rb") as fh:
        while remaining is None or remaining > 0:
            chunk = fh.read(CHUNK if remaining is None else min(CHUNK, remaining))
            if not chunk:
                break
            digest.update(chunk)
            if remaining is not None:
                remaining -= len(chunk)
    return digest.hexdigest()


def ffprobe_path() -> str:
    found = shutil.which("ffprobe")
    if not found:
        raise ProbeError("ffprobe is not on PATH")
    return found


def run_ffprobe(path: Path, timeout: float = 60) -> dict:
    cmd = [
        ffprobe_path(), "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ProbeError(f"ffprobe timed out after {timeout}s") from exc
    if out.returncode != 0:
        raise ProbeError(out.stderr.decode(errors="replace").strip() or f"ffprobe exited {out.returncode}")
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError as exc:
        raise ProbeError("ffprobe printed something that is not JSON") from exc


def summarise(raw: dict) -> Probe:
    streams = raw.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    fmt = raw.get("format", {})

    def as_float(value) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    duration_s = as_float(fmt.get("duration")) or (as_float(video.get("duration")) if video else None)
    fps = None
    if video and video.get("avg_frame_rate") not in (None, "0/0"):
        fps = video["avg_frame_rate"]
    elif video and video.get("r_frame_rate") not in (None, "0/0"):
        fps = video["r_frame_rate"]
    if fps:
        try:
            frac = Fraction(fps)
            fps = f"{frac.numerator}/{frac.denominator}"
        except (ValueError, ZeroDivisionError):
            pass
    return Probe(
        codec=video.get("codec_name") if video else None,
        profile=video.get("profile") if video else None,
        width=video.get("width") if video else None,
        height=video.get("height") if video else None,
        fps=fps,
        time_base=video.get("time_base") if video else None,
        start_pts=video.get("start_pts") if video else None,
        start_time_s=as_float(video.get("start_time")) if video else None,
        duration_ms=round(duration_s * 1000) if duration_s is not None else None,
        has_audio=any(s.get("codec_type") == "audio" for s in streams),
        raw=raw,
    )


def probe(path: Path) -> Probe:
    return summarise(run_ffprobe(path))


def video_packets(path: Path, read_interval: str | None = None, timeout: float = 120) -> list[tuple[float, bool]]:
    """(pts seconds, is keyframe) for every video packet, in presentation order. Reads the
    container's index only: no decoding. `read_interval` (ffprobe syntax, e.g. "%+5")
    limits it to the start of the file."""
    cmd = [ffprobe_path(), "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags",
           "-of", "csv=p=0"]
    if read_interval:
        cmd += ["-read_intervals", read_interval]
    try:
        out = subprocess.run([*cmd, str(path)], capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ProbeError(f"ffprobe timed out after {timeout}s") from exc
    if out.returncode != 0:
        raise ProbeError(out.stderr.decode(errors="replace").strip() or f"ffprobe exited {out.returncode}")
    packets = []
    for line in out.stdout.decode(errors="replace").splitlines():
        pts, _, flags = line.partition(",")
        try:
            packets.append((float(pts), "K" in flags))
        except ValueError:
            continue  # a packet without a timestamp
    return sorted(packets)


def video_span_s(raw: dict) -> tuple[float, float] | None:
    """(first video timestamp, video duration) in seconds, from a stored ffprobe result."""
    video = next((s for s in raw.get("streams", []) if s.get("codec_type") == "video"), None)
    try:
        return float(video.get("start_time") or 0.0), float(video["duration"])
    except (AttributeError, KeyError, TypeError, ValueError):
        return None
