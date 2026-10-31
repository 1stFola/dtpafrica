"""Phase 6.4: the checklist and its results sheet agree, and it names only what is there."""

import re
from pathlib import Path

import pytest

from fairplay_edge import __main__ as cli

REPO = Path(__file__).resolve().parents[3]
PAGE = REPO / "docs" / "fairplay" / "hardware-validation.md"
TARGETS = ("99.5%", "15 s", "30 s", "500 ms")


def page() -> str:
    if not PAGE.exists():
        pytest.skip("needs the repository's docs (run from the checkout, as CI does)")
    return PAGE.read_text(encoding="utf-8")


def test_every_check_is_on_the_results_sheet_and_every_sheet_row_is_a_check():
    text = page()
    body, _, sheet = text.partition("## Results sheet")
    checks = set(re.findall(r"^\| ([A-G]\d+) \|", body, flags=re.M))
    rows = set(re.findall(r"^ ([A-G]\d+) ", sheet, flags=re.M))
    assert checks and checks == rows, {"not on the sheet": checks - rows, "no such check": rows - checks}


def test_the_products_four_targets_are_there():
    text = page()
    section = text.split("## The targets", 1)[1].split("\n## ", 1)[0]
    for target in TARGETS:
        assert target in section.replace("**", ""), target
    assert section.count("| PID |") == 4


def test_a_threshold_of_mine_says_it_is_proposed():
    text = page()
    for check in ("B5", "B6", "B9", "C4", "C8", "D5", "D6"):
        row = re.search(rf"^\| {check} \|.*$", text, flags=re.M).group(0)
        assert "*(proposed)*" in row, check
        assert re.search(rf"^ {check} .*\*", text, flags=re.M), f"{check} on the sheet"


def test_every_field_it_reads_is_one_the_tool_writes():
    text, source = page(), (Path(cli.__file__).parent / "measure.py").read_text(encoding="utf-8")
    fields = {"recordedPercent", "gapCount", "partial", "mbitPerSecond", "gbPerHour", "codec", "profile", "width", "height", "fps",
              "keyframeIntervalS", "hasAudio", "alertsOpened"}
    for field in re.findall(r"`([a-zA-Z]+)`", text):
        if field in fields:
            assert f'"{field}"' in source, field
    assert "clips.p95Ms" in text and '"p95Ms"' in source and "replay.p95Ms" in text


def test_every_command_and_flag_it_gives_exists():
    text, source = page(), Path(cli.__file__).read_text(encoding="utf-8")
    for command in set(re.findall(r"fairplay-edge ([a-z][a-z-]+)", text)):
        assert f'add_parser("{command}"' in source, command
    script = (REPO / "services" / "fairplay-edge" / "deploy" / "measure.sh").read_text(encoding="utf-8")
    for flag in set(re.findall(r"--(?:load-minutes|since-minutes|disk-seconds)", text)):
        assert flag in script, flag
    for path in re.findall(r"\]\(\./([a-z0-9-]+\.md)", text):
        assert (PAGE.parent / path).exists(), path


def test_the_rules_hold():
    text = page()
    assert "None of this has been run" in text and "These are not results" in text
    assert "No footage of people without rights" in text and "Never\n  use a youth match" in text
    assert "Accepting it is Fola's" in text
