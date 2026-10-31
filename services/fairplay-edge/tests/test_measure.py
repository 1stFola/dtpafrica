"""Phase 6.4: the measurements report what happened, and take nothing from a match."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from fairplay_edge import __main__ as cli
from fairplay_edge import measure, timing
from fairplay_edge.naming import iso

from .conftest import at

EDGE = Path(__file__).resolve().parents[1]


def segment(store, source, start_s, seconds, *, state="finalized", mbit=8.0):
    with store.tx() as db:
        db.execute("INSERT INTO segments (id, source, rel_path, start_utc, end_utc, duration_ms, bytes, state, codec, profile,"
                   " width, height, fps, has_audio, discovered_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'h264', 'High', 1920, 1080,"
                   " '25/1', 0, ?)",
                   (f"{source}-{start_s}", source, f"{source}/{start_s}.mp4", iso(at(start_s)), iso(at(start_s + seconds)),
                    seconds * 1000, int(mbit * 1e6 / 8 * seconds), state, iso(at(start_s))))


def test_it_reports_each_cameras_rate_and_its_recorded_share(settings, store):
    for start in (0, 300, 600):
        segment(store, "ground", start, 300)
    segment(store, "drone", 0, 300, mbit=4.0)
    segment(store, "drone", 330, 270, state="partial", mbit=4.0)  # 30 s missing out of 600
    out = measure.report(settings, store)
    ground, drone = {s["source"]: s for s in out["sources"]}["ground"], {s["source"]: s for s in out["sources"]}["drone"]
    assert ground["mbitPerSecond"] == 8.0 and ground["gbPerHour"] == 3.6 and ground["recordedPercent"] == 100.0
    assert (ground["codec"], ground["width"], ground["height"], ground["fps"]) == ("h264", 1920, 1080, "25/1")
    assert drone["recordedPercent"] == 95.0 and drone["gapCount"] == 1 and drone["longestGapMs"] == 30000
    assert drone["partial"] == 1 and drone["gaps"][0]["fromUtc"] == iso(at(300))
    assert out["allSourcesMbit"] == 12.0 and out["allSourcesGbPerHour"] == 5.4


def test_overlapping_segments_are_not_counted_twice(settings, store):
    segment(store, "ground", 0, 100)
    segment(store, "ground", 90, 110)
    out = measure.report(settings, store)["sources"][0]
    assert out["recordedPercent"] == 100.0 and out["gapCount"] == 0


def test_with_nothing_recorded_it_says_so(settings, store):
    out = measure.report(settings, store)
    assert out["sources"] == [] and out["allSourcesMbit"] == 0 and out["clips"]["made"] == 0 and out["clips"]["p95Ms"] is None


def test_since_limits_the_report_to_the_stretch_asked_for(settings, store):
    segment(store, "ground", 0, 60)  # at() is long ago, so outside any recent window
    assert measure.report(settings, store, since_minutes=5)["sources"] == []


def test_the_disk_test_writes_measures_and_cleans_up(settings, store):
    out = measure.disk(settings, store, seconds=1)
    assert out["writtenGb"] > 0 and out["meanMBps"] > 0 and out["stoppedBy"] == "time"
    assert not list(settings.recordings_dir.glob(".measure-disk-*"))


def test_the_disk_test_refuses_while_a_session_is_open(settings, store):
    session = timing.create_session(store, "A match", None, "shadow", "u")
    with pytest.raises(measure.DiskTestRefused, match="a session is open"):
        measure.disk(settings, store, seconds=1)
    assert not list(settings.recordings_dir.glob(".measure-disk-*"))
    assert measure.disk(settings, store, seconds=1, force=True)["writtenGb"] > 0  # a bench's own choice
    timing.end_session(store, session["id"], "u")
    assert measure.disk(settings, store, seconds=1)["writtenGb"] > 0


def test_the_disk_test_stops_before_it_nears_the_hard_limit(settings, store, monkeypatch):
    real = shutil.disk_usage
    low = real(settings.recordings_dir)._replace(free=settings.disk_hard_free_bytes + 1)
    monkeypatch.setattr(measure.shutil, "disk_usage", lambda _: low)
    out = measure.disk(settings, store, seconds=30)
    assert out["stoppedBy"] == "free space" and out["writtenGb"] == 0 and out["seconds"] < 5
    monkeypatch.setattr(measure.shutil, "disk_usage", real)


def test_the_commands_print_json_and_a_refusal_is_exit_2(settings, store, monkeypatch, capsys):
    monkeypatch.setattr(cli, "_settings", lambda need_api_token=True: settings)
    assert cli.main(["measure"]) == 0
    assert "allSourcesMbit" in json.loads(capsys.readouterr().out)
    timing.create_session(store, "A match", None, "shadow", "u")
    assert cli.main(["measure-disk", "--seconds", "1"]) == 2
    assert "a session is open" in capsys.readouterr().err


def script(tmp_path: Path, *args: str) -> subprocess.CompletedProcess:
    d = tmp_path / "fairplay-edge"
    if not d.exists():
        d.mkdir()
        shutil.copytree(EDGE / "deploy", d / "deploy")
    return subprocess.run(["bash", "deploy/measure.sh", *args], cwd=d, capture_output=True, text=True)


@pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")
def test_the_script_refuses_before_it_touches_anything(tmp_path):
    assert script(tmp_path).returncode == 2
    assert "no such folder" in script(tmp_path, "no-such-folder").stderr
    assert "not a whole number" in script(tmp_path, ".", "--disk-seconds", "x; rm").stderr
    assert "install first" in script(tmp_path, ".").stderr


def test_the_script_never_reads_the_secrets():
    text = (EDGE / "deploy" / "measure.sh").read_text(encoding="utf-8")
    body = "\n".join(line for line in text.splitlines() if not line.startswith("#"))
    assert "publish.env" not in body and "auth/" not in body
    # .env only for its existence and the release tag.
    assert [line.strip() for line in body.splitlines() if ".env" in line] == [
        "printf 'Measured %s, release %s\\n' \"$STAMP\" \"$(sed -n 's/^FAIRPLAY_EDGE_TAG=//p' .env | tr -d '\\r' | tail -n 1)\"",
        '[ -f .env ] || die "no .env here: install first (deploy/install.sh)" 2'][::-1]
