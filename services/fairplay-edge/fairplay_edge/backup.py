"""Backing up and restoring the Edge's record (Phase 6.2; docs/fairplay/edge-backup.md).

A backup is one gzipped tar: a consistent copy of the database (SQLite's online backup, so
the Edge may keep running), the manifests, the evidence clips and their manifests, the TLS
files, and loose files such as the bundle, with BACKUP.json listing every file's SHA-256.

Left out on purpose: the recordings (about 1.1 GB per camera-hour, kept only 14 days),
repaired copies, export packages and the update script's database copies.

A restore checks everything before it touches anything: every listed file's hash, nothing
unlisted, the database's integrity, a schema this code can read. It never overwrites an
Edge's data without `replace`, and then sets the old data aside. It leaves `restored.json`:
until the cloud has said what was withdrawn since the backup was taken, no clip leaves this
Edge, because a clip withdrawn since then has just come back (cloud.apply_withdrawals).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import stat
import tarfile
import tempfile
from pathlib import Path
from typing import BinaryIO

from . import __version__, audit, evidence
from .config import Settings
from .naming import iso, utcnow
from .probe import sha256_file
from .store import SCHEMA_VERSION, Store

SCHEMA = "fairplay.edge-backup/v1"
FOLDERS = ("manifests", "evidence", "tls")
DATABASE = "edge.sqlite3"
LISTING = "BACKUP.json"
# Loose files in the data folder that are not the record, or are the database's own.
NOT_LOOSE = (DATABASE, f"{DATABASE}-wal", f"{DATABASE}-shm", evidence.RESTORE_MARKER)


class RestoreRefused(RuntimeError):
    pass


class _Hashing:
    """Hashes what goes into the tar, so the list always describes what the archive holds."""

    def __init__(self, stream: BinaryIO):
        self.stream, self.digest = stream, hashlib.sha256()

    def read(self, size: int = -1) -> bytes:
        chunk = self.stream.read(size)
        self.digest.update(chunk)
        return chunk


def _included(data_dir: Path) -> list[str]:
    names = [p.name for p in sorted(data_dir.iterdir()) if p.is_file() and p.name not in NOT_LOOSE]
    for folder in FOLDERS:
        root = data_dir / folder
        if root.is_dir():
            names += [p.relative_to(data_dir).as_posix() for p in sorted(root.rglob("*")) if p.is_file()]
    return names


def create(settings: Settings, out: BinaryIO) -> dict:
    """Write a backup to `out`. The database is copied first: a file it names can only be
    missing if it was withdrawn meanwhile, and a file newer than it does no harm."""
    data_dir = settings.data_dir
    with tempfile.TemporaryDirectory(dir=data_dir, prefix=".backup-") as work:
        copy = Path(work) / DATABASE
        source = sqlite3.connect(settings.db_path)
        target = sqlite3.connect(copy)
        try:
            source.backup(target)
            device = target.execute("SELECT device_id FROM edge_identity").fetchone()[0]
            schema = target.execute("SELECT version FROM schema_version").fetchone()[0]
        finally:
            target.close()
            source.close()
        files: dict[str, str] = {}
        with tarfile.open(fileobj=out, mode="w|gz") as tar:
            for name, path in [(DATABASE, copy), *((n, data_dir / n) for n in _included(data_dir))]:
                try:
                    with open(path, "rb") as stream:
                        info = tar.gettarinfo(arcname=name, fileobj=stream)
                        hashing = _Hashing(stream)
                        tar.addfile(info, hashing)
                except FileNotFoundError:
                    continue  # withdrawn, or a temporary file finished with, since the list was made
                files[name] = hashing.digest.hexdigest()
            listing = {"schema": SCHEMA, "createdUtc": iso(utcnow()), "edgeVersion": __version__, "deviceId": device,
                       "schemaVersion": schema, "files": files,
                       "notIncluded": "recordings, repaired copies, export packages and database copies in backups/"}
            listed = Path(work) / LISTING
            listed.write_text(json.dumps(listing, indent=2, sort_keys=True), encoding="utf-8")
            tar.add(listed, arcname=LISTING, recursive=False)
    return {"createdUtc": listing["createdUtc"], "deviceId": device, "schemaVersion": schema, "files": len(files)}


def _unpack(stream: BinaryIO, work: Path) -> dict:
    try:
        with tarfile.open(fileobj=stream, mode="r|gz") as tar:
            for member in tar:
                if not member.isfile():
                    raise RestoreRefused(f"not a regular file in the backup: {member.name}")
                # The `data` filter refuses absolute paths, `..`, links and device files.
                tar.extract(member, work, filter="data")
    except (tarfile.TarError, EOFError, OSError) as exc:
        raise RestoreRefused(f"the backup cannot be read: {exc}") from exc
    try:
        listing = json.loads((work / LISTING).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RestoreRefused(f"the backup has no readable {LISTING}") from exc
    if not isinstance(listing, dict) or listing.get("schema") != SCHEMA:
        raise RestoreRefused("this is not a FairPlay Edge backup")
    return listing


def _check(work: Path, listing: dict) -> None:
    present = {p.relative_to(work).as_posix() for p in work.rglob("*") if p.is_file()} - {LISTING}
    files = listing["files"]
    if present != set(files):
        raise RestoreRefused(f"the backup's files differ from its list: {sorted(present ^ set(files))[:5]}")
    for name, digest in files.items():
        if sha256_file(work / name) != digest:
            raise RestoreRefused(f"{name} does not match its recorded hash: this backup is damaged")
    if DATABASE not in files:
        raise RestoreRefused("the backup holds no database")
    db = sqlite3.connect(work / DATABASE)
    try:
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    except sqlite3.Error as exc:
        raise RestoreRefused(f"the backed-up database cannot be read: {exc}") from exc
    finally:
        db.close()
    if integrity != "ok":
        raise RestoreRefused(f"the backed-up database is damaged: {integrity}")
    if listing["schemaVersion"] > SCHEMA_VERSION:
        raise RestoreRefused(f"the backup's database is schema {listing['schemaVersion']}, newer than this Edge's"
                             f" {SCHEMA_VERSION}: install that release or a later one first")


def _holds_a_record(settings: Settings) -> bool:
    if not settings.db_path.exists():
        return False
    # Not `segments`: a new install with cameras connected records at once, and the files
    # stay on their own volume, where the Edge finds them again.
    db = sqlite3.connect(settings.db_path)
    try:
        return any(db.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone()  # noqa: S608 (fixed names)
                   for table in ("match_sessions", "incidents", "evidence"))
    except sqlite3.Error:
        return True  # unreadable: not ours to throw away without being told
    finally:
        db.close()


def _set_aside(settings: Settings) -> Path:
    data_dir = settings.data_dir
    (data_dir / "backups").mkdir(exist_ok=True)
    aside = Path(tempfile.mkdtemp(prefix=f"before-restore-{utcnow().strftime('%Y%m%dT%H%M%SZ')}-", dir=data_dir / "backups"))
    names = [n for n in (DATABASE, f"{DATABASE}-wal", f"{DATABASE}-shm", *FOLDERS) if (data_dir / n).exists()]
    names += [p.name for p in data_dir.iterdir() if p.is_file() and p.name not in NOT_LOOSE]
    for name in names:
        shutil.move(str(data_dir / name), aside / name)
    return aside


def restore(settings: Settings, stream: BinaryIO, *, replace: bool = False) -> dict:
    """Restore a backup into this Edge's data folder. The Edge must be stopped."""
    data_dir = settings.data_dir
    data_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=data_dir, prefix=".restore-") as tmp:
        work = Path(tmp)
        listing = _unpack(stream, work)
        _check(work, listing)
        if _holds_a_record(settings) and not replace:
            raise RestoreRefused("this Edge already holds a record, and nothing was changed: restore with --replace to set it aside")
        aside = _set_aside(settings)
        for name in listing["files"]:
            target = data_dir / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(work / name), target)
    # As the Edge leaves them: clips read-only, private keys for the owner alone.
    for path in (data_dir / "evidence").rglob("*") if (data_dir / "evidence").is_dir() else ():
        if path.is_file():
            path.chmod(stat.S_IRUSR | stat.S_IRGRP)
    for path in (data_dir / "tls").glob("*-key.pem"):
        os.chmod(path, 0o600)
    at = iso(utcnow())
    (data_dir / evidence.RESTORE_MARKER).write_text(
        json.dumps({"backupCreatedUtc": listing["createdUtc"], "restoredUtc": at}), encoding="utf-8")
    result = verify(settings)  # also moves an older database's schema up to this release's
    store = Store(settings.db_path)
    store.open_alert("restore_unchecked", None, "warning", at, {"backupCreatedUtc": listing["createdUtc"]})
    audit.record(store, audit.Actor.system(), "edge.restored", "edge", None, None,
                 {"backupCreatedUtc": listing["createdUtc"], "files": len(listing["files"])})
    return {"backupCreatedUtc": listing["createdUtc"], "files": len(listing["files"]), "setAside": aside.as_posix(), **result}


def verify(settings: Settings) -> dict:
    """What a restore must show before anyone relies on it: the audit chain whole, every clip
    and manifest matching its hash, every withdrawn clip gone. Recordings are counted only:
    a backup does not hold them."""
    store = Store(settings.db_path)
    chain = audit.verify(store)
    damaged, withdrawn = [], 0
    for row in store.query("SELECT * FROM evidence"):
        clip, manifest = evidence.path_of(settings, row), evidence.path_of(settings, row, "manifest_rel_path")
        if not manifest.exists() or sha256_file(manifest) != row["manifest_sha256"]:
            damaged.append(f"{row['id']}: its manifest is missing, or does not match its hash")
        if evidence.withdrawal_of(store, row["id"]) is not None:
            withdrawn += 1
            if clip.exists():
                damaged.append(f"{row['id']}: withdrawn, but its clip is here")
        elif not clip.exists() or sha256_file(clip) != row["sha256"]:
            damaged.append(f"{row['id']}: its clip is missing, or does not match its hash")
    held = store.query("SELECT rel_path FROM segments WHERE state IN ('finalized', 'partial')")
    missing = sum(not (settings.recordings_dir / r["rel_path"]).exists() for r in held)
    counts = {t: store.one(f"SELECT COUNT(*) AS n FROM {t}")["n"]  # noqa: S608 (fixed names)
              for t in ("match_sessions", "segments", "incidents", "evidence", "withdrawals", "audit_log")}
    return {"ok": bool(chain["ok"]) and not damaged, "auditChain": chain, "damaged": damaged, "withdrawnClips": withdrawn,
            "recordingsListed": len(held), "recordingsNotHere": missing, "counts": counts,
            "withdrawalsChecked": not evidence.restore_unchecked(settings)}
