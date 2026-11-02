"""Phase 6.7: the demo stays synthetic and apart, and the go/no-go page misses nothing on the record."""

import importlib.util
import re
import sys
from pathlib import Path

import pytest

from fairplay_edge import incidents

EDGE = Path(__file__).resolve().parents[1]
REPO = Path(__file__).resolve().parents[3]
FP = ("docs", "fairplay")


def text_of(*parts: str) -> str:
    path = REPO.joinpath(*parts)
    if not path.exists():
        pytest.skip("needs the repository's docs and API (run from the checkout, as CI does)")
    return path.read_text(encoding="utf-8")


def demo_module():
    sys.path.insert(0, str(EDGE / "fixtures"))
    spec = importlib.util.spec_from_file_location("run_demo", EDGE / "fixtures" / "run_demo.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_demo_incident_is_labelled_and_worded_as_a_finding_must_be():
    demo = demo_module()
    assert demo.PROJECT == "fpdemo"  # never the installed project's volumes
    for spec in demo.INCIDENTS:
        assert spec["category"] in incidents.CATEGORIES and spec["result"] in incidents.RESULTS
        for field in ("note", "finding"):
            assert spec[field].startswith("DEMO, synthetic feed."), spec["name"]
        assert spec["onField"].startswith("DEMO: pretend")
        assert not re.search(r"referee|corrupt|biased|cheat|\bVAR\b", spec["note"] + spec["finding"], flags=re.I), spec["name"]


def test_the_demo_pulls_and_builds_nothing():
    driver = (EDGE / "fixtures" / "run_demo.py").read_text("utf-8")
    assert '"--build"' not in driver and driver.count('"--no-build"') == 2
    cloud = text_of("services", "api", "scripts", "fairplay-demo-cloud.ts")
    assert '"--pull", "never"' in cloud


def test_the_demo_is_test_only_and_shares_the_edges_own_network():
    compose = (EDGE / "compose.demo.yaml").read_text("utf-8")
    assert compose.startswith("# TEST ONLY")
    assert 'network_mode: "service:edge"' in compose and "ports:" not in compose
    assert "compose.demo.yaml" not in (EDGE / "deploy" / "install.sh").read_text("utf-8")
    assert "compose.demo.yaml" not in (EDGE / "deploy" / "update.sh").read_text("utf-8")


def test_the_demos_cloud_refuses_a_database_that_is_not_throwaway_and_prints_no_secret():
    cloud = text_of("services", "api", "scripts", "fairplay-demo-cloud.ts")
    assert "/scratch|test|ci/i.test" in cloud and "process.exit(2)" in cloud
    logged = " ".join(re.findall(r"console\.(?:log|error)\(([^;]*)\);", cloud))
    assert not re.search(r"password|bootstrapToken|\bpin\b|apiKey", logged)
    assert "fairplay:democloud" in text_of("services", "api", "package.json")


def test_the_walkthrough_follows_the_packs_twelve_steps_in_eight_minutes():
    page = text_of(*FP, "demo-walkthrough.md")
    steps = re.findall(r"^\| (\d+) \| (\d+):(\d\d) \|", page, flags=re.M)
    assert [int(n) for n, _, _ in steps] == list(range(1, 13))
    seconds = [int(m) * 60 + int(s) for _, m, s in steps]
    assert seconds == sorted(seconds) and seconds[0] == 0 and seconds[-1] < 8 * 60
    for words in ("Flag incident", "−30 s", "Inconclusive", "wan off", "wan on", "SHA-256", "Match center", "Open clip", "estimate"):
        assert words in page, words


def test_the_walkthrough_says_what_it_cannot_prove():
    page = text_of(*FP, "demo-walkthrough.md")
    assert "that the bucket is private" in page and "checks no signature" in page
    assert "Never call it VAR or FVS" in page and "Everything shown is made up" in page
    assert "F27" in page and "F28" in page and "12 s lost" in page


def test_the_buttons_it_names_are_on_the_screens():
    console = text_of("apps", "fairplay-console", "src", "Console.tsx") + text_of("apps", "fairplay-console", "src", "Review.tsx")
    for label in ("Flag incident", "Start review", "Record finding", "Inconclusive", "Audit trail"):
        assert label in console, label
    web = text_of("apps", "web", "src", "modules", "admin", "fairplay", "AdminFairPlayReportPage.tsx")
    assert "Open clip" in web


def test_the_draft_report_is_marked_and_has_the_reports_own_words():
    page = text_of(*FP, "demo-report-draft.md")
    assert page.startswith("# DRAFT") and "Made entirely from synthetic test" in page and "Nothing has been sent to anyone" in page
    assert "not a FIFA-authorised VAR or FVS review" in page.replace("\n", " ")
    assert "not a FIFA-authorised VAR or FVS review" in text_of("services", "api", "src", "fairplay", "report.service.ts")
    assert "Operator's note" not in page and "Reviewed by" not in page  # kept from an organiser
    for spec in demo_module().INCIDENTS:
        assert spec["finding"] in page and spec["onField"] in page


def test_the_go_no_go_page_holds_everything_on_the_record():
    page = text_of(*FP, "go-no-go.md")
    signed = text_of(*FP, "residual-risks.md").split("## Sign-off")[1]
    before = re.findall(r"^\| (R\d+) \| fix before real footage", signed, flags=re.M)
    assert before
    for risk in [*before, "R7", "R11", "R20", "R21", "R23", "R25", "R26"]:
        assert re.search(rf"\b{risk}\b", page), risk
    for item in ("B2", "B5", "B9", "B10", "B10a", "B12", "RC1", "RC8", "F20", "F28", "gate 1"):
        assert item in page, item
    for target in ("99.5%", "15 s", "30 s", "500 ms", "30-minute", "three full shadow-review matches"):
        assert target in page, target
    assert "**No-go**" in page and "(Fola Sanni)" in page


def test_every_risk_still_unsigned_stays_unsigned():
    assert "Signed: ______________________ (Fola Sanni)" in text_of(*FP, "residual-risks.md")
    assert "**The decision is Fola's.**" in text_of(*FP, "go-no-go.md")


def test_the_release_notes_are_honest_about_the_release():
    page = text_of(*FP, "release-notes.md")
    assert "not released" in page and "**The cloud side is on the live server; nothing else is deployed.**" in page
    version = re.search(r'^version = "(.+)"', (EDGE / "pyproject.toml").read_text("utf-8"), flags=re.M)[1]
    assert f"## {version}:" in page
    migrations = [p.name for p in (REPO / "services" / "api" / "prisma" / "migrations").glob("*fairplay*")]
    assert migrations and all(m in page for m in migrations)
    for number in re.findall(r"pull/(\d+)", page):
        assert 302 <= int(number) <= 332, number


@pytest.mark.parametrize("name", ["go-no-go.md", "demo-walkthrough.md", "demo-report-draft.md", "release-notes.md"])
def test_its_links_point_at_what_is_there(name):
    page = text_of(*FP, name)
    for link, anchor in re.findall(r"\]\(\./([a-zA-Z0-9/_-]+\.md)(?:#([a-z0-9-]+))?\)", page):
        target = REPO.joinpath(*FP, link)
        assert target.exists(), link
        if anchor:
            heads = [re.sub(r"[^a-z0-9 -]", "", h.lower()).replace(" ", "-") for h in re.findall(r"^#+ (.+)$", target.read_text("utf-8"), flags=re.M)]
            assert anchor in heads, (link, anchor)
