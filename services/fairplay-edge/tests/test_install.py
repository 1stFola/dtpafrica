"""Phase 6.1: deploy/install.sh writes a complete configuration from the committed examples,
generating every secret without printing it, and keeps what exists when it runs again."""

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

from fairplay_edge.config import load_settings

EDGE = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")


def copy_of_the_release(tmp_path: Path) -> Path:
    d = tmp_path / "fairplay-edge"
    d.mkdir()
    for name in (".env.example", "publish.env.example", "pyproject.toml"):
        shutil.copy(EDGE / name, d / name)
    for folder in ("config", "deploy"):
        shutil.copytree(EDGE / folder, d / folder, ignore=shutil.ignore_patterns("rendered", "sources.toml"))
    return d


def install(d: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", "deploy/install.sh", "--render-only", *args], cwd=d, capture_output=True, text=True,
                          check=check)


def env_file(path: Path) -> dict[str, str]:
    out = {}
    for line in path.read_text("utf-8").splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            out[key] = value
    return out


def test_it_writes_every_secret_and_a_configuration_the_edge_accepts(tmp_path):
    d = copy_of_the_release(tmp_path)
    run = install(d, "--label", "Edge laptop 1", "--cameras", "192.168.20.0/24", "--ingest-ip", "192.168.20.2")
    env, pub = env_file(d / ".env"), env_file(d / "publish.env")
    secrets_ = [env["FAIRPLAY_MEDIAMTX_PASSWORD"], env["FAIRPLAY_EDGE_API_TOKEN"],
                pub["FAIRPLAY_PUBLISH_PASSWORD_GROUND"], pub["FAIRPLAY_PUBLISH_PASSWORD_DRONE"]]
    assert all(len(s) >= 40 for s in secrets_) and len(set(secrets_)) == 4
    assert not any(s in run.stdout + run.stderr for s in secrets_), "a secret was printed"
    version = next(line.split('"')[1] for line in (d / "pyproject.toml").read_text().splitlines() if line.startswith("version"))
    assert env["FAIRPLAY_EDGE_TAG"].startswith(f"{version}-")
    assert (env["FAIRPLAY_DEVICE_LABEL"], env["FAIRPLAY_PUBLISH_ALLOWED_CIDRS"], env["FAIRPLAY_INGEST_BIND"]) == (
        "Edge laptop 1", "192.168.20.0/24", "192.168.20.2")
    assert (d / "config" / "sources.toml").read_text() == (d / "config" / "sources.example.toml").read_text().replace("\r", "")
    assert "\r" not in (d / ".env").read_text() + (d / "publish.env").read_text()
    if os.name == "posix":
        for name in (".env", "publish.env"):
            assert stat.S_IMODE((d / name).stat().st_mode) == 0o600, name
    settings = load_settings({**env, **pub, "FAIRPLAY_SOURCES_FILE": str(d / "config" / "sources.toml"),
                              "FAIRPLAY_DATA_DIR": str(tmp_path / "data"), "FAIRPLAY_RECORDINGS_DIR": str(tmp_path / "rec")})
    assert settings.device_label == "Edge laptop 1" and [s.name for s in settings.sources] == ["ground", "drone"]
    for unit in ("fairplay-edge.service", "fairplay-edge-watchdog.service", "fairplay-edge-watchdog.timer"):
        text = (d / "deploy" / "rendered" / unit).read_text()
        assert "@DIR@" not in text, unit
    service = (d / "deploy" / "rendered" / "fairplay-edge.service").read_text()
    assert "WorkingDirectory=/" in service and "ExecStart=/usr/bin/docker compose up -d" in service


def test_running_it_again_keeps_every_secret(tmp_path):
    d = copy_of_the_release(tmp_path)
    install(d, "--cameras", "192.168.20.0/24")
    first = ((d / ".env").read_text(), (d / "publish.env").read_text())
    run = install(d, "--cameras", "192.168.20.0/24")
    assert ((d / ".env").read_text(), (d / "publish.env").read_text()) == first
    assert ".env exists: kept" in run.stdout


def test_a_placeholder_left_in_a_hand_written_env_is_refused(tmp_path):
    d = copy_of_the_release(tmp_path)
    shutil.copy(d / ".env.example", d / ".env")
    run = install(d, check=False)
    assert run.returncode != 0 and "CHANGE_ME" in run.stderr


def test_a_new_source_gets_its_own_publish_password(tmp_path):
    d = copy_of_the_release(tmp_path)
    install(d, "--cameras", "192.168.20.0/24")
    with (d / "config" / "sources.toml").open("a") as fh:
        fh.write('\n[[source]]\nname = "tactical-cam"\nrole = "programme"\nrequired = false\nprotocol = "rtsp"\n')
    before = env_file(d / "publish.env")
    install(d, "--cameras", "192.168.20.0/24")
    after = env_file(d / "publish.env")
    assert len(after["FAIRPLAY_PUBLISH_PASSWORD_TACTICAL_CAM"]) >= 40
    assert {k: after[k] for k in before} == before
