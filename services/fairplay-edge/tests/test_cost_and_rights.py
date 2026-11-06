"""Phase 6.6: the worksheet's arithmetic, and two pages held to what the code really does."""

import io
import json
import re
from dataclasses import fields
from datetime import timedelta
from pathlib import Path

import pytest

from fairplay_edge import __main__ as cli
from fairplay_edge import api, evidence, incidents, measure, retention, worksheet

from .conftest import at
from .test_evidence import OP, FakeCutter, flag, session, ten_second_segments  # noqa: F401 (fixtures)
from .test_measure import segment

EDGE = Path(__file__).resolve().parents[1]
REPO = Path(__file__).resolve().parents[3]
PACKAGE = EDGE / "fairplay_edge"


def text_of(*parts: str) -> str:
    path = REPO.joinpath(*parts)
    if not path.exists():
        pytest.skip("needs the repository's docs and API (run from the checkout, as CI does)")
    return path.read_text(encoding="utf-8")


def example_env() -> dict[str, str]:
    lines = (EDGE / ".env.example").read_text("utf-8").splitlines()
    return dict(line.split("=", 1) for line in lines if "=" in line and not line.startswith("#"))


def test_it_agrees_with_phase_4s_hand_estimate():
    # 2.5 Mbit/s, two sources, 10 incidents, 10 matches: 200 clips, 1.9 GB a month, 5.6 GB held, $0.084.
    out = worksheet.work_out({"ground": 2.5, "drone": 2.5})
    assert out["perMatch"]["clipsGb"] == pytest.approx(0.188, abs=0.001)
    assert out["r2"]["gbHeldAtSteadyState"] == pytest.approx(5.62, abs=0.01)
    assert out["r2"]["storageUsdPerMonth"] == pytest.approx(0.084, abs=0.001)
    assert out["r2"]["classAPerMonth"] == 400


def test_it_agrees_with_what_measure_reports_per_hour():
    # measure: gbPerHour = mbit * 3600 / 8 / 1000. 3.2 Mbit/s for 3 hours, from the 6.4 run's 1.44 GB an hour.
    assert worksheet.work_out({"a": 3.2})["perMatch"]["recordingGb"] == pytest.approx(1.44 * 3)


def test_the_disk_adds_up():
    out = worksheet.work_out({"ground": 2.6, "drone": 0.6})
    disk = out["edgeDisk"]
    assert out["assumptions"]["matches_in_retention"] == 5  # 10 a month over 14 days, rounded up
    assert disk["neededIfHoldsEndGb"] == pytest.approx(disk["recordingsInRetentionGb"] + disk["clipsGb"] + disk["replayCacheGb"] + disk["softLimitGb"], abs=0.11)
    assert disk["neededAsBuiltGb"] == pytest.approx(disk["neededIfHoldsEndGb"] + disk["keptPastRetentionGb"], abs=0.11)
    assert disk["sustainedWriteTargetMBps"] == pytest.approx(3 * 3.2 / 8)
    assert out["backup"]["gbAfterTheseMonths"] == disk["clipsGb"]


def test_kept_footage_is_whole_segments_on_every_camera_and_never_more_than_the_recording():
    one = worksheet.work_out({"a": 8}, worksheet.Assumptions(incidents_per_match=1))["perMatch"]
    assert one["keptPastRetentionGb"] == pytest.approx(50 * 8 / 8 / 1000, abs=0.01)  # a 30 s window and a 20 s segment
    many = worksheet.work_out({"a": 8}, worksheet.Assumptions(incidents_per_match=1000))["perMatch"]
    assert many["keptPastRetentionGb"] == many["recordingGb"] and many["keptSharePercent"] == 100


def test_a_tournament_can_bunch_its_matches():
    even = worksheet.work_out({"a": 3})
    bunched = worksheet.work_out({"a": 3}, worksheet.Assumptions(matches_in_retention=20))
    assert even["assumptions"]["matches_in_retention"] == 5
    assert bunched["edgeDisk"]["recordingsInRetentionGb"] == pytest.approx(even["perMatch"]["recordingGb"] * 20, abs=0.1)


def test_only_the_operator_can_call_a_result_a_venue_figure():
    assert "NOT A VENUE FIGURE" in worksheet.render(worksheet.work_out({"a": 3}))
    assert worksheet.work_out({"a": 3}, measured_at_venue=True)["bitrates"]["kind"] == "measured at the venue"
    assert "NOT A VENUE FIGURE" not in worksheet.render(worksheet.work_out({"a": 3}, measured_at_venue=True))


@pytest.mark.parametrize("bad", ["ground", "ground=", "ground=abc", "ground=0", "ground=-1", "ground=nan", "ground=inf", "=3"])
def test_a_bad_rate_is_refused(bad, capsys):
    assert cli.main(["worksheet", "--mbit", bad]) == 2
    assert "--mbit takes camera=rate" in capsys.readouterr().err


@pytest.mark.parametrize("flag", ["--hours", "--matches-per-month", "--incidents", "--clip-seconds", "--evidence-months"])
def test_a_bad_assumption_is_refused(flag, capsys):
    assert cli.main(["worksheet", "--mbit", "a=3", flag, "0"]) == 2
    assert "above 0" in capsys.readouterr().err


@pytest.mark.parametrize("report", ["nope", "[]", "{}", '{"sources": []}', '{"sources": [{"source": "a", "segments": 0}]}'])
def test_anything_but_a_measured_report_is_refused(report, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO(report))
    assert cli.main(["worksheet", "--from", "-"]) == 2
    assert capsys.readouterr().err


def test_the_command_reads_measures_own_report(store, settings, tmp_path, capsys):
    segment(store, "ground", 0, 300)
    segment(store, "drone", 0, 300, mbit=4.0)
    measured = measure.report(settings, store)
    report = tmp_path / "edge.json"
    report.write_text(json.dumps(measured), encoding="utf-8")
    assert cli.main(["worksheet", "--from", str(report), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["bitrates"]["cameras"] == {"ground": 8.0, "drone": 4.0}


def test_the_prices_are_the_clouds():
    config = text_of("services", "api", "src", "fairplay", "fairplay.config.ts")
    prices = worksheet.PRICES
    assert f"storagePerGbMonth: {prices['storagePerGbMonth']}, classAPerMillion: {prices['classAPerMillion']}, classBPerMillion: {prices['classBPerMillion']}" in config


def test_the_defaults_are_what_ships():
    example, a = example_env(), worksheet.Assumptions()
    assert int(example["FAIRPLAY_RETENTION_DAYS"]) == a.retention_days
    assert example["FAIRPLAY_RECORD_SEGMENT_DURATION"] == f"{a.segment_seconds:.0f}s"
    assert worksheet.REPLAY_CACHE_GB == api.REPLAY_CACHE_BYTES / 1e9
    assert '"FAIRPLAY_DISK_SOFT_FREE_GB", "20"' in (PACKAGE / "config.py").read_text("utf-8")
    assert "pre_roll_ms: int = 20_000, post_roll_ms: int = 10_000" in (PACKAGE / "incidents.py").read_text("utf-8")
    assert a.clip_seconds == 30


def test_every_assumption_can_be_seen_in_the_output():
    out = worksheet.work_out({"a": 3})
    assert {f.name for f in fields(worksheet.Assumptions)} == set(out["assumptions"])


# ── what the pages say about the code ─────────────────────────────────────

def sources() -> dict[str, str]:
    return {p.name: p.read_text("utf-8") for p in PACKAGE.glob("*.py")}


def test_the_pages_describe_the_rule_that_ends_an_incident_hold():
    """RC1 was built on 6 November 2026 (test_incident_hold_rc1.py). If this fails, the rule moved:
    update cost-worksheet.md, privacy.md, decisions.md and R25, and tell Fola, whose rights sheet
    records the decision."""
    code = sources()
    callers = {name for name, text in code.items() if "release_hold(" in text}
    assert callers == {"retention.py", "api.py", "incidents.py"}
    assert code["incidents.py"].count("release_hold(") == 1 and "incident window changed" in code["incidents.py"]
    assert "INCIDENT_HOLD_DAYS = 14" in code["retention.py"] and "release_finished_incident_holds(store, now)" in code["retention.py"]
    assert {name for name, text in code.items() if re.search(r"UPDATE\s+evidence_refs", text)} == {"retention.py"}
    assert "created_utc, evidence_id) VALUES (?, ?, 0, ?, ?)" in code["evidence.py"]
    cost = text_of("docs", "fairplay", "cost-worksheet.md")
    assert "Fixed on 6 November 2026" in cost and "14 days after its finding" in cost
    r25 = text_of("docs", "fairplay", "residual-risks.md").split("| R25 |")[1].split("\n")[0]
    assert "In code since 6 November 2026" in r25 and "no finding releases 14 days after its session ended" in r25
    assert "until 14 days after that incident's finding" in text_of("docs", "fairplay", "privacy.md")
    assert "6 November 2026, on D9 (RC1)" in text_of("docs", "fairplay", "decisions.md")


def test_retention_really_keeps_it(store, settings, session, ten_second_segments):  # noqa: F811
    inc = flag(store, settings, session)
    job, _ = evidence.request_clip(store, settings, inc["id"], "ground", OP)
    clip = evidence.get(store, evidence.run_job(store, settings, FakeCutter(), job["id"])["evidence_id"])
    long_after = at(0) + timedelta(days=4000)
    cut_from = set(clip["source_segment_ids"])
    assert cut_from and not cut_from & {r["id"] for r in retention.plan(store, 14, long_after)}
    hold = store.one("SELECT * FROM holds WHERE id = ?", (inc["hold_id"],))
    assert hold["source"] is None and hold["released_utc"] is None  # every camera, and no end
    retention.release_hold(store, inc["hold_id"], "test: an admin's manual release")
    doomed = {r["id"] for r in retention.plan(store, 14, long_after)}
    assert doomed and not cut_from & doomed  # with the hold gone, what a clip was cut from still stays


def test_the_rights_page_matches_the_gate():
    page = text_of("docs", "fairplay", "rights-checklist.md")
    for status in incidents.RIGHTS_STATUSES:
        assert f"`{status}`" in page, status
    assert incidents.release_check({"footage_kind": "synthetic", "status": "not_recorded", "minors_present": "unknown", "consent_reference": None})[0]
    assert not incidents.release_check({"footage_kind": "real", "status": "internal_review_only", "minors_present": "no", "consent_reference": None})[0]
    assert not incidents.release_check({"footage_kind": "real", "status": "external_release_permitted", "minors_present": "unknown", "consent_reference": None})[0]
    assert incidents.release_check({"footage_kind": "real", "status": "external_release_permitted", "minors_present": "no", "consent_reference": None})[0]
    assert "opens every gate" in page and '"Minors: no" removes the need' in page


def test_what_the_page_says_goes_into_the_audit_log_does():
    assert '"basis",' in (PACKAGE / "incidents.py").read_text("utf-8") and '"consentReferenceSha256"' in (PACKAGE / "incidents.py").read_text("utf-8")


def test_the_retention_table_matches_the_decisions():
    page = text_of("docs", "fairplay", "rights-checklist.md")
    assert "| Recordings | Edge | 14 days | D9 |" in page
    assert "| Clips | Edge | end of season + 12 months | D10 | nothing |" in page
    assert "| Clips | R2 | 90 days after the finding | D10 |" in page
    decisions = text_of("docs", "fairplay", "decisions.md")
    assert "**14 days**" in decisions and "end of season + 12 months" in decisions and "**90 days after the finding**" in decisions
    # The Edge's half of D10 has no code, as the page says. The worksheet only names it as an assumption.
    assert not any("season" in text for name, text in sources().items() if name != "worksheet.py")


def test_the_request_document_still_says_what_rc2_says_it_does():
    """When RC1 and RC2 are done this changes, and the page must too."""
    service = text_of("services", "api", "src", "fairplay", "requests.service.ts")
    assert "deletedBy: new Date(ended.getTime() + RECORDINGS_KEPT_DAYS" in service
    assert "`requests.service.ts`" in text_of("docs", "fairplay", "rights-checklist.md")


def test_the_pages_leave_the_decisions_to_fola_and_link_only_what_is_there():
    rights = text_of("docs", "fairplay", "rights-checklist.md")
    cost = text_of("docs", "fairplay", "cost-worksheet.md")
    assert "not legal advice" in rights and "(Fola Sanni)" in rights and "Signed" not in rights
    assert "NOT A VENUE FIGURE" in cost and "No real\ncamera has been measured" in cost
    for page in (rights, cost):
        for link in re.findall(r"\]\(\./([a-zA-Z0-9/_-]+\.md)", page):
            assert (REPO / "docs" / "fairplay" / link).exists(), link


def test_the_worked_result_is_what_the_tool_prints():
    cost = text_of("docs", "fairplay", "cost-worksheet.md")
    printed = worksheet.render(worksheet.work_out({"drone": 0.6, "ground": 2.6}))
    assert printed.strip() in cost.replace("\r\n", "\n")
    big = worksheet.work_out({"ground": 8, "drone": 8})
    assert f"{big['edgeDisk']['neededAsBuiltGb']:,} GB" in cost and f"{big['edgeDisk']['neededIfHoldsEndGb']} GB" in cost
    assert round(big["r2"]["totalUsdPerMonth"], 2) == 0.27 and "about $0.27" in cost
