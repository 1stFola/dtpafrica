"""Phase 6.2: a backup comes back whole on a clean machine, a damaged one is refused before
anything changes, and a clip withdrawn since the backup was taken does not come back."""

import dataclasses
import io
import json
import sqlite3
import tarfile
from pathlib import Path

import pytest

from fairplay_edge import audit, backup, cloud, evidence
from fairplay_edge.store import SCHEMA_VERSION, Store

from .test_phase3_api import CSRF, clients, service, session_id, to_reviewed  # noqa: F401  (fixtures)
from .test_withdrawals import FakeCloud as ConfirmedOnly, released, withdraw  # noqa: F401  (fixtures)


class FakeCloud(ConfirmedOnly):
    """As the cloud answers: unconfirmed withdrawals, or with `every` all of them."""

    def __init__(self, items):
        super().__init__(items)
        self.asked_for_every = None

    def withdrawals(self, every=False):
        self.asked_for_every = every
        return self.items if every else [i for i in self.items if not i.get("edgeConfirmed")]


def clean_machine(settings, tmp_path: Path, name: str = "clean"):
    root = tmp_path / name
    (root / "data").mkdir(parents=True)
    (root / "recordings").mkdir()
    return dataclasses.replace(settings, data_dir=root / "data", recordings_dir=root / "recordings")


def backup_of(settings) -> bytes:
    out = io.BytesIO()
    backup.create(settings, out)
    return out.getvalue()


def rebuilt(archive: bytes, change) -> bytes:
    """The archive with `change(name, data)` applied to each file; None drops the file."""
    out = io.BytesIO()
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as src, tarfile.open(fileobj=out, mode="w:gz") as dst:
        for member in src:
            data = change(member.name, src.extractfile(member).read())
            if data is not None:
                member.size = len(data)
                dst.addfile(member, io.BytesIO(data))
    return out.getvalue()


def relisted(archive: bytes, **changes) -> bytes:
    def change(name, data):
        return json.dumps({**json.loads(data), **changes}).encode() if name == backup.LISTING else data
    return rebuilt(archive, change)


def test_a_backup_restores_whole_on_a_clean_machine(service, released, tmp_path):
    s, settings = service.store, service.settings
    (settings.data_dir / "tls").mkdir(exist_ok=True)
    (settings.data_dir / "tls" / "server-key.pem").write_text("key")
    (settings.data_dir / "bundle.json").write_text("{}")
    target = clean_machine(settings, tmp_path)
    result = backup.restore(target, io.BytesIO(backup_of(settings)))
    assert result["ok"] and result["auditChain"]["ok"], result
    assert result["counts"]["evidence"] == 1 and not result["withdrawalsChecked"]
    assert result["recordingsNotHere"] == result["recordingsListed"]  # counted, and said; a backup does not hold them
    assert evidence.path_of(target, released).read_bytes() == evidence.path_of(settings, released).read_bytes()
    assert (target.data_dir / "tls" / "server-key.pem").stat().st_mode & 0o077 == 0
    assert (target.data_dir / "bundle.json").exists()
    assert not (evidence.path_of(target, released).stat().st_mode & 0o222)  # read-only, as cut
    copy = Store(target.db_path)
    assert copy.device_id == s.device_id
    entries = copy.query("SELECT action FROM audit_log ORDER BY seq")
    assert entries[-1]["action"] == "edge.restored" and audit.verify(copy)["ok"]


def test_a_backup_holds_the_record_and_not_the_rest(service, released):
    settings = service.settings
    for rel in ("repaired/a.mp4", "backups/edge-old.sqlite3"):
        (settings.data_dir / rel).parent.mkdir(exist_ok=True)
        (settings.data_dir / rel).write_text("x")
    with tarfile.open(fileobj=io.BytesIO(backup_of(settings)), mode="r:gz") as tar:
        names = tar.getnames()
    assert backup.DATABASE in names and f"evidence/{released['rel_path']}" in names and f"evidence/{released['manifest_rel_path']}" in names
    assert not [n for n in names if n.startswith(("repaired/", "backups/", "exports/")) or n.endswith(("-wal", "-shm"))]
    assert not [n for n in names if n.endswith(".mp4") and not n.startswith("evidence/")]  # no recordings


def test_a_backup_is_consistent_while_the_edge_is_writing_and_the_list_matches_the_archive(service, released, tmp_path):
    s = service.store
    uncommitted = sqlite3.connect(service.settings.db_path)
    uncommitted.execute("BEGIN IMMEDIATE")
    uncommitted.execute("UPDATE audit_log SET actor_name = actor_name WHERE 0")
    try:
        archive = backup_of(service.settings)
    finally:
        uncommitted.rollback()
        uncommitted.close()
    assert backup.restore(clean_machine(service.settings, tmp_path), io.BytesIO(archive))["ok"]
    assert audit.verify(s)["ok"]


@pytest.mark.parametrize("damage, says", [
    (lambda a: rebuilt(a, lambda n, d: b"\0" + d if n.startswith("evidence/") and n.endswith(".mp4") else d), "does not match"),
    (lambda a: rebuilt(a, lambda n, d: None if n.startswith("evidence/") and n.endswith(".mp4") else d), "differ from its list"),
    (lambda a: rebuilt(a, lambda n, d: None if n == backup.LISTING else d), "no readable"),
    (lambda a: relisted(a, schema="something/else"), "not a FairPlay Edge backup"),
    (lambda a: relisted(a, schemaVersion=SCHEMA_VERSION + 1), "newer than this Edge"),
    (lambda a: a[: len(a) // 2], "cannot be read"),
    (lambda a: b"not a backup at all", "cannot be read"),
])
def test_a_damaged_backup_is_refused_and_nothing_changes(service, released, tmp_path, damage, says):
    target = clean_machine(service.settings, tmp_path)
    marker = target.data_dir / "bundle.json"
    marker.write_text("mine")
    with pytest.raises(backup.RestoreRefused, match=says):
        backup.restore(target, io.BytesIO(damage(backup_of(service.settings))))
    assert sorted(p.name for p in target.data_dir.iterdir()) == ["bundle.json"] and marker.read_text() == "mine"


def test_a_backup_cannot_write_outside_the_data_folder(service, tmp_path):
    target = clean_machine(service.settings, tmp_path)
    for name in ("../escaped.txt", "/tmp/fp-escaped.txt"):
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode="w:gz") as tar:
            info = tarfile.TarInfo(name)
            info.size = 2
            tar.addfile(info, io.BytesIO(b"hi"))
        with pytest.raises(backup.RestoreRefused):
            backup.restore(target, io.BytesIO(out.getvalue()))
    assert not (target.data_dir.parent / "escaped.txt").exists() and not Path("/tmp/fp-escaped.txt").exists()
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz") as tar:
        link = tarfile.TarInfo("evidence")
        link.type, link.linkname = tarfile.SYMTYPE, "/etc"
        tar.addfile(link)
    with pytest.raises(backup.RestoreRefused, match="not a regular file"):
        backup.restore(target, io.BytesIO(out.getvalue()))


def test_it_will_not_replace_a_record_unless_told_and_then_sets_it_aside(service, released, tmp_path):
    settings = service.settings
    archive = backup_of(settings)
    target = clean_machine(settings, tmp_path)
    backup.restore(target, io.BytesIO(archive))
    Store(target.db_path)
    with pytest.raises(backup.RestoreRefused, match="already holds a record"):
        backup.restore(target, io.BytesIO(archive))
    result = backup.restore(target, io.BytesIO(archive), replace=True)
    aside = Path(result["setAside"])
    assert (aside / backup.DATABASE).exists() and (aside / "evidence" / released["rel_path"]).exists()
    assert result["ok"] and evidence.path_of(target, released).exists()


def test_a_new_install_already_recording_is_still_a_clean_machine(service, released, tmp_path):
    archive = backup_of(service.settings)
    target = clean_machine(service.settings, tmp_path)
    Store(target.db_path)
    db = sqlite3.connect(target.db_path)
    db.execute("PRAGMA ignore_check_constraints = ON")
    columns = [r[1] for r in db.execute("PRAGMA table_info(segments)")]
    src = sqlite3.connect(service.settings.db_path)
    src.row_factory = sqlite3.Row
    seg = dict(src.execute("SELECT * FROM segments LIMIT 1").fetchone())
    src.close()
    db.execute(f"INSERT INTO segments ({','.join(columns)}) VALUES ({','.join('?' * len(columns))})", [seg[c] for c in columns])
    db.commit()
    db.close()
    assert backup.restore(target, io.BytesIO(archive))["ok"]


def item_for(row, **more):
    return {"id": "8c0b2b7e-2f0e-4d5e-9d8b-7b1d1f2c3a4b", "evidenceId": row["id"], "reason": "parent's request (ticket 17)",
            "requester": "J. Doe (parent_or_guardian)", "requestId": "r-1", "clipSha256": row["sha256"], "origin": "cloud",
            "edgeConfirmed": True, **more}


def test_a_clip_withdrawn_since_the_backup_stays_withdrawn(service, released, tmp_path):
    """The hole this guards: the cloud has its confirmation, so it would never ask again."""
    settings = service.settings
    target = clean_machine(settings, tmp_path)
    backup.restore(target, io.BytesIO(backup_of(settings)))
    store = Store(target.db_path)
    clip = evidence.path_of(target, released)
    assert clip.exists() and evidence.restore_unchecked(target)
    assert store.one("SELECT 1 FROM alerts WHERE kind = 'restore_unchecked' AND resolved_utc IS NULL")

    # Until the cloud has answered, nothing leaves: not the clip, an export, an approval or an upload.
    row = evidence.get(store, released["id"])
    with pytest.raises(evidence.ClipFailed) as refused:
        evidence.verify_file(store, target, row)
    assert refused.value.code == "restore_unchecked"
    assert backup.verify(target)["withdrawalsChecked"] is False

    fake = FakeCloud([item_for(released)])
    assert cloud.apply_withdrawals(target, store, fake) == [fake.items[0]["id"]]
    assert fake.asked_for_every is True
    assert not clip.exists() and evidence.withdrawal_of(store, released["id"])["id"] == fake.items[0]["id"]
    assert not evidence.restore_unchecked(target)
    assert not store.one("SELECT 1 FROM alerts WHERE kind = 'restore_unchecked' AND resolved_utc IS NULL")
    # The cloud holds its confirmation: a second one, with another time on it, would be a conflict.
    assert store.query("SELECT 1 FROM outbox WHERE entity_type = 'withdrawal' AND entity_id = ?", (fake.items[0]["id"],)) == []
    entries = [r["action"] for r in store.query("SELECT action FROM audit_log ORDER BY seq")]
    assert entries[-2:] == ["evidence.withdrawn", "edge.restore_checked"] and audit.verify(store)["ok"]
    final = backup.verify(target)
    assert final["ok"] and final["withdrawnClips"] == 1 and final["withdrawalsChecked"]
    # Back to normal: only unconfirmed withdrawals from here on.
    cloud.apply_withdrawals(target, store, fake)
    assert fake.asked_for_every is False


def test_an_unconfirmed_withdrawal_is_still_confirmed_after_a_restore(service, released, tmp_path):
    target = clean_machine(service.settings, tmp_path)
    backup.restore(target, io.BytesIO(backup_of(service.settings)))
    store = Store(target.db_path)
    item = item_for(released, edgeConfirmed=False)
    cloud.apply_withdrawals(target, store, FakeCloud([item]))
    assert store.query("SELECT 1 FROM outbox WHERE entity_type = 'withdrawal' AND entity_id = ?", (item["id"],))


def test_a_restored_clip_with_another_hash_keeps_the_gate_shut(service, released, tmp_path):
    target = clean_machine(service.settings, tmp_path)
    backup.restore(target, io.BytesIO(backup_of(service.settings)))
    store = Store(target.db_path)
    cloud.apply_withdrawals(target, store, FakeCloud([item_for(released, clipSha256="0" * 64)]))
    assert evidence.restore_unchecked(target) and evidence.path_of(target, released).exists()


def test_a_clip_this_backup_never_held_does_not_keep_the_gate_shut(service, released, tmp_path):
    target = clean_machine(service.settings, tmp_path)
    backup.restore(target, io.BytesIO(backup_of(service.settings)))
    store = Store(target.db_path)
    cloud.apply_withdrawals(target, store, FakeCloud([item_for(released, evidenceId="cut-after-the-backup")]))
    assert not evidence.restore_unchecked(target)


def test_a_person_may_accept_the_risk_and_the_chain_says_so(service, released, tmp_path, monkeypatch):
    from fairplay_edge import __main__ as cli

    target = clean_machine(service.settings, tmp_path)
    backup.restore(target, io.BytesIO(backup_of(service.settings)))
    monkeypatch.setattr(cli, "_settings", lambda need_api_token=True: target)
    assert cli.main(["restore-accept", "--by", "Fola", "--why", "no cloud at this venue"]) == 0
    assert not evidence.restore_unchecked(target)
    last = Store(target.db_path).query("SELECT action, actor_name, detail FROM audit_log ORDER BY seq DESC LIMIT 1")[0]
    assert (last["action"], last["actor_name"]) == ("edge.restore_accepted", "Fola") and "no cloud" in last["detail"]


def test_while_unchecked_the_api_will_not_hand_over_a_clip(clients, service, released):
    settings = service.settings
    (settings.data_dir / evidence.RESTORE_MARKER).write_text("{}")
    for call in (clients["admin"].get(f"/edge/v1/evidence/{released['id']}/file"),
                 clients["admin"].post(f"/edge/v1/evidence/{released['id']}/export", headers=CSRF)):
        assert call.status_code == 409 and "restore" in call.text, call.text
    (settings.data_dir / evidence.RESTORE_MARKER).unlink()
    assert clients["admin"].get(f"/edge/v1/evidence/{released['id']}/file").status_code == 200


def test_withdrawing_a_clip_also_removes_the_copy_a_restore_set_aside(clients, service, released):
    settings = service.settings
    aside = settings.data_dir / "backups" / "before-restore-20261031T000000Z" / "evidence" / released["rel_path"]
    aside.parent.mkdir(parents=True)
    aside.write_bytes(b"the old copy")
    assert withdraw(clients["admin"], released["id"]).status_code == 200
    assert not aside.exists()
