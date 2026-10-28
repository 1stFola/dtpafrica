from dataclasses import replace

import pytest

from fairplay_edge.manifest import Scanner
from fairplay_edge.watchdog import Watchdog

from .conftest import at, fmp4, write_segment
from .fakes import FakeMediaMtx


@pytest.fixture
def mtx():
    return FakeMediaMtx()


def _open(store, kind, source=None):
    return store.one("SELECT * FROM alerts WHERE kind = ? AND source IS ? AND resolved_utc IS NULL", (kind, source))


def test_media_server_down_and_back(settings, store, mtx):
    dog = Watchdog(settings, store, mtx)
    mtx.down = True
    dog.poll()
    assert _open(store, "media_server_down")["severity"] == "critical"
    mtx.down = False
    dog.poll()
    assert _open(store, "media_server_down") is None


def test_required_source_drop_is_critical_optional_is_warning(settings, store, mtx):
    dog = Watchdog(settings, store, mtx)
    mtx.ready = {"ground": False, "drone": False}
    dog.poll()
    assert _open(store, "source_disconnected", "ground")["severity"] == "critical"
    assert _open(store, "source_disconnected", "drone")["severity"] == "warning"


def test_disconnect_then_reconnect_records_a_feed_interval(settings, store, mtx):
    dog = Watchdog(settings, store, mtx)
    mtx.ready = {"ground": True, "drone": True}
    dog.poll()
    mtx.ready["drone"] = False
    dog.poll()
    interval = store.one("SELECT * FROM feed_intervals WHERE source = 'drone'")
    assert interval and interval["down_to_utc"] is None
    assert _open(store, "source_disconnected", "ground") is None  # the other source is untouched
    mtx.ready["drone"] = True
    dog.poll()
    interval = store.one("SELECT * FROM feed_intervals WHERE source = 'drone'")
    assert interval["down_to_utc"] is not None
    assert _open(store, "source_disconnected", "drone") is None
    assert store.one("SELECT COUNT(*) AS n FROM feed_intervals WHERE source = 'ground'")["n"] == 0


def test_connected_is_not_recording(settings, store, mtx, fake_probe):
    """Publishing with no growing segment must not report `recording` (prompt item 3)."""
    s = replace(settings, record_stall_seconds=0)
    dog = Watchdog(s, store, mtx)
    mtx.ready = {"ground": True, "drone": False}
    dog.poll()
    view = dog.recording_state("ground", True)
    assert view["recording"] is False and view["currentSegmentId"] is None


def test_growing_segment_is_recording(settings, store, mtx, fake_probe):
    dog = Watchdog(settings, store, mtx)
    mtx.ready = {"ground": True, "drone": False}
    write_segment(settings.recordings_dir, "ground", at(0), fmp4(1))
    Scanner(settings, store).scan({"ground": True})
    assert dog.recording_state("ground", True)["recording"] is True


def test_publishing_but_stalled_raises_recording_stalled(settings, store, mtx, fake_probe):
    s = replace(settings, record_stall_seconds=0)
    dog = Watchdog(s, store, mtx)
    mtx.ready = {"ground": True, "drone": False}
    write_segment(s.recordings_dir, "ground", at(0), fmp4(1))
    Scanner(s, store).scan({"ground": True})
    with store.tx() as db:  # pretend the source began publishing a while ago
        db.execute("UPDATE source_state SET since_utc = '2026-10-27T13:00:00.000Z'")
        db.execute("UPDATE segments SET last_growth_utc = '2026-10-27T13:00:00.000Z'")
    dog.poll()
    assert _open(store, "recording_stalled", "ground")["severity"] == "critical"


def test_disk_thresholds(settings, store, mtx):
    huge = 10**18
    dog = Watchdog(replace(settings, disk_soft_free_bytes=huge, disk_hard_free_bytes=huge), store, mtx)
    dog.poll()
    assert _open(store, "disk_soft_limit") and _open(store, "disk_hard_limit")
    dog = Watchdog(replace(settings, disk_soft_free_bytes=0, disk_hard_free_bytes=0), store, mtx)
    dog.poll()
    assert _open(store, "disk_soft_limit") is None and _open(store, "disk_hard_limit") is None


def test_alert_is_opened_once_while_open(settings, store, mtx):
    dog = Watchdog(settings, store, mtx)
    mtx.down = True
    dog.poll()
    dog.poll()
    assert store.one("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'media_server_down'")["n"] == 1
