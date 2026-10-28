from datetime import timedelta

import pytest

from fairplay_edge import incidents, retention, timing
from fairplay_edge.audit import Actor
from fairplay_edge.naming import iso, parse_iso
from fairplay_edge.store import new_id

from .conftest import at

OP = Actor("u-op", "u-op", "operator")


@pytest.fixture
def session(store):
    return timing.create_session(store, "Test match", None, "shadow", "u-op")


def spans_all(source, start, end):
    """Every source recorded continuously."""
    return [{"startUtc": iso(start - timedelta(hours=1)), "endUtc": iso(end + timedelta(hours=1))}], "test"


def spans_none(source, start, end):
    return [], "test"


def test_only_shadow_or_post_match(store):
    with pytest.raises(timing.TimingError, match="shadow or post_match"):
        timing.create_session(store, "x", None, "referee_support", "u")


def test_offset_is_observed_minus_reference(store, settings, session):
    cal = timing.calibrate(store, settings, session["id"], "drone", at(60), at(60.4), 80, "marker", "u-op")
    assert cal["offset_ms"] == 400  # the drone lags by 400 ms


def test_uncertainty_below_a_frame_is_refused(store, settings, session):
    with pytest.raises(timing.TimingError, match="one frame"):
        timing.calibrate(store, settings, session["id"], "drone", at(60), at(60.4), 5, "marker", "u-op")


def test_each_source_keeps_its_own_offset(store, settings, session):
    timing.calibrate(store, settings, session["id"], "ground", at(60), at(60.1), 40, "marker", "u")
    timing.calibrate(store, settings, session["id"], "drone", at(60), at(60.5), 40, "marker", "u")
    view = {v["source"]: v for v in timing.calibration_view(store, settings, session["id"])}
    assert view["ground"]["offsetMs"] == 100 and view["drone"]["offsetMs"] == 500
    assert view["ground"]["flags"] == [] and view["drone"]["flags"] == []


def test_newest_calibration_wins(store, settings, session):
    timing.calibrate(store, settings, session["id"], "drone", at(60), at(60.5), 40, "marker", "u")
    timing.calibrate(store, settings, session["id"], "drone", at(120), at(120.3), 40, "marker", "u")
    assert timing.current_calibration(store, session["id"], "drone")["offset_ms"] == 300


def _drone_flags(store, settings, session, now):
    return {v["source"]: v for v in timing.calibration_view(store, settings, session["id"], now=now)}["drone"]["flags"]


def _drop(store, source, frm, to=None):
    with store.tx() as db:
        db.execute("INSERT INTO feed_intervals (id, source, down_from_utc, down_to_utc) VALUES (?, ?, ?, ?)",
                   (new_id(), source, iso(frm), iso(to) if to else None))


def test_a_drop_after_the_calibrated_footage_makes_it_stale_for_later_footage_only(store, settings, session):
    """Footage time, not wall time: a calibration holds for the unbroken stretch it was measured in."""
    timing.calibrate(store, settings, session["id"], "drone", at(60), at(60.4), 80, "marker", "u")
    _drop(store, "drone", at(100), at(130))
    assert _drone_flags(store, settings, session, now=at(90)) == []
    assert "stale_after_reconnect" in _drone_flags(store, settings, session, now=at(300))
    before = timing.source_window(store, session["id"], "drone", at(80), 5000, 5000, spans_all)
    after = timing.source_window(store, session["id"], "drone", at(200), 5000, 5000, spans_all)
    assert before["flags"] == [] and after["state"] == "stale_after_reconnect"


def test_a_drop_before_the_calibrated_footage_spoils_earlier_footage(store, settings, session):
    timing.calibrate(store, settings, session["id"], "drone", at(600), at(600.4), 80, "marker", "u")
    _drop(store, "drone", at(100), at(130))
    early = timing.source_window(store, session["id"], "drone", at(50), 5000, 5000, spans_all)
    assert early["state"] == "stale_after_reconnect"


def test_recalibrating_on_the_new_stretch_clears_it(store, settings, session):
    cal = timing.calibrate(store, settings, session["id"], "drone", at(60), at(60.4), 80, "marker", "u")
    _drop(store, "drone", at(100), at(130))
    timing.calibrate(store, settings, session["id"], "drone", at(200), at(200.3), 80, "marker", "u", supersedes=cal["id"])
    assert _drone_flags(store, settings, session, now=at(300)) == []


def test_a_drop_still_in_progress_makes_the_calibration_stale(store, settings, session):
    timing.calibrate(store, settings, session["id"], "drone", at(60), at(60.4), 80, "marker", "u")
    _drop(store, "drone", at(100))
    assert "stale_after_reconnect" in _drone_flags(store, settings, session, now=at(300))


def test_a_gap_in_the_recordings_is_evidence_of_a_break_too(store, settings, session):
    """The watchdog may not have been running; the recordings still show the break."""
    timing.calibrate(store, settings, session["id"], "drone", at(60), at(60.4), 80, "marker", "u")

    def gap_at_100(source, start, end):
        return [{"startUtc": iso(start - timedelta(hours=1)), "endUtc": iso(at(100))},
                {"startUtc": iso(at(105)), "endUtc": iso(end + timedelta(hours=1))}], "test"

    w = timing.source_window(store, session["id"], "drone", at(200), 5000, 5000, gap_at_100)
    assert w["state"] == "stale_after_reconnect"
    assert timing.source_window(store, session["id"], "drone", at(80), 5000, 5000, gap_at_100)["flags"] == []


def test_uncalibrated_and_high_uncertainty_flags(store, settings, session):
    view = {v["source"]: v for v in timing.calibration_view(store, settings, session["id"])}
    assert view["ground"]["flags"] == ["uncalibrated"]
    timing.calibrate(store, settings, session["id"], "ground", at(0), at(0.2), 800, "manual", "u")
    view = {v["source"]: v for v in timing.calibration_view(store, settings, session["id"])}
    assert view["ground"]["flags"] == ["uncertainty_high"]


def test_window_applies_the_source_offset(store, settings, session):
    timing.calibrate(store, settings, session["id"], "drone", at(0), at(0.4), 100, "marker", "u")
    w = timing.source_window(store, session["id"], "drone", at(300), 20_000, 10_000, spans_all)
    # start = event - pre + offset - uncertainty
    assert parse_iso(w["startIngestUtc"]) == at(300 - 20 + 0.4 - 0.1)
    assert w["durationMs"] == 30_000 + 200 and w["eventAtMs"] == 20_100
    assert w["state"] == "ok" and w["flags"] == []


def test_window_without_footage_says_so(store, settings, session):
    w = timing.source_window(store, session["id"], "drone", at(300), 20_000, 10_000, spans_none)
    assert w["state"] == "no_footage" and "uncalibrated" in w["flags"]


def test_window_with_partial_footage_is_a_gap(store, settings, session):
    def half(source, start, end):
        return [{"startUtc": iso(start), "endUtc": iso(start + (end - start) / 2)}], "test"

    w = timing.source_window(store, session["id"], "ground", at(300), 20_000, 10_000, half)
    assert w["state"] == "gap"


def test_incident_creates_a_hold_and_windows(store, settings, session):
    inc = incidents.create(store, settings, session["id"], OP, event_utc=at(600), basis="manual", category="penalty")
    hold = store.one("SELECT * FROM holds WHERE id = ?", (inc["hold_id"],))
    assert hold["reason"] == "incident" and hold["ref"] == inc["id"] and hold["source"] is None
    assert parse_iso(hold["from_utc"]) <= at(600 - 20) and parse_iso(hold["to_utc"]) >= at(600 + 10)
    windows = timing.incident_windows(store, settings, inc["id"], spans_all)
    assert [w["source"] for w in windows["perSource"]] == ["ground", "drone"]
    assert "keyframes" in windows["note"]


def test_incident_edit_needs_the_current_version(store, settings, session):
    inc = incidents.create(store, settings, session["id"], OP, event_utc=at(600))
    updated = incidents.edit(store, settings, inc["id"], 1, OP, {"pre_roll_ms": 40_000})
    assert updated["version"] == 2 and updated["hold_id"] != inc["hold_id"]
    old = store.one("SELECT released_utc FROM holds WHERE id = ?", (inc["hold_id"],))
    assert old["released_utc"] is not None  # replaced, not edited
    with pytest.raises(timing.Conflict):
        incidents.edit(store, settings, inc["id"], 1, OP, {"note": "late edit"})


def test_incident_rolls_are_validated(store, settings, session):
    with pytest.raises(timing.TimingError):
        incidents.create(store, settings, session["id"], OP, pre_roll_ms=-1)
    with pytest.raises(timing.TimingError):
        incidents.create(store, settings, session["id"], OP, pre_roll_ms=9 * 60_000, post_roll_ms=2 * 60_000)
    with pytest.raises(timing.TimingError):
        incidents.create(store, settings, session["id"], OP, category="overturned")


def test_ended_session_refuses_new_marks(store, settings, session):
    timing.end_session(store, session["id"], "u")
    with pytest.raises(timing.Conflict):
        incidents.create(store, settings, session["id"], OP)


def test_sync_test_claims_nothing_until_every_source_is_calibrated(store, settings, session):
    result = timing.sync_test(store, settings, session["id"], at(300), spans_all)
    assert not result["aligned"] and result["alignmentUncertaintyMs"] is None
    timing.calibrate(store, settings, session["id"], "ground", at(0), at(0.1), 40, "marker", "u")
    timing.calibrate(store, settings, session["id"], "drone", at(0), at(0.5), 60, "marker", "u")
    result = timing.sync_test(store, settings, session["id"], at(300), spans_all)
    assert result["aligned"] and result["alignmentUncertaintyMs"] == 100
    assert result["statement"] == "aligned within ±100 ms"


def test_period_marks_supersede(store, session):
    first = timing.mark_period(store, session["id"], "1", "start", "u", at=at(0))
    timing.mark_period(store, session["id"], "1", "start", "u", at=at(2), supersedes=first["id"])
    current = timing.current_periods(store, session["id"])
    assert [p["edge_utc"] for p in current] == [iso(at(2))]


def test_period_mark_records_the_console_delta(store, session):
    mark = timing.mark_period(store, session["id"], "2", "start", "u", at=at(10), console_anchor=iso(at(9.25)))
    assert mark["console_delta_ms"] == 750


def test_clock_step_is_noticed(store):
    watch = timing.ClockWatch(store)
    watch.sample(now=at(0), mono=0)
    watch.sample(now=at(60), mono=60 * 10**9)
    assert store.one("SELECT 1 FROM alerts WHERE kind = 'clock_stepped' AND resolved_utc IS NULL") is None
    watch.sample(now=at(125), mono=120 * 10**9)  # the wall clock jumped 5 s
    alert = store.one("SELECT * FROM alerts WHERE kind = 'clock_stepped' AND resolved_utc IS NULL")
    assert alert and '"stepMs": 5000' in alert["detail"]


def test_replay_percentiles_are_nearest_rank(store):
    with store.tx() as db:
        for ms in range(1, 101):  # 1..100 ms
            db.execute("INSERT INTO replay_metrics (at_utc, source, window_start_utc, duration_ms, to_playable_ms,"
                       " outcome) VALUES ('t', 'ground', 's', 1000, ?, 'playable')", (ms,))
        db.execute("INSERT INTO replay_metrics (at_utc, source, window_start_utc, duration_ms, outcome)"
                   " VALUES ('t', 'drone', 's', 1000, 'error')")
    s = timing.replay_summary(store)
    assert (s["samples"], s["playable"], s["p50Ms"], s["p95Ms"], s["maxMs"]) == (101, 100, 50, 95, 100)
    assert len(s["failed"]) == 1


def test_incident_hold_protects_footage_from_retention(store, settings, session):
    with store.tx() as db:
        db.execute("INSERT INTO segments (id, source, rel_path, start_utc, end_utc, state, discovered_utc)"
                   " VALUES ('seg', 'ground', 'ground/x.mp4', ?, ?, 'finalized', 't')", (iso(at(590)), iso(at(620))))
    incidents.create(store, settings, session["id"], OP, event_utc=at(600))
    assert retention.plan(store, 1, at(600) + timedelta(days=30)) == []
