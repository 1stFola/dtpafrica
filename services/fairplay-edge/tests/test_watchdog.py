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


def test_new_empty_files_are_not_recording(settings, store, mtx, fake_probe):
    """F21: on a full disk MediaMTX opens a new file every few seconds and writes nothing to
    it. A new file is not media; only media written counts as recording."""
    s = replace(settings, record_stall_seconds=0)
    dog = Watchdog(s, store, mtx)
    mtx.ready = {"ground": True, "drone": False}
    write_segment(s.recordings_dir, "ground", at(0), fmp4(2))
    Scanner(s, store).scan({"ground": True})
    with store.tx() as db:  # it last grew, and began publishing, a while ago
        db.execute("UPDATE source_state SET since_utc = '2026-10-27T13:00:00.000Z'")
        db.execute("UPDATE segments SET last_growth_utc = '2026-10-27T13:00:00.000Z'")
    write_segment(s.recordings_dir, "ground", at(3), b"")
    write_segment(s.recordings_dir, "ground", at(6), fmp4(0))  # its init, and nothing after
    Scanner(s, store).scan({"ground": True})
    rows = store.query("SELECT last_growth_utc FROM segments WHERE start_utc > '2026-10-27T14:00:00.000Z'")
    assert [r["last_growth_utc"] for r in rows] == [None, None]
    dog.poll()
    assert dog.recording_state("ground", True)["recording"] is False
    assert _open(store, "recording_stalled", "ground")["severity"] == "critical"


def test_a_segment_switch_stays_recording(settings, store, mtx, fake_probe):
    """The new file of a normal segment switch is empty for a moment; the last one just grew."""
    dog = Watchdog(settings, store, mtx)
    mtx.ready = {"ground": True, "drone": False}
    write_segment(settings.recordings_dir, "ground", at(0), fmp4(3))
    scanner = Scanner(settings, store)
    scanner.scan({"ground": True})
    new = write_segment(settings.recordings_dir, "ground", at(300), b"")
    scanner.scan({"ground": True})
    view = dog.recording_state("ground", True)
    assert view["recording"] is True and view["currentSegmentBytes"] == 0
    new.write_bytes(fmp4(1))
    scanner.scan({"ground": True})
    current = store.one("SELECT last_growth_utc FROM segments WHERE start_utc = '2026-10-27T14:05:00.000Z'")
    assert current["last_growth_utc"] is not None


def test_a_full_disk_is_not_recording(settings, store, mtx, fake_probe):
    """F21: below the space one part needs, every source is not recording, whatever its files do."""
    dog = Watchdog(replace(settings, disk_full_free_bytes=10**18), store, mtx)
    mtx.ready = {"ground": True, "drone": False}
    write_segment(settings.recordings_dir, "ground", at(0), fmp4(1))
    Scanner(settings, store).scan({"ground": True})
    dog.poll()
    assert _open(store, "disk_full")["severity"] == "critical"
    view = dog.recording_state("ground", True)
    assert view["recording"] is False and view["diskFull"] is True
    dog = Watchdog(replace(settings, disk_full_free_bytes=0), store, mtx)
    dog.poll()
    assert _open(store, "disk_full") is None
    assert dog.recording_state("ground", True)["recording"] is True


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


def test_disk_outlook_turns_the_fill_rate_into_minutes(settings, store, mtx):
    gb = 1024**3
    dog = Watchdog(replace(settings, disk_hard_free_bytes=5 * gb), store, mtx)
    assert dog.disk_outlook(20 * gb, now=0)["minutesToHardLimit"] is None  # no samples yet
    dog._disk_samples.extend([(0.0, 21 * gb), (30.0, 20 * gb + gb // 2)])
    assert dog.disk_outlook(20 * gb, now=30)["minutesToHardLimit"] is None  # under a minute of samples
    dog._disk_samples.append((120.0, 20 * gb))  # 1 GB in two minutes
    outlook = dog.disk_outlook(20 * gb, now=120)
    assert outlook["minutesToHardLimit"] == 30 and outlook["minutesToFull"] == 40
    dog._disk_samples.append((180.0, 21 * gb))  # space freed: not filling
    assert dog.disk_outlook(21 * gb, now=180)["minutesToHardLimit"] is None
    assert dog.disk_outlook(21 * gb, now=180 + 2000)["fillBytesPerSecond"] is None  # samples older than ten minutes


def test_a_camera_publishing_from_a_new_address_is_raised_until_an_admin_confirms(settings, store, mtx):
    from fairplay_edge.watchdog import known_publishers
    dog = Watchdog(settings, store, mtx)
    mtx.ready = {"ground": True}
    mtx.publisher["ground"] = ("s1", "10.0.0.21")
    dog.poll()
    assert known_publishers(store, "ground") == {"10.0.0.21"}  # the first address is the baseline
    assert _open(store, "publisher_address_changed", "ground") is None
    mtx.publisher["ground"] = ("s2", "10.0.0.21")  # reconnects from the same camera
    dog.poll()
    assert _open(store, "publisher_address_changed", "ground") is None
    mtx.publisher["ground"] = ("s3", "10.0.0.99")  # someone else publishing as the ground camera
    dog.poll()
    dog.poll()
    alert = _open(store, "publisher_address_changed", "ground")
    assert alert["severity"] == "warning" and "10.0.0.99" in alert["detail"]
    assert known_publishers(store, "ground") == {"10.0.0.21"}  # not known until an admin says so
    assert store.one("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'publisher_address_changed'")["n"] == 1
