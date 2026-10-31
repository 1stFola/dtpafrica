"""Phase 6.3: the operator guide names only what is really there. An operator reading it at a
venue cannot stop to find out that a button was renamed."""

import re
from pathlib import Path

import pytest

from fairplay_edge import __main__ as cli

REPO = Path(__file__).resolve().parents[3]
GUIDE = REPO / "docs" / "fairplay" / "operator-guide.md"
UI = [*(REPO / "apps" / "fairplay-console" / "src").glob("*.ts*"), *(REPO / "apps" / "web" / "src" / "modules" / "admin" / "fairplay").glob("*.ts*")]
# Bold words in the guide that are not on a screen: the guide's own emphasis and table labels.
NOT_LABELS = {
    "FairPlay never reaches the match.", "It is not VAR.", "No matches with minors,", "Clips do not go to the public or to WhatsApp.",
    "Someone is watching.", "Status.", "Once for each machine (Edge admin).", "Once for each match (session lead).", "Rights (Edge admin).",
    "Disk", "Clock", "Cloud", "Match", "Edge", "every", "A wrong press.", "Flag an incident.", "Replay.", "Turn off the cameras.",
    "Flag anything you still mean to flag.", "Request clips.", "Review (assessor).", "Release (releaser).", "Archive (assessor).", "Sync.",
    "Report (session lead).", "Back up (Edge admin).", "A dispute?", "Shut down (Edge admin).", "Never run `docker compose down -v`: it deletes every\n    recording.",
    "First, keep recording, and don't go near the match.", "Freeing space (Edge admin).", "Never delete anything from the recordings folder by hand.",
    "With no real cameras.", "With DEV credentials,", "Run the whole of this guide:", "Write down", "Assessors,", "Edge admins and releasers,",
    "Not walked:", "after", "Press End session",
}


# Labels the console builds at run time, and the template each comes from.
COMPUTED = {"Edge ok": "Edge {health?.status", "Make ground clip": "Make {s} clip", "Make drone clip": "Make {s} clip"}


def guide() -> str:
    if not GUIDE.exists():
        pytest.skip("needs the repository's docs and apps (run from the checkout, as CI does)")
    return GUIDE.read_text(encoding="utf-8")


def source() -> str:
    if not UI:
        pytest.skip("needs the repository's apps (run from the checkout, as CI does)")
    # The two ways JSX and strings break a label across lines do not change it.
    return re.sub(r"\s+", " ", "\n".join(p.read_text(encoding="utf-8") for p in UI))


def test_every_button_and_label_the_guide_names_is_on_a_screen():
    text, ui = guide(), source()
    labels = {re.sub(r"\s+", " ", m) for m in re.findall(r"\*\*(.+?)\*\*", text, flags=re.S)} - {re.sub(r"\s+", " ", n) for n in NOT_LABELS}
    assert labels, "the guide names no labels?"
    missing = sorted(label for label in labels if COMPUTED.get(label, label) not in ui)
    assert not missing, f"named in the guide, on no screen: {missing}"


QUOTED = ["Operator list valid until", "No feed from this camera", "Nobody can sign in", "This Edge's cloud token has expired", "Unavailable — no feed",
          "Connected, NOT recording", "Recorder unreachable", "Publishing from a new address", "reconnected after it was calibrated",
          "ended mid-write", "An evidence clip no longer matches its hash", "A recording file no longer matches its hash",
          "This Edge was restored from a backup", "the session has ended", "not set: cannot sign in", "not uploaded yet"]


def test_the_words_the_guide_quotes_are_the_consoles_own():
    text, ui = guide(), source()
    edge = (REPO / "services" / "fairplay-edge" / "fairplay_edge" / "timing.py").read_text(encoding="utf-8")
    for words in QUOTED:
        assert words.lower() in text.lower(), f"no longer quoted in the guide: {words}"
        assert words in ui or words in edge, f"no longer said by the console: {words}"


def test_every_edge_command_the_guide_gives_exists():
    commands = set(re.findall(r"fairplay-edge (\S+)", guide().replace("`", " "))) - {"api"}
    source_text = Path(cli.__file__).read_text(encoding="utf-8")
    assert commands, "the guide gives no commands?"
    for command in commands:
        assert f'add_parser("{command}"' in source_text, command


def test_every_deploy_script_the_guide_runs_exists_and_every_section_it_links_to_is_there():
    text = guide()
    for script in re.findall(r"deploy/[a-z.]+", text):
        assert (REPO / "services" / "fairplay-edge" / script).exists(), script
    headings = {re.sub(r"[^a-z0-9 -]", "", h.lower()).replace(" ", "-") for h in re.findall(r"^#+ (.+)$", text, flags=re.M)}
    for anchor in re.findall(r"\]\(#([a-z0-9-]+)\)", text):
        assert anchor in headings, anchor
    runbook = (GUIDE.parent / "runbook.md").read_text(encoding="utf-8")
    assert "## Recovery time and recovery point" in runbook and "## The Edge's alerts" in runbook


def test_the_rules_are_there():
    text = guide()
    for rule in ("FairPlay never reaches the match", "not FIFA-authorised VAR or FVS", "No matches with minors", "docker compose down -v"):
        assert rule in text, rule
