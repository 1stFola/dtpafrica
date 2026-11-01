"""Phase 6.5: the licence record says what is really there, and notices when that changes."""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from fairplay_edge import __main__ as cli
from fairplay_edge import licences, licences_reviewed as reviewed

EDGE = Path(__file__).resolve().parents[1]
REPO = Path(__file__).resolve().parents[3]
DEV_ONLY = {"iniconfig", "packaging", "pluggy", "pygments", "pytest"}  # constraints.txt, not in the image
BASE_IMAGE = {"pip"}  # comes with the pinned base image, not from constraints.txt

GPL = ("ffmpeg is free software; you can redistribute it and/or modify\nit under the terms of the GNU General Public License as "
       "published by\nthe Free Software Foundation; either version 2 of the License, or\n(at your option) any later version.\n")
LGPL = GPL.replace("General Public", "Lesser General Public").replace("version 2 ", "version 2.1 ")
VERSION = "ffmpeg version 7.1.5-0+deb13u1 Copyright (c) 2000-2026\nconfiguration: --prefix=/usr --enable-gpl --enable-libx264\n"


def clean() -> dict:
    return {"ffmpeg": licences.parse_ffmpeg(VERSION, GPL),
            "python": [{"name": n, "version": v, "licence": lic} for n, (v, lic) in reviewed.PYTHON.items()],
            "debian": [{"name": "ffmpeg", "version": "7:7.1.5", "section": "video"}],
            "mediamtx": reviewed.MEDIAMTX, "console": reviewed.CONSOLE}


def text_of(*parts: str) -> str:
    path = REPO.joinpath(*parts)
    if not path.exists():
        pytest.skip("needs the repository's docs (run from the checkout, as CI does)")
    return path.read_text(encoding="utf-8")


def test_it_reads_the_builds_own_account_of_itself():
    build = licences.parse_ffmpeg(VERSION, GPL)
    assert (build["version"], build["series"], build["licence"]) == ("7.1.5-0+deb13u1", "7.1", "GPL-2.0-or-later")
    assert "--enable-libx264" in build["configuration"]
    assert licences.parse_ffmpeg(VERSION, LGPL)["licence"].startswith("LGPL")
    assert licences.parse_ffmpeg("nonsense", "nonsense") == {"version": None, "series": None, "licence": "unknown", "configuration": []}


def test_an_image_as_reviewed_passes():
    assert licences.check(clean()) == []


@pytest.mark.parametrize("change, expected", [
    (lambda f: f.update(ffmpeg=None), "no ffmpeg"),
    (lambda f: f["ffmpeg"].update(licence="LGPL-2.1-or-later"), "reviewed as GPL-2.0-or-later"),
    (lambda f: f["ffmpeg"].update(series="8.0"), "reviewed as 7.1"),
    (lambda f: f["ffmpeg"]["configuration"].append("--enable-nonfree"), "--enable-nonfree"),
    (lambda f: f["python"].append({"name": "ultralytics", "version": "8", "licence": "AGPL-3.0"}), "ultralytics is installed but not reviewed"),
    (lambda f: f["python"][0].update(version="0"), "annotated-doc: 0"),
    (lambda f: f["python"][0].update(licence="AGPL-3.0"), "AGPL-3.0"),
    (lambda f: f["python"].pop(0), "annotated-doc is reviewed but not installed"),
    (lambda f: f["debian"].append({"name": "x", "version": "1", "section": "non-free/video"}), "Debian's non-free"),
    (lambda f: f["debian"].append({"name": "x", "version": "1", "section": "contrib/libs"}), "Debian's contrib"),
])
def test_it_notices_each_kind_of_difference(change, expected):
    found = clean()
    change(found)
    problems = licences.check(found)
    assert len(problems) == 1 and expected in problems[0]


def test_the_ffmpeg_here_is_the_reviewed_one():
    build = licences.ffmpeg_build()
    if build is None:
        pytest.skip("no ffmpeg here; the Edge image has it")
    assert (build["licence"], build["series"]) == (reviewed.FFMPEG["licence"], reviewed.FFMPEG["series"])
    assert "--enable-nonfree" not in build["configuration"]


def test_the_reviewed_list_is_what_the_image_installs():
    constraints = dict(line.split("==") for line in (EDGE / "constraints.txt").read_text("utf-8").split("\n") if "==" in line and not line.startswith("#"))
    pinned = {licences._name(name): version for name, version in constraints.items()}
    assert set(reviewed.PYTHON) - BASE_IMAGE == set(pinned) - DEV_ONLY
    for name, (version, _) in reviewed.PYTHON.items():
        if name not in BASE_IMAGE:
            assert pinned[name] == version, name


def test_mediamtx_is_the_image_compose_pins():
    compose = (EDGE / "compose.yaml").read_text("utf-8")
    assert f"bluenviron/mediamtx:{reviewed.MEDIAMTX['version']}@sha256:{reviewed.MEDIAMTX['digest']}" in compose
    assert len(reviewed.MEDIAMTX["modules"]) == 84 and all(licence for _, _, licence in reviewed.MEDIAMTX["modules"])


def test_what_the_pack_names_but_the_edge_does_not_use_is_absent():
    held = (EDGE / "pyproject.toml").read_text("utf-8") + text_of("apps", "fairplay-console", "package.json")
    assert not re.search(r"rclone|video\.js", held, flags=re.I)


def test_the_sbom_lists_every_part():
    found = clean()
    out = licences.sbom(found)
    assert out["bomFormat"] == "CycloneDX" and out["metadata"]["timestamp"].endswith("Z")
    names = {c["name"] for c in out["components"]}
    assert {"fastapi", "ffmpeg", "react", "bluenviron/mediamtx", "github.com/pion/webrtc/v4"} <= names
    assert len(out["components"]) == len(found["python"]) + 1 + 84 + len(reviewed.CONSOLE) + 1


def test_the_notices_hold_real_licence_texts():
    texts = list(licences.notices())
    assert texts and any("Permission is hereby granted" in t or "Redistribution and use" in t for t in texts)


def test_the_command_says_what_differs_and_exits_2(monkeypatch, capsys):
    monkeypatch.setattr(licences, "report", clean)
    assert cli.main(["licences", "--check"]) == 0
    assert json.loads((cli.main(["licences"]), capsys.readouterr().out)[1])["ffmpeg"]["series"] == "7.1"
    assert cli.main(["licences", "--sbom"]) == 0
    assert json.loads(capsys.readouterr().out)["bomFormat"] == "CycloneDX"
    monkeypatch.setattr(licences, "report", lambda: {**clean(), "ffmpeg": None})
    assert cli.main(["licences", "--check"]) == 2
    assert "no ffmpeg" in capsys.readouterr().err


def test_install_and_update_refuse_an_image_that_differs_before_starting_it():
    command = '--network none "dtp-fairplay-edge:$'
    check = 'licences --check ||'
    install = (EDGE / "deploy" / "install.sh").read_text("utf-8")
    assert install.index("docker compose build init") < install.index(command + 'TAG" ' + check) < install.index("docker compose up")
    update = (EDGE / "deploy" / "update.sh").read_text("utf-8")
    assert update.index("docker compose build init") < update.index(command + 'NEW_TAG" ' + check) < update.index("docker compose up -d --no-deps init")
    line = next(li for li in update.splitlines() if check in li)
    assert 'set_env .env FAIRPLAY_EDGE_TAG "$OLD_TAG"' in line


@pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")
def test_the_script_refuses_before_it_touches_anything(tmp_path):
    d = tmp_path / "fairplay-edge"
    d.mkdir()
    shutil.copytree(EDGE / "deploy", d / "deploy")

    def run(*args):
        return subprocess.run(["bash", "deploy/licences.sh", *args], cwd=d, capture_output=True, text=True)

    assert run().returncode == 2
    assert "no such folder" in run("no-such-folder").stderr
    assert "install first" in run(".").stderr


def test_the_script_never_reads_the_secrets():
    script = (EDGE / "deploy" / "licences.sh").read_text("utf-8")
    body = "\n".join(line for line in script.splitlines() if not line.startswith("#"))
    assert "publish.env" not in body and "auth/" not in body
    assert [line.strip() for line in body.splitlines() if ".env" in line] == ['[ -f .env ] || die "no .env here: install first (deploy/install.sh)" 2']


def test_the_notices_file_names_every_part_at_its_version():
    text = text_of("services", "fairplay-edge", "THIRD_PARTY_NOTICES.md")
    for name, (version, licence) in {**reviewed.PYTHON, **reviewed.CONSOLE}.items():
        assert f"| {name} | {version} | {licence} |" in text, name
    for module, version, licence in reviewed.MEDIAMTX["modules"]:
        assert f"| {module} | {version} | {licence} |" in text, module


def test_the_console_carries_its_notice():
    text = text_of("apps", "fairplay-console", "public", "third-party-notices.txt")
    for name, (version, _) in reviewed.CONSOLE.items():
        assert f"{name} {version}" in text
    assert "Copyright (c) Facebook, Inc. and its affiliates." in text and "Permission is hereby granted" in text


def test_the_register_and_the_review_agree_and_leave_the_ruling_to_fola():
    section = text_of("docs", "licenses", "OSS_REGISTER.md").split("## FairPlay Edge (venue service)")[1].split("\n---")[0]
    for name in set(reviewed.PYTHON) - BASE_IMAGE:
        assert re.search(name.replace("-", "[-_ ]?"), section, flags=re.I), name
    assert "7.1.5" in section and "benburkert/openpgp" in section
    page = text_of("docs", "fairplay", "licences.md")
    assert "These rulings are Fola's" in page and "not legal advice" in page and "benburkert/openpgp" in page
    for link in re.findall(r"\]\(\./([a-z0-9-]+\.md)", page):
        assert (REPO / "docs" / "fairplay" / link).exists(), link
