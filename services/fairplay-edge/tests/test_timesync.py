"""Phase 5.6, the timing warnings of F11 (docs/fairplay/phase-5-threat-review.md, "5.6"):

  - the clock's sync state is the kernel's, not assumed, and `clock_not_synced` is raised
    while it has no time source;
  - an offset beyond the bound is kept only when the operator confirms it, and that is in
    the audit chain; one beyond a minute is refused;
  - a camera not yet calibrated is given at least the largest delay it has been measured at.
"""

import sys
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from fairplay_edge import timesync, timing
from fairplay_edge.api import create_app
from fairplay_edge.naming import iso, utcnow

from .conftest import at
from .test_phase3_api import CSRF, clients, service  # noqa: F401  (fixtures)
from .test_timing import spans_all

SYNCED = {"rc": 0, "status": 0, "maxErrorUs": 40_000, "estErrorUs": 2_000}


def read_as(state_tx):
    return lambda bound: timesync.judge(state_tx, bound)


@pytest.fixture
def session(store):
    return timing.create_session(store, "Test match", None, "shadow", "u-op")


# ── the kernel's answer ──────────────────────────────────────────────────

def test_the_kernels_answer_is_judged():
    assert timesync.judge(SYNCED, 1000) == {"state": "synced", "maxErrorMs": 40, "estErrorMs": 2, "source": "kernel"}
    # Synchronised once, but no update for a while: the error bound has grown past 1 s.
    assert timesync.judge({**SYNCED, "maxErrorUs": 1_600_000}, 1000)["state"] == "drifting"
    assert timesync.judge({**SYNCED, "status": timesync.STA_UNSYNC}, 1000)["state"] == "unsynced"
    assert timesync.judge({**SYNCED, "rc": timesync.TIME_ERROR}, 1000)["state"] == "unsynced"
    assert timesync.judge(None, 1000) == {"state": "unknown", "maxErrorMs": None, "estErrorMs": None, "source": "none"}


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="the kernel is asked on Linux only")
def test_the_kernel_answers_without_privilege():
    tx = timesync.kernel_timex()
    assert tx is not None and tx["rc"] >= 0 and tx["maxErrorUs"] >= 0
    assert timesync.read(1000)["state"] in ("synced", "drifting", "unsynced")


def _open_alert(store):
    return store.one("SELECT * FROM alerts WHERE kind = 'clock_not_synced' AND resolved_utc IS NULL")


def test_no_time_source_raises_clock_not_synced_and_a_sync_resolves_it(store):
    tx = {"value": {**SYNCED, "status": timesync.STA_UNSYNC}}
    watch = timing.ClockWatch(store, 1000, read=lambda bound: timesync.judge(tx["value"], bound), settle_seconds=0)
    watch.observe(now=at(0), at_mono=0)
    assert watch.sample(now=at(0), mono=0)["ntpState"] == "unsynced"
    alert = _open_alert(store)
    assert alert["severity"] == "warning" and '"state": "unsynced"' in alert["detail"]
    assert store.one("SELECT ntp_state FROM clock_samples ORDER BY seq DESC LIMIT 1")["ntp_state"] == "unsynced"
    tx["value"] = SYNCED
    watch.observe(now=at(1), at_mono=1)
    assert _open_alert(store) is None
    assert timing.clock_state(store, watch.sync)["ntpState"] == "synced"
    assert timing.clock_state(store, watch.sync)["sync"]["maxErrorMs"] == 40


def test_a_brief_unsynchronised_dip_is_not_reported_and_a_lasting_one_is(store):
    """A daemon stepping the clock leaves it unsynchronised for seconds (Docker Desktop's VM every
    30 s, measured 2-8 s); a clock with no daemon stays so."""
    unsynced = {**SYNCED, "status": timesync.STA_UNSYNC, "maxErrorUs": 16_000_000}
    tx = {"value": SYNCED}
    watch = timing.ClockWatch(store, 1000, read=lambda bound: timesync.judge(tx["value"], bound), settle_seconds=120)
    watch.observe(at_mono=0)
    assert watch.ntp_state == "synced"
    for t, value in ((28, unsynced), (30, unsynced), (34, unsynced), (36, SYNCED), (58, unsynced), (64, SYNCED)):
        tx["value"] = value
        watch.observe(at_mono=t)
        assert watch.ntp_state == "synced" and _open_alert(store) is None, t
    tx["value"] = unsynced  # the daemon stops: unsynchronised from here on
    for t in range(100, 220, 2):
        watch.observe(at_mono=t)
    assert watch.ntp_state == "synced" and _open_alert(store) is None  # 118 s so far
    watch.observe(at_mono=220)
    assert watch.ntp_state == "unsynced" and watch.sync["forSeconds"] == 120 and _open_alert(store) is not None
    tx["value"] = SYNCED
    watch.observe(at_mono=222)
    assert watch.ntp_state == "synced" and _open_alert(store) is None


def test_before_the_state_settles_it_is_unknown_and_said_to_be_checked(store):
    watch = timing.ClockWatch(store, 1000, read=read_as({**SYNCED, "status": timesync.STA_UNSYNC}), settle_seconds=120)
    assert watch.ntp_state == "unknown" and watch.sync["settling"] is True  # not read yet
    watch.observe(at_mono=0)
    assert watch.ntp_state == "unknown" and watch.sync["settling"] is True and _open_alert(store) is None


def test_a_clock_that_cannot_be_asked_raises_nothing(store):
    watch = timing.ClockWatch(store, 1000, read=read_as(None))
    watch.observe(now=at(0), at_mono=0)
    assert store.one("SELECT 1 FROM alerts WHERE kind = 'clock_not_synced'") is None
    assert timing.clock_state(store, watch.sync)["ntpState"] == "unknown"


def test_an_old_clock_step_is_no_longer_news(store):
    watch = timing.ClockWatch(store, 1000, read=read_as(SYNCED))
    now = utcnow()
    watch.sample(now=now - timedelta(hours=3), mono=0)
    watch.sample(now=now - timedelta(hours=3) + timedelta(seconds=65), mono=60 * 10**9)  # jumped 5 s, three hours ago
    assert timing.clock_state(store)["recentSteps"] == []
    watch.sample(now=now, mono=60 * 10**9 + 1)  # a second jump, now
    assert len(timing.clock_state(store)["recentSteps"]) == 1


def test_health_shows_the_kernels_answer(service, clients):  # noqa: F811
    service.clock.read = read_as({**SYNCED, "status": timesync.STA_UNSYNC})
    service.clock.settle_seconds = 0
    service.run_once()  # every pass asks the kernel
    health = clients["admin"].get("/edge/v1/health").json()
    assert health["clock"]["ntpState"] == "unsynced" and health["clock"]["sync"]["source"] == "kernel"
    assert "clock_not_synced" in {a["kind"] for a in health["openAlerts"]}
    assert clients["admin"].get("/edge/v1/clock").json()["ntpState"] == "unsynced"


# ── a large offset ───────────────────────────────────────────────────────

def test_an_offset_beyond_the_bound_must_be_confirmed(store, settings, session):
    # 4.9 s: inside the 5 s bound, kept as it is.
    assert timing.calibrate(store, settings, session["id"], "drone", at(60), at(64.9), 80, "marker", "u-op")["offset_ms"] == 4900
    with pytest.raises(timing.LargeOffset, match=r"\+6\.0 s is larger than cameras usually lag \(5 s\)"):
        timing.calibrate(store, settings, session["id"], "drone", at(60), at(66), 80, "marker", "u-op")
    kept = timing.calibrate(store, settings, session["id"], "drone", at(60), at(66), 80, "marker", "u-op", confirm_large=True)
    assert kept["offset_ms"] == 6000
    # Either way round: a reference picked late is as wrong as one picked early.
    with pytest.raises(timing.LargeOffset):
        timing.calibrate(store, settings, session["id"], "drone", at(66), at(60), 80, "marker", "u-op")


def test_an_offset_beyond_a_minute_is_refused_even_when_confirmed(store, settings, session):
    with pytest.raises(timing.TimingError, match="not a camera's delay") as caught:
        timing.calibrate(store, settings, session["id"], "drone", at(0), at(61), 80, "marker", "u-op", confirm_large=True)
    assert not isinstance(caught.value, timing.LargeOffset)


def test_the_console_is_asked_to_confirm_and_a_confirmation_is_audited(clients, service):  # noqa: F811
    admin, op = clients["admin"], clients["operator"]
    sid = admin.post("/edge/v1/sessions", headers=CSRF, json={"label": "Lions v Eagles"}).json()["id"]
    body = {"source": "drone", "referenceUtc": iso(at(10)), "observedIngestUtc": iso(at(22.5)), "uncertaintyMs": 200,
            "method": "whistle"}
    r = op.post(f"/edge/v1/sessions/{sid}/calibrations", headers=CSRF, json=body)
    assert r.status_code == 409 and r.json()["error"] == "offset_needs_confirmation"
    assert "+12.5 s" in r.json()["message"]
    assert op.get(f"/edge/v1/sessions/{sid}/calibrations").json()["history"] == []
    r = op.post(f"/edge/v1/sessions/{sid}/calibrations", headers=CSRF, json={**body, "confirmLargeOffset": True})
    assert r.status_code == 201, r.text
    entries = [e for e in admin.get("/edge/v1/audit").json() if e["action"] == "calibration.large_offset_confirmed"]
    assert len(entries) == 1 and entries[0]["entity_id"] == r.json()["id"] and entries[0]["actor_id"] == "u-operator"
    assert entries[0]["detail"]["offsetMs"] == 12500 and entries[0]["detail"]["boundMs"] == 5000
    small = op.post(f"/edge/v1/sessions/{sid}/calibrations", headers=CSRF,
                    json={**body, "observedIngestUtc": iso(at(10.8)), "confirmLargeOffset": True})
    assert small.status_code == 201
    assert len([e for e in admin.get("/edge/v1/audit").json() if e["action"] == "calibration.large_offset_confirmed"]) == 1


def test_the_bound_is_configurable(env, store, session):
    from fairplay_edge.config import load_settings

    env["FAIRPLAY_CALIBRATION_CONFIRM_MS"] = "8000"
    settings = load_settings(env)
    assert timing.calibrate(store, settings, session["id"], "drone", at(0), at(7), 80, "marker", "u-op")["offset_ms"] == 7000


# ── a camera not yet calibrated ──────────────────────────────────────────

def _earlier_match(store, settings, offset_s, uncertainty_ms=300, source="drone", **kw):
    s = timing.create_session(store, f"earlier {offset_s}", None, "shadow", "u-op")
    return timing.calibrate(store, settings, s["id"], source, at(0), at(offset_s), uncertainty_ms, "marker", "u-op",
                            confirm_large=True, **kw), s


def test_with_no_measurement_the_default_holds(store, settings, session):
    view = {v["source"]: v for v in timing.calibration_view(store, settings, session["id"])}
    assert view["drone"]["uncertaintyMs"] == 3000 and view["drone"]["uncertaintyBasis"] == "default"


def test_a_camera_is_as_uncertain_as_the_largest_delay_measured_for_it(store, settings, session):
    _earlier_match(store, settings, 1.2)
    _earlier_match(store, settings, 4.2)  # the drone once lagged 4.2 s, ± 0.3 s
    view = {v["source"]: v for v in timing.calibration_view(store, settings, session["id"])}
    assert (view["drone"]["uncertaintyMs"], view["drone"]["uncertaintyBasis"]) == (4500, "measured")
    assert (view["ground"]["uncertaintyMs"], view["ground"]["uncertaintyBasis"]) == (3000, "default")
    window = timing.source_window(store, session["id"], "drone", at(600), 20_000, 10_000, spans_all)
    assert window["uncertaintyMs"] == 4500 and window["durationMs"] == 30_000 + 2 * 4500
    assert window["uncertaintyBasis"] == "measured" and "uncalibrated" in window["flags"]
    # Once this match calibrates the drone, its own measurement is what counts.
    timing.calibrate(store, settings, session["id"], "drone", at(500), at(501), 100, "whistle", "u-op")
    assert timing.source_window(store, session["id"], "drone", at(600), 20_000, 10_000, spans_all)["uncertaintyMs"] == 100


def test_a_corrected_or_an_old_measurement_does_not_count(store, settings, session):
    wrong, s = _earlier_match(store, settings, 40)  # a slip of the hand, confirmed, then corrected
    timing.calibrate(store, settings, s["id"], "drone", at(0), at(2), 300, "marker", "u-op", supersedes=wrong["id"])
    old, _ = _earlier_match(store, settings, 9)
    with store.tx() as db:
        db.execute("UPDATE calibrations SET created_utc = ? WHERE id = ?", (iso(utcnow() - timedelta(days=91)), old["id"]))
    assert timing.uncalibrated_uncertainty(store, "drone") == (3000, "default")


def test_an_incident_records_the_measured_uncertainty(store, settings, session):
    from fairplay_edge import incidents

    _earlier_match(store, settings, 4.2)
    windows = {w["source"]: w for w in incidents.window_definitions(store, settings, session["id"], at(600), 20_000, 10_000)}
    assert windows["drone"]["uncertaintyMs"] == 4500 and windows["ground"]["uncertaintyMs"] == 3000


def test_the_api_offers_no_clock_it_has_not_read(service):  # noqa: F811
    """Before the first reading the state is unknown and being checked, never a guess."""
    service.clock = timing.ClockWatch(service.store, read=read_as(SYNCED))
    with TestClient(create_app(service, run_loop=False)) as c:
        r = c.get("/edge/v1/clock", headers={"Authorization": f"Bearer {service.settings.api_token}"})
    assert r.json()["ntpState"] == "unknown" and r.json()["sync"]["settling"] is True
