"""Repair a partial segment by copying its whole fragments, never by editing it.

The original stays byte-for-byte as MediaMTX left it, with its own hash and its `partial`
state. The repair is a separate file in `repaired/`, cut at the end of the last complete
`moof`+`mdat` pair, probed and hashed on its own, and recorded as a derivative of the
original with the number of bytes it dropped. Nothing calls the result complete.
"""

from __future__ import annotations

from pathlib import Path

from . import audit, mp4
from .audit import Actor
from .config import Settings
from .manifest import Scanner
from .naming import iso, utcnow
from .probe import ProbeError, probe, sha256_file
from .store import Store, new_id

COPY_CHUNK = 4 * 1024 * 1024


class RepairRefused(ValueError):
    pass


def repair(settings: Settings, store: Store, scanner: Scanner, segment_id: str, actor: Actor | None = None) -> dict:
    row = store.one("SELECT * FROM segments WHERE id = ?", (segment_id,))
    if row is None:
        raise KeyError(segment_id)
    if row["state"] != "partial":
        raise RepairRefused(f"only a partial segment can be repaired; this one is {row['state']}")
    source = settings.recordings_dir / row["rel_path"]
    structure = mp4.inspect(source)
    if structure.complete_bytes <= 0 or structure.fragments == 0:
        raise RepairRefused("no complete fragment to keep")
    if sha256_file(source) != row["sha256"]:
        raise RepairRefused("the original no longer matches its manifest hash; verify it before repairing")

    rel = Path(row["rel_path"])
    rel_out = (rel.parent / f"{rel.stem}.repaired.mp4").as_posix()
    target = settings.repaired_dir / rel_out
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".mp4.tmp")
    remaining = structure.complete_bytes
    with source.open("rb") as src, tmp.open("wb") as dst:
        while remaining:
            chunk = src.read(min(COPY_CHUNK, remaining))
            if not chunk:
                break
            dst.write(chunk)
            remaining -= len(chunk)
    tmp.replace(target)

    check = mp4.inspect(target)
    try:
        duration_ms = probe(target).duration_ms
    except ProbeError as exc:
        target.unlink(missing_ok=True)
        raise RepairRefused(f"the repaired copy does not probe: {exc}") from exc
    if not check.is_complete:
        target.unlink(missing_ok=True)
        raise RepairRefused(f"the repaired copy is still not whole: {check.problems}")

    derivative = {
        "id": new_id(),
        "segment_id": segment_id,
        "kind": "repair",
        "rel_path": rel_out,
        "bytes": check.file_bytes,
        "sha256": sha256_file(target),
        "duration_ms": duration_ms,
        "lost_bytes": structure.file_bytes - structure.complete_bytes,
        "created_utc": iso(utcnow()),
    }
    with store.tx() as db:
        db.execute(
            "INSERT INTO derivatives (id, segment_id, kind, rel_path, bytes, sha256, duration_ms, lost_bytes,"
            " created_utc) VALUES (:id, :segment_id, :kind, :rel_path, :bytes, :sha256, :duration_ms,"
            " :lost_bytes, :created_utc)", derivative,
        )
        Store.log_event(db, derivative["created_utc"], "segment.repaired", segment_id,
                        {k: derivative[k] for k in ("id", "sha256", "bytes", "lost_bytes")})
        audit.append(db, actor or Actor.system(), "segment.repaired", "segment", segment_id, None,
                     {"derivativeId": derivative["id"], "sha256": derivative["sha256"],
                      "originalSha256": row["sha256"], "lostBytes": derivative["lost_bytes"]})
    scanner.write_sidecar(segment_id)
    return {**derivative, "original": {"sha256": row["sha256"], "bytes": row["bytes"], "state": row["state"]},
            "note": "derivative of a partial original; the original is unchanged"}
