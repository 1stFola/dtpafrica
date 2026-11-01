"""What the Edge is made of, read from the image it runs in (Phase 6.5; docs/fairplay/licences.md).

`report` lists the Python and Debian packages and FFmpeg's build as they are on this machine,
with the parts that cannot be read from here (MediaMTX's own image, the console's bundle) taken
from the reviewed list. `check` compares what is here with that list: the image takes whatever
Debian ships, so nobody here chooses FFmpeg's flags, and this is what notices if they change.
`sbom` is the same report as CycloneDX. `notices` prints every licence text this image holds.
Nothing here clears anything: a row is cleared in the register, by Fola.
"""

from __future__ import annotations

import importlib.metadata as metadata
import os
import re
import subprocess
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path

from . import __version__
from . import licences_reviewed as reviewed
from .naming import iso

SELF = "dtp-fairplay-edge"
DOCS = Path("/usr/share/doc")


def _name(raw: str) -> str:
    return re.sub(r"[-_.]+", "-", raw).lower()


def licence_of(dist: metadata.Distribution) -> str | None:
    md = dist.metadata
    return md.get("License-Expression") or (md.get("License") or "").strip() or None


def python_packages() -> list[dict]:
    seen: dict[str, dict] = {}
    for dist in metadata.distributions():
        name = _name(dist.metadata["Name"])
        if name != SELF:
            seen[name] = {"name": name, "version": dist.version, "licence": licence_of(dist)}
    return [seen[k] for k in sorted(seen)]


def debian_packages() -> list[dict]:
    try:
        out = subprocess.run(["dpkg-query", "-W", "-f", "${Package}\t${Version}\t${Section}\n"],
                             capture_output=True, text=True, check=True, timeout=60).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    rows = (line.split("\t") for line in out.splitlines() if line)
    return [{"name": n, "version": v, "section": s} for n, v, s in sorted(rows)]


def ffmpeg_build() -> dict | None:
    """The build's own account of itself; None when this machine has no ffmpeg."""
    try:
        version = subprocess.run(["ffmpeg", "-hide_banner", "-version"], capture_output=True, text=True, check=True, timeout=30).stdout
        licence = subprocess.run(["ffmpeg", "-hide_banner", "-L"], capture_output=True, text=True, check=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return parse_ffmpeg(version, licence)


def parse_ffmpeg(version: str, licence: str) -> dict:
    words = " ".join(licence.split())
    number = re.search(r"ffmpeg version (\S+)", version)
    flags = re.search(r"^configuration: (.*)$", version, flags=re.M)
    if "GNU Lesser General Public License" in words:
        kind = "LGPL"
    elif "GNU General Public License" in words:
        kind = "GPL"
    else:
        kind = "unknown"
    later = re.search(r"either version (\d+)[^.]*or \(at your option\) any later version", words)
    return {
        "version": number.group(1) if number else None,
        "series": ".".join(number.group(1).split(".")[:2]) if number else None,
        "licence": f"{kind}-{later.group(1)}.0-or-later" if later else kind,
        "configuration": flags.group(1).split() if flags else [],
    }


def report() -> dict:
    return {
        "python": python_packages(),
        "debian": debian_packages(),
        "ffmpeg": ffmpeg_build(),
        "mediamtx": reviewed.MEDIAMTX,
        "console": reviewed.CONSOLE,
    }


def check(found: dict) -> list[str]:
    """Each way this image differs from the reviewed list; empty when it does not."""
    problems = []
    build = found["ffmpeg"]
    want = reviewed.FFMPEG
    if build is None:
        problems.append("no ffmpeg in this image")
    else:
        if build["licence"] != want["licence"]:
            problems.append(f"ffmpeg reports {build['licence']}, reviewed as {want['licence']}")
        if build["series"] != want["series"]:
            problems.append(f"ffmpeg is {build['series']}, reviewed as {want['series']}")
        if "--enable-nonfree" in build["configuration"]:
            problems.append("ffmpeg was built with --enable-nonfree")
    here = {p["name"]: p for p in found["python"]}
    for name, (version, licence) in reviewed.PYTHON.items():
        if name not in here:
            problems.append(f"{name} is reviewed but not installed")
        elif here[name]["version"] != version or here[name]["licence"] != licence:
            problems.append(f"{name}: {here[name]['version']}, {here[name]['licence']}; reviewed as {version}, {licence}")
    problems += [f"{name} is installed but not reviewed" for name in here if name not in reviewed.PYTHON]
    problems += [f"{p['name']} comes from Debian's {p['section'].split('/')[0]}" for p in found["debian"]
                 if p["section"].startswith(("non-free", "contrib"))]
    return problems


def _component(kind: str, name: str, version: str, licence: str | None) -> dict:
    out = {"type": "library", "name": name, "version": version, "purl": f"pkg:{kind}/{name}@{version}"}
    if licence:
        out["licenses"] = [{"license": {"name": licence}}]
    return out


def sbom(found: dict) -> dict:
    parts = [_component("pypi", p["name"], p["version"], p["licence"]) for p in found["python"]]
    parts += [_component("deb/debian", p["name"], p["version"], None) for p in found["debian"]]  # its copyright file says
    parts += [_component("golang", m, v, licence) for m, v, licence in found["mediamtx"]["modules"]]
    parts += [_component("npm", n, v, licence) for n, (v, licence) in found["console"].items()]
    media = found["mediamtx"]
    parts.append({"type": "container", "name": "bluenviron/mediamtx", "version": media["version"],
                  "hashes": [{"alg": "SHA-256", "content": media["digest"]}],
                  "licenses": [{"license": {"id": media["licence"]}}]})
    return {"bomFormat": "CycloneDX", "specVersion": "1.5", "version": 1,
            "metadata": {"timestamp": iso(datetime.now(timezone.utc)),
                         "component": {"type": "application", "name": SELF, "version": __version__}},
            "components": parts}


def notices() -> Iterator[str]:
    """Every licence text this image holds, Python packages first, then Debian's."""
    for dist in sorted(metadata.distributions(), key=lambda d: _name(d.metadata["Name"])):
        for file in dist.files or []:
            if re.search(r"licen[cs]e|copying|notice", str(file), flags=re.I) and file.suffix not in (".py", ".pyc"):
                path = Path(str(dist.locate_file(file)))
                if path.is_file():
                    yield f"\n===== {_name(dist.metadata['Name'])} {dist.version}: {file.name}\n{path.read_text('utf-8', 'replace')}"
    for package in debian_packages():
        path = DOCS / package["name"].split(":")[0] / "copyright"
        if os.path.exists(path):
            yield f"\n===== Debian {package['name']} {package['version']}\n{path.read_text('utf-8', 'replace')}"
        else:
            yield f"\n===== Debian {package['name']} {package['version']}: no copyright file in this image\n"
