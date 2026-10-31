"""Phase 5.8: the runbook (docs/fairplay/runbook.md) names every alert the Edge can raise,
and how each clears; the alerts that wait for a person can be acknowledged by an Edge admin
(F25), and a new one of the same kind opens after that."""

import re
from pathlib import Path

import pytest

from fairplay_edge.api import ACKNOWLEDGED_ALERTS

from .conftest import at, fmp4, write_segment
from .test_phase3_api import CSRF, clients, service  # noqa: F401  (fixtures)

EDGE = Path(__file__).resolve().parents[1] / "fairplay_edge"
RUNBOOK = Path(__file__).resolve().parents[3] / "docs" / "fairplay" / "runbook.md"
# The kinds built from a segment's state at run time: manifest.finalise (partial, corrupt)
# and manifest.verify (missing, mismatch).
COMPUTED = {"segment_partial", "segment_corrupt", "segment_missing", "segment_mismatch"}


def alert_kinds() -> set[str]:
    source = "\n".join(p.read_text(encoding="utf-8") for p in EDGE.glob("*.py"))
    literal = set(re.findall(r'open_alert\(\s*"([a-z_]+)"', source))
    computed = re.findall(r'open_alert\(\s*f"', source)
    assert len(computed) == 2, "a new alert kind built at run time: add its values to COMPUTED and the runbook"
    return literal | COMPUTED


def runbook_rows() -> dict[str, str]:
    if not RUNBOOK.exists():
        pytest.skip("needs the repository's docs (run from the checkout, as CI does)")
    rows = {}
    text = RUNBOOK.read_text(encoding="utf-8")
    section = text.split("## The Edge's alerts", 1)[1].split("\n## ", 1)[0]
    for line in section.splitlines():
        m = re.match(r"\| `([a-z_]+)` \|", line)
        if m:
            rows[m.group(1)] = line
    return rows


def test_every_alert_the_edge_raises_is_in_the_runbook_with_how_it_clears():
    rows = runbook_rows()
    assert alert_kinds() == set(rows), {"undocumented": alert_kinds() - set(rows), "no such alert": set(rows) - alert_kinds()}
    for kind, row in rows.items():
        clears = row.rstrip(" |").rsplit("|", 1)[-1].strip()
        waits = kind in ACKNOWLEDGED_ALERTS
        assert ("an Edge admin" in clears) == waits, (kind, clears)
        assert waits or clears.startswith("by itself"), (kind, clears)


def test_a_partial_file_is_acknowledged_once_dealt_with_and_the_next_one_alerts_again(clients, service):  # noqa: F811
    admin = clients["admin"]

    def partial(seconds):
        write_segment(service.settings.recordings_dir, "ground", at(seconds), fmp4(3, dangling_moof=True, truncate_last=4))
        write_segment(service.settings.recordings_dir, "ground", at(seconds + 5), fmp4(1))
        service.run_once()
        return [a for a in admin.get("/edge/v1/alerts").json() if a["kind"] == "segment_partial"]

    first = partial(100)
    assert len(first) == 1 and admin.get("/edge/v1/health").json()["status"] in ("degraded", "critical")
    assert len(partial(200)) == 1  # a second partial file adds no second open alert
    path = f"/edge/v1/alerts/{first[0]['id']}/acknowledge"
    assert clients["operator"].post(path, headers=CSRF, json={"reason": "repaired"}).status_code == 403
    r = admin.post(path, headers=CSRF, json={"reason": "repaired; the drop is noted on the incident"})
    assert r.status_code == 200 and r.json()["resolved_utc"]
    entry = service.store.one("SELECT * FROM audit_log WHERE action = 'alert.acknowledged'")
    assert '"kind":"segment_partial"' in entry["detail"] and entry["actor_id"] == "u-admin"
    assert partial(300)[0]["id"] != first[0]["id"]  # the next one is raised


def test_a_condition_cannot_be_acknowledged_away(clients, service):  # noqa: F811
    service.mediamtx.down = True
    service.run_once()
    down = next(a for a in clients["admin"].get("/edge/v1/alerts").json() if a["kind"] == "media_server_down")
    r = clients["admin"].post(f"/edge/v1/alerts/{down['id']}/acknowledge", headers=CSRF, json={"reason": "known"})
    assert r.status_code == 409 and r.json()["error"] == "not_acknowledgeable"
