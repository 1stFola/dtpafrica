from dataclasses import replace
from datetime import timedelta

import pytest

from fairplay_edge import mp4, retention
from fairplay_edge.manifest import Scanner
from fairplay_edge.probe import sha256_file
from fairplay_edge.repair import RepairRefused, repair
from fairplay_edge.store import new_id

from .conftest import T0, at, fmp4, write_segment

NOW = T0 + timedelta(days=40)


@pytest.fixture
def three_final(settings, store, fake_probe):
    """Three finalised ground segments at t=0, 300, 600 s, and an open one at 900 s."""
    paths = [write_segment(settings.recordings_dir, "ground", at(t), fmp4(2)) for t in (0, 300, 600, 900)]
    Scanner(settings, store).scan({"ground": True})
    rows = store.query("SELECT id, rel_path, state FROM segments ORDER BY start_utc")
    assert [r["state"] for r in rows] == ["finalized", "finalized", "finalized", "recording"]
    return paths, rows


def test_retention_is_off_by_default(settings, store, three_final):
    assert retention.apply(settings, store, Scanner(settings, store), now=NOW) == []


def test_plan_never_includes_an_open_segment(store, three_final):
    _, rows = three_final
    ids = {r["id"] for r in retention.plan(store, 30, NOW)}
    assert rows[3]["id"] not in ids and len(ids) == 3


def test_hold_protects_overlapping_segments(store, three_final):
    _, rows = three_final
    # The fake probe makes each segment 10 s long: the second one covers [300 s, 310 s).
    retention.create_hold(store, "ground", at(305), at(306), "incident", "inc-1")
    ids = {r["id"] for r in retention.plan(store, 30, NOW)}
    assert rows[1]["id"] not in ids and {rows[0]["id"], rows[2]["id"]} <= ids


def test_hold_touching_a_segment_edge_does_not_protect_it(store, three_final):
    _, rows = three_final
    retention.create_hold(store, "ground", at(310), at(320), "incident", "inc-1")  # starts where it ends
    assert rows[1]["id"] in {r["id"] for r in retention.plan(store, 30, NOW)}


def test_hold_without_source_protects_every_source(store, three_final):
    retention.create_hold(store, None, at(-10), at(10_000), "manual", None)
    assert retention.plan(store, 30, NOW) == []


def test_released_hold_no_longer_protects(store, three_final):
    hold = retention.create_hold(store, None, at(-10), at(10_000), "manual", None)
    retention.release_hold(store, hold["id"], "incident closed")
    assert len(retention.plan(store, 30, NOW)) == 3


def test_unsynced_evidence_protects_its_segment(store, three_final):
    _, rows = three_final
    with store.tx() as db:
        db.execute("INSERT INTO evidence_refs (id, segment_id, synced, created_utc) VALUES (?, ?, 0, ?)",
                   (new_id(), rows[0]["id"], "2026-10-27T15:00:00.000Z"))
    assert rows[0]["id"] not in {r["id"] for r in retention.plan(store, 30, NOW)}


def test_apply_deletes_files_keeps_manifest_and_is_bounded(settings, store, three_final):
    paths, rows = three_final
    s = replace(settings, retention_days=30, retention_max_deletions=2)
    deleted = retention.apply(s, store, Scanner(s, store), now=NOW)
    assert [d["id"] for d in deleted] == [rows[0]["id"], rows[1]["id"]]
    assert not paths[0].exists() and not paths[1].exists() and paths[2].exists()
    row = store.one("SELECT state, sha256, deleted_utc FROM segments WHERE id = ?", (rows[0]["id"],))
    assert row["state"] == "deleted" and row["sha256"] and row["deleted_utc"]
    assert (settings.manifests_dir / "ground").exists()


def test_hold_added_after_planning_still_wins(settings, store, three_final, monkeypatch):
    paths, rows = three_final
    s = replace(settings, retention_days=30)
    stale_plan = retention.plan(store, 30, NOW)
    retention.create_hold(store, "ground", at(0), at(1), "incident", "late")
    monkeypatch.setattr(retention, "plan", lambda *a, **k: stale_plan)
    deleted = retention.apply(s, store, Scanner(s, store), now=NOW)
    assert rows[0]["id"] not in {d["id"] for d in deleted} and paths[0].exists()


def test_bad_holds_are_refused(store):
    with pytest.raises(ValueError):
        retention.create_hold(store, None, at(10), at(5), "manual", None)
    with pytest.raises(ValueError):
        retention.create_hold(store, None, at(0), at(5), "because", None)
    with pytest.raises(ValueError):
        retention.release_hold(store, "x", "  ")


# ── repair ────────────────────────────────────────────────────────────────

def _partial(settings, store):
    original = write_segment(settings.recordings_dir, "ground", at(0), fmp4(4, truncate_last=30))
    write_segment(settings.recordings_dir, "ground", at(300), fmp4(1))
    scanner = Scanner(settings, store)
    scanner.scan({"ground": True})
    row = store.one("SELECT * FROM segments WHERE state = 'partial'")
    return original, scanner, row


def test_repair_writes_a_whole_derivative_and_leaves_the_original(settings, store, fake_probe):
    original, scanner, row = _partial(settings, store)
    before = original.read_bytes()
    result = repair(settings, store, scanner, row["id"])
    assert original.read_bytes() == before
    assert store.one("SELECT state FROM segments WHERE id = ?", (row["id"],))["state"] == "partial"
    out = settings.repaired_dir / result["rel_path"]
    assert mp4.inspect(out).is_complete
    assert result["sha256"] == sha256_file(out) != row["sha256"]
    assert result["lost_bytes"] == row["bytes"] - row["complete_bytes"] > 0
    assert scanner.manifest_for(row["id"])["derivatives"][0]["id"] == result["id"]


def test_repair_refuses_a_finalized_segment(settings, store, fake_probe, three_final):
    _, rows = three_final
    with pytest.raises(RepairRefused, match="only a partial"):
        repair(settings, store, Scanner(settings, store), rows[0]["id"])


def test_repair_refuses_if_the_original_changed(settings, store, fake_probe):
    original, scanner, row = _partial(settings, store)
    original.chmod(0o644)
    original.write_bytes(original.read_bytes() + b"\x00")
    with pytest.raises(RepairRefused, match="no longer matches"):
        repair(settings, store, scanner, row["id"])
