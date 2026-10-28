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
    assert first.stat().st_mode & 0o222 == 0  # final originals are read-only
    first.chmod(0o644)  # someone with the rights to do it changes the file anyway
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


def test_pictures_lost_at_a_segment_switch_are_raised(settings, store, monkeypatch):
    """MediaMTX can discard late video at a segment switch: the next segment then opens on
    frames it cannot decode. Measured from the previous segment's last picture to this
    segment's first keyframe; the files are whole, so both stay finalized."""
    from fairplay_edge import manifest as manifest_module
    from fairplay_edge.probe import Probe

    def probed(path):
        raw = {"format": {"duration": "32.0"}, "streams": [{"codec_type": "video", "start_time": "0.04",
                                                            "duration": "30.0"}, {"codec_type": "audio"}]}
        return Probe(codec="h264", profile="High", width=1280, height=720, fps="25/1", time_base="1/90000",
                     start_pts=0, start_time_s=0.04, duration_ms=32_000, has_audio=True, raw=raw)

    first_key = {"value": 0.04}
    monkeypatch.setattr(manifest_module, "probe", probed)
    monkeypatch.setattr(manifest_module, "video_packets", lambda path, interval=None: [(first_key["value"], True)])
    write_segment(settings.recordings_dir, "ground", at(0), fmp4(3))
    Scanner(settings, store).scan({})
    first_key["value"] = 0.96  # opens on 0.92 s of frames without their keyframe
    write_segment(settings.recordings_dir, "ground", at(32), fmp4(3))
    Scanner(settings, store).scan({})
    row = store.one("SELECT state, problems FROM segments WHERE start_utc = ?", ("2026-10-27T14:00:32.000Z",))
    # previous pictures end at 14:00:30.000; this one's first decodable frame is at 14:00:32.920
    assert row["state"] == "finalized" and "2920 ms of pictures missing" in row["problems"]
    alert = store.one("SELECT * FROM alerts WHERE kind = 'segment_video_gap' AND resolved_utc IS NULL")
    assert alert and alert["source"] == "ground"
    first_key["value"] = 0.04
    write_segment(settings.recordings_dir, "ground", at(62), fmp4(3))
    Scanner(settings, store).scan({})  # 32.000 + 30 = 62.000: continuous again
    assert store.one("SELECT 1 FROM alerts WHERE kind = 'segment_video_gap' AND resolved_utc IS NULL") is None
