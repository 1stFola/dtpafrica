import json

from fairplay_edge.manifest import Scanner
from fairplay_edge.probe import sha256_file

from .conftest import at, fmp4, write_segment


def _scanner(settings, store):
    return Scanner(settings, store)


def _segments(store, source="ground"):
    return store.query("SELECT * FROM segments WHERE source = ? ORDER BY start_utc", (source,))


def test_open_segment_stays_recording_while_publishing(settings, store, fake_probe):
    write_segment(settings.recordings_dir, "ground", at(0), fmp4(2))
    _scanner(settings, store).scan({"ground": True})
    assert [s["state"] for s in _segments(store)] == ["recording"]


def test_newer_segment_finalises_the_previous_one(settings, store, fake_probe):
    first = write_segment(settings.recordings_dir, "ground", at(0), fmp4(3))
    write_segment(settings.recordings_dir, "ground", at(300), fmp4(1))
    _scanner(settings, store).scan({"ground": True})
    rows = _segments(store)
    assert [r["state"] for r in rows] == ["finalized", "recording"]
    done = rows[0]
    assert done["finalize_reason"] == "newer_segment"
    assert done["sha256"] == sha256_file(first)
    assert done["bytes"] == first.stat().st_size == done["complete_bytes"]
    assert done["start_utc"] == "2026-10-27T14:00:00.000Z" and done["end_utc"] == "2026-10-27T14:00:10.000Z"
    assert done["codec"] == "h264" and done["fps"] == "25/1" and done["start_pts"] == 0


def test_stopped_source_finalises_after_quiet_period(settings, store, fake_probe):
    write_segment(settings.recordings_dir, "drone", at(0), fmp4(2))
    scanner = _scanner(settings, store)
    scanner.scan({"drone": True})
    scanner.scan({"drone": False})  # quiet period is 0 in the test settings
    row = _segments(store, "drone")[0]
    assert row["state"] == "finalized" and row["finalize_reason"] == "source_stopped"


def test_unreachable_mediamtx_counts_as_not_publishing(settings, store, fake_probe):
    write_segment(settings.recordings_dir, "ground", at(0), fmp4(2))
    scanner = _scanner(settings, store)
    scanner.scan({})
    assert _segments(store)[0]["state"] == "finalized"


def test_crash_tail_is_partial_not_finalized(settings, store, fake_probe):
    write_segment(settings.recordings_dir, "ground", at(0), fmp4(3, truncate_last=20))
    write_segment(settings.recordings_dir, "ground", at(300), fmp4(1))
    _scanner(settings, store).scan({"ground": True})
    row = _segments(store)[0]
    assert row["state"] == "partial"
    assert row["complete_bytes"] < row["bytes"]
    alerts = store.query("SELECT kind, severity FROM alerts WHERE resolved_utc IS NULL")
    assert {"kind": "segment_partial", "severity": "warning"} in alerts


def test_file_with_no_fragments_is_corrupt(settings, store, fake_probe):
    write_segment(settings.recordings_dir, "ground", at(0), fmp4(0))
    write_segment(settings.recordings_dir, "ground", at(300), fmp4(1))
    _scanner(settings, store).scan({"ground": True})
    assert _segments(store)[0]["state"] == "corrupt"


def test_sidecar_manifest_is_written(settings, store, fake_probe):
    write_segment(settings.recordings_dir, "ground", at(0), fmp4(3))
    write_segment(settings.recordings_dir, "ground", at(300), fmp4(1))
    _scanner(settings, store).scan({"ground": True})
    sidecar = settings.manifests_dir / "ground" / "2026-10-27_14-00-00-000000_+0000.json"
    data = json.loads(sidecar.read_text())
    assert data["schema"] == "fairplay.segment-manifest/v1"
    assert data["state"] == "finalized" and data["source"]["role"] == "ground"
    assert data["file"]["sha256"] == _segments(store)[0]["sha256"]
    assert data["timing"]["basis"] == "mediamtx_receive_time"


def test_rescan_after_restart_is_idempotent(settings, store, fake_probe):
    write_segment(settings.recordings_dir, "ground", at(0), fmp4(3))
    write_segment(settings.recordings_dir, "ground", at(300), fmp4(1))
    _scanner(settings, store).scan({"ground": True})
    before = _segments(store)
    _scanner(settings, store).scan({"ground": True})  # a new process, same database
    assert _segments(store) == before


def test_verify_detects_a_changed_original(settings, store, fake_probe):
    first = write_segment(settings.recordings_dir, "ground", at(0), fmp4(3))
    write_segment(settings.recordings_dir, "ground", at(300), fmp4(1))
    scanner = _scanner(settings, store)
    scanner.scan({"ground": True})
    seg_id = _segments(store)[0]["id"]
    assert scanner.verify(seg_id)["result"] == "match"
    first.write_bytes(fmp4(3, mdat_bytes=65))
    assert scanner.verify(seg_id)["result"] == "mismatch"
    assert store.one("SELECT 1 FROM alerts WHERE kind = 'segment_mismatch' AND resolved_utc IS NULL")


def test_vanished_open_segment_is_missing(settings, store, fake_probe):
    path = write_segment(settings.recordings_dir, "ground", at(0), fmp4(2))
    scanner = _scanner(settings, store)
    scanner.scan({"ground": True})
    path.unlink()
    scanner.scan({"ground": True})
    assert _segments(store)[0]["state"] == "missing"
