"""Shared fixtures. Unit tests need neither MediaMTX nor ffmpeg: MP4 files are built from
real box structures here, and ffprobe is replaced where a test does not exercise it."""

from __future__ import annotations

import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from fairplay_edge import manifest as manifest_module
from fairplay_edge import repair as repair_module
from fairplay_edge.config import load_settings
from fairplay_edge.probe import Probe
from fairplay_edge.store import Store

SECRET = "s3cret-value-that-is-long-enough-0123456789"
T0 = datetime(2026, 10, 27, 14, 0, 0, tzinfo=timezone.utc)


def box(kind: str, payload: bytes = b"") -> bytes:
    return struct.pack(">I4s", 8 + len(payload), kind.encode()) + payload


def fmp4(fragments: int = 3, *, truncate_last: int = 0, dangling_moof: bool = False, mdat_bytes: int = 64) -> bytes:
    data = box("ftyp", b"iso5\x00\x00\x02\x00iso6mp41") + box("moov", b"\x00" * 32)
    for i in range(fragments):
        data += box("moof", b"\x01" * 16) + box("mdat", bytes([i % 256]) * mdat_bytes)
    if dangling_moof:
        data += box("moof", b"\x01" * 16)
    if truncate_last:
        data = data[:-truncate_last]
    return data


def segment_name(start: datetime) -> str:
    return start.strftime("%Y-%m-%d_%H-%M-%S-%f") + "_+0000.mp4"


def write_segment(recordings: Path, source: str, start: datetime, data: bytes) -> Path:
    folder = recordings / source
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / segment_name(start)
    path.write_bytes(data)
    return path


SOURCES_TOML = """
[[source]]
name = "ground"
role = "ground"
required = true
protocol = "rtsp"

[[source]]
name = "drone"
role = "drone"
required = false
protocol = "rtsp"
"""


@pytest.fixture
def env(tmp_path: Path) -> dict[str, str]:
    sources = tmp_path / "sources.toml"
    sources.write_text(SOURCES_TOML, encoding="utf-8")
    (tmp_path / "recordings").mkdir()
    return {
        "FAIRPLAY_SOURCES_FILE": str(sources),
        "FAIRPLAY_DATA_DIR": str(tmp_path / "data"),
        "FAIRPLAY_RECORDINGS_DIR": str(tmp_path / "recordings"),
        "FAIRPLAY_MEDIAMTX_PASSWORD": SECRET + "-mtx",
        "FAIRPLAY_EDGE_API_TOKEN": SECRET + "-api",
        "FAIRPLAY_PUBLISH_PASSWORD_GROUND": SECRET + "-ground",
        "FAIRPLAY_PUBLISH_PASSWORD_DRONE": SECRET + "-drone",
        "FAIRPLAY_PUBLISH_ALLOWED_CIDRS": "172.31.250.0/24,192.168.1.0/24",
        "FAIRPLAY_EDGE_IP": "172.31.250.10",
        "FAIRPLAY_FINALIZE_QUIET_SECONDS": "0",
    }


@pytest.fixture
def settings(env):
    return load_settings(env)


@pytest.fixture
def store(settings):
    return Store(settings.db_path)


@pytest.fixture
def fake_probe(monkeypatch):
    """ffprobe replaced: every readable file probes as 10 s of 1280x720 H.264."""

    def _probe(path: Path) -> Probe:
        return Probe(codec="h264", profile="High", width=1280, height=720, fps="25/1", time_base="1/90000",
                     start_pts=0, start_time_s=0.0, duration_ms=10_000, has_audio=True, raw={"fake": True})

    monkeypatch.setattr(manifest_module, "probe", _probe)
    monkeypatch.setattr(repair_module, "probe", _probe)
    return _probe


def at(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)
