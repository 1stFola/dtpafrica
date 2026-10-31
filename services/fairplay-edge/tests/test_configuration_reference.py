"""Phase 6.1: docs/fairplay/edge-configuration.md lists every setting the Edge, Compose or an
example file reads, and nothing that nothing reads."""

import re
from pathlib import Path

import pytest

EDGE = Path(__file__).resolve().parents[1]
REFERENCE = Path(__file__).resolve().parents[3] / "docs" / "fairplay" / "edge-configuration.md"
NAME = re.compile(r"FAIRPLAY_[A-Z0-9_]+")
# Read only by the end-to-end test, which its driver sets.
TEST_ONLY = re.compile(r"FAIRPLAY_E2E_")


def per_source(name: str) -> str:
    return "FAIRPLAY_PUBLISH_PASSWORD_<SOURCE>" if name.startswith("FAIRPLAY_PUBLISH_PASSWORD_") else name


def read_somewhere() -> dict[str, set[str]]:
    code = {n for p in (EDGE / "fairplay_edge").glob("*.py") for n in re.findall(r'"(FAIRPLAY_[A-Z0-9_]+)"', p.read_text("utf-8"))}
    code.add("FAIRPLAY_PUBLISH_PASSWORD_<SOURCE>")  # Source.password_env builds the name
    # The venue stack; compose.drills.yaml and compose.storage.yaml are test overlays.
    compose = set(NAME.findall((EDGE / "compose.yaml").read_text("utf-8")))
    examples = {per_source(n) for p in (EDGE / ".env.example", EDGE / "publish.env.example")
                for n in re.findall(r"^#? ?(FAIRPLAY_[A-Z0-9_]+)=", p.read_text("utf-8"), re.M)}
    return {"code": {n for n in code if not TEST_ONLY.match(n)}, "compose": compose, "examples": examples}


def documented() -> set[str]:
    if not REFERENCE.exists():
        pytest.skip("needs the repository's docs (run from the checkout, as CI does)")
    return set(re.findall(r"^\| `(FAIRPLAY_[A-Z0-9_<>]+)` \|", REFERENCE.read_text("utf-8"), re.M))


def test_every_setting_read_anywhere_is_documented():
    docs = documented()
    for where, names in read_somewhere().items():
        assert names <= docs, f"read by {where} but not in edge-configuration.md: {sorted(names - docs)}"


def test_every_documented_setting_is_read_somewhere():
    docs = documented()
    used = set().union(*read_somewhere().values())
    assert docs <= used, f"in edge-configuration.md but read nowhere: {sorted(docs - used)}"


def test_every_setting_an_operator_sets_is_in_an_example():
    """What `.env` or `publish.env` holds must be in their examples, so the installer writes it."""
    if not REFERENCE.exists():
        pytest.skip("needs the repository's docs")
    text = REFERENCE.read_text("utf-8")
    operator = set(re.findall(r"^\| `(FAIRPLAY_[A-Z0-9_<>]+)` \|[^\n]*\| `(?:\.env|publish\.env)`", text, re.M))
    missing = operator - read_somewhere()["examples"]
    assert not missing, f"set in .env or publish.env but missing from the examples: {sorted(missing)}"
