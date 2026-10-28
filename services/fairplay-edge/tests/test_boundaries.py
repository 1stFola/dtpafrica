"""Guards on what the Edge must never become: a cloud uploader, a GPU job, a transcoder,
or a server whose control endpoints are reachable from outside. Read from source, so
they fail in CI the moment someone crosses a line."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "fairplay_edge"
SOURCES = {p.name: p.read_text(encoding="utf-8") for p in PACKAGE.glob("*.py")}
COMPOSE = (ROOT / "compose.yaml").read_text(encoding="utf-8")


def test_no_cloud_or_gpu_sdk():
    banned = re.compile(r"^\s*(import|from)\s+(boto3|botocore|aiobotocore|runpod|google\.cloud|azure)\b", re.M)
    assert not [name for name, text in SOURCES.items() if banned.search(text)]


def test_only_the_synthetic_generator_encodes():
    encoders = re.compile(r"libx26[45]|\"-c:v\"|-vcodec|h264_nvenc|hevc_nvenc|_qsv\b")
    assert [name for name, text in SOURCES.items() if encoders.search(text)] == ["synth.py"]


def test_recordings_are_only_probed():
    """ffmpeg (the encoder) is invoked only by synth.py; recordings meet ffprobe alone."""
    calls = re.compile(r"which\(\"ffmpeg\"\)|\[\s*\"ffmpeg\"")
    assert [name for name, text in SOURCES.items() if calls.search(text)] == ["synth.py"]


def test_no_cors_middleware():
    assert not any("CORSMiddleware" in text for text in SOURCES.values())


def test_compose_publishes_no_control_ports_and_no_gpu():
    lines = [line for line in COMPOSE.splitlines() if not line.lstrip().startswith("#")]
    mappings = re.findall(r'^\s*-\s*"([^"]+:\d+:\d+)"', "\n".join(lines), re.M)
    # Exactly two published ports, both loopback unless the operator sets the bind address:
    # the Edge API and RTSP ingest. MediaMTX's API (9997) and playback (9996) never are.
    assert sorted(m.rsplit(":", 2)[1] for m in mappings) == ["8443", "8554"]
    assert all(m.startswith("${") and ":-127.0.0.1}" in m for m in mappings)
    body = "\n".join(lines)
    assert "gpus" not in body and "nvidia" not in body.lower()


def test_mediamtx_image_is_pinned_by_digest():
    assert re.search(r"image: bluenviron/mediamtx:1\.21\.3@sha256:[0-9a-f]{64}", COMPOSE)


def test_no_secret_files_committed():
    for name in (".env", "publish.env", "config/sources.toml"):
        assert not (ROOT / name).exists() or name in (ROOT / ".gitignore").read_text()
