#!/usr/bin/env python3
"""Nightly Postgres backups for the single DTP box, and the way back from them.

    dtp-backup run                       dump, check, upload, prune (the nightly timer)
    dtp-backup run --pre-deploy [--release TAG]
                                         a restore point just before a deploy migrates
    dtp-backup list                      what is in the bucket and on this disk
    dtp-backup fetch SOURCE [-o FILE]    download a backup and check its sha256
    dtp-backup verify SOURCE [--keep]    restore into a throwaway Postgres and count rows
    dtp-backup restore-live SOURCE --confirm DBNAME
                                         replace the compose database with a backup

SOURCE is `latest`, an object key from `list` (daily/..., weekly/... or pre-deploy/...),
or a local .dump file.

Why it is shaped like this (docs/support-playbook/database-backup-and-restore.md):

* The database is a Postgres container on the instance's root volume, which is deleted
  with the instance. A backup that stays on the box protects against a bad migration and
  nothing else, so every dump goes to an S3-compatible bucket off AWS (Cloudflare R2).
* pg_dump runs inside the compose Postgres container, so the client always matches the
  server's major version and no password is needed (the image trusts its local socket).
  Custom format (-Fc) is compressed and lets pg_restore check the archive's table of
  contents, which is done before anything is uploaded.
* Retention is by count, not age: the newest BACKUP_KEEP_DAILY under daily/ and the
  newest BACKUP_KEEP_WEEKLY under weekly/. A week with no weekly copy promotes the
  night's dump, so a missed Sunday cannot leave a gap.
* Failure is reported to a dead man's switch (BACKUP_HEARTBEAT_URL, healthchecks.io
  style: GET on success, POST to /fail with the error). A backup that never runs --
  timer gone, box gone -- is caught because the success ping stops arriving.
* `run --pre-deploy` is the deploy's restore point, taken moments before
  `prisma migrate deploy`. It lives apart from the nightly rotation: pre-deploy/ in the
  bucket (newest BACKUP_KEEP_PRE_DEPLOY) and pre-deploy-*.dump on disk (newest
  BACKUP_PRE_DEPLOY_LOCAL_KEEP), so a day of deploys cannot push a night out of daily/.
  It never pings the heartbeat: a deploy's success must not hide a nightly that stopped.

Only the standard library and boto3 (python3-boto3 on Ubuntu 22.04, installed by the
common role). Settings come from /etc/dtp-backup/backup.env, then the environment.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request
from pathlib import Path

CONFIG_FILE = os.environ.get("DTP_BACKUP_CONFIG", "/etc/dtp-backup/backup.env")
STAMP_FORMAT = "%Y-%m-%dT%H%M%SZ"
KEY_PATTERN = re.compile(r"(\d{4}-\d{2}-\d{2}T\d{6}Z)\.dump$")
SCRATCH_IMAGE = "postgres:16-alpine"
# Services stopped while the live database is swapped: everything that holds a
# connection to it. `web` is nginx and static files, and keeps serving the site.
APP_SERVICES = ("api", "worker")
# Folders under BACKUP_S3_PREFIX, each with its own retention.
KINDS = ("daily", "weekly", "pre-deploy")

DEFAULTS = {
    "DTP_COMPOSE_PROJECT": "dtp-staging",
    "BACKUP_S3_ENDPOINT": "",
    "BACKUP_S3_REGION": "auto",
    "BACKUP_S3_BUCKET": "",
    "BACKUP_S3_PREFIX": "postgres/",
    "BACKUP_S3_ACCESS_KEY_ID": "",
    "BACKUP_S3_SECRET_ACCESS_KEY": "",
    "BACKUP_KEEP_DAILY": "14",
    "BACKUP_KEEP_WEEKLY": "8",
    "BACKUP_LOCAL_DIR": "/var/backups/dtp-db",
    "BACKUP_LOCAL_KEEP": "2",
    "BACKUP_KEEP_PRE_DEPLOY": "10",
    "BACKUP_PRE_DEPLOY_LOCAL_KEEP": "3",
    "BACKUP_HEARTBEAT_URL": "",
}


class BackupError(Exception):
    pass


# ── Settings ──────────────────────────────────────────────────────────────────


def load_settings() -> dict[str, str]:
    settings = dict(DEFAULTS)
    path = Path(CONFIG_FILE)
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            settings[name.strip()] = value.strip().strip('"').strip("'")
    for name in DEFAULTS:
        if name in os.environ:
            settings[name] = os.environ[name]
    prefix = settings["BACKUP_S3_PREFIX"].strip("/")
    settings["BACKUP_S3_PREFIX"] = f"{prefix}/" if prefix else ""
    return settings


def offsite_configured(s: dict[str, str]) -> bool:
    return all(
        s[name]
        for name in (
            "BACKUP_S3_ENDPOINT",
            "BACKUP_S3_BUCKET",
            "BACKUP_S3_ACCESS_KEY_ID",
            "BACKUP_S3_SECRET_ACCESS_KEY",
        )
    )


def bucket_client(s: dict[str, str]):
    if not offsite_configured(s):
        raise BackupError(
            "Off-box storage is not configured: BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, "
            "BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY must all be set "
            f"(in {CONFIG_FILE} or the environment)."
        )
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=s["BACKUP_S3_ENDPOINT"],
        region_name=s["BACKUP_S3_REGION"],
        aws_access_key_id=s["BACKUP_S3_ACCESS_KEY_ID"],
        aws_secret_access_key=s["BACKUP_S3_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
    )


# ── Small helpers ─────────────────────────────────────────────────────────────


def log(message: str) -> None:
    # stderr, so stdout carries only results (a path, --json); journald keeps both.
    print(f"[dtp-backup] {message}", file=sys.stderr, flush=True)


def docker(*args: str, stdin=None, stdout=None, check: bool = True, text: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(
        ["docker", *args],
        stdin=stdin,
        stdout=stdout if stdout is not None else subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=text if stdout is None else False,
    )
    if check and result.returncode != 0:
        err = result.stderr if isinstance(result.stderr, str) else result.stderr.decode("utf-8", "replace")
        raise BackupError(f"docker {' '.join(args[:3])} ... failed ({result.returncode}): {err.strip()[-2000:]}")
    return result


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def human(size: int) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{size} B"


def stamp_of(key: str) -> dt.datetime | None:
    match = KEY_PATTERN.search(key)
    if not match:
        return None
    return dt.datetime.strptime(match.group(1), STAMP_FORMAT).replace(tzinfo=dt.timezone.utc)


def heartbeat(s: dict[str, str], suffix: str = "", body: str = "") -> None:
    url = s["BACKUP_HEARTBEAT_URL"].rstrip("/")
    if not url:
        return
    data = body.encode("utf-8")[-10000:] if body else None
    for attempt in range(3):
        try:
            urllib.request.urlopen(urllib.request.Request(url + suffix, data=data), timeout=10).read()
            return
        except Exception as exc:  # a heartbeat that fails must not fail the backup
            if attempt == 2:
                log(f"heartbeat {suffix or '/'} not delivered: {exc}")
            time.sleep(2)


# ── Postgres containers ───────────────────────────────────────────────────────


def compose_containers(project: str, service: str, running_only: bool = True) -> list[str]:
    args = ["ps", "-q"] if running_only else ["ps", "-aq"]
    out = docker(
        *args,
        "--filter", f"label=com.docker.compose.project={project}",
        "--filter", f"label=com.docker.compose.service={service}",
    ).stdout
    return [line for line in out.split() if line]


def live_postgres(s: dict[str, str]) -> str:
    found = compose_containers(s["DTP_COMPOSE_PROJECT"], "postgres")
    if len(found) != 1:
        raise BackupError(
            f"Expected one running postgres container in compose project "
            f"{s['DTP_COMPOSE_PROJECT']!r}, found {len(found)}."
        )
    return found[0]


def container_env(container: str, name: str) -> str:
    value = docker("exec", container, "printenv", name).stdout.strip()
    if not value:
        raise BackupError(f"{name} is not set in container {container}")
    return value


def psql(container: str, user: str, db: str, sql: str) -> str:
    return docker(
        "exec", "-i", container,
        "psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-U", user, "-d", db, "-c", sql,
    ).stdout.strip()


def check_archive(container: str, dump: Path) -> int:
    """pg_restore --list reads the whole table of contents. Returns the TABLE DATA count."""
    with dump.open("rb") as f:
        result = docker("exec", "-i", container, "pg_restore", "--list", stdin=f)
    tables = sum(1 for line in result.stdout.splitlines() if " TABLE DATA " in line)
    if tables == 0:
        raise BackupError(f"{dump.name} has no table data in its table of contents")
    return tables


def dump_database(container: str, target: Path) -> str:
    db = container_env(container, "POSTGRES_DB")
    partial = target.with_suffix(".partial")
    with partial.open("wb") as out:
        docker(
            "exec", container, "sh", "-c",
            'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom',
            stdout=out,
        )
    if partial.stat().st_size < 1024:
        raise BackupError(f"pg_dump produced only {partial.stat().st_size} bytes")
    partial.replace(target)
    return db


def table_counts(container: str, user: str, db: str) -> list[tuple[str, int]]:
    sql = """
        select table_name || '|' || (xpath('/row/c/text()', query_to_xml(
            format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
        from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name
    """
    rows = []
    for line in psql(container, user, db, sql).splitlines():
        name, count = line.rsplit("|", 1)
        rows.append((name, int(count)))
    return rows


def latest_migration(container: str, user: str, db: str) -> str:
    exists = psql(container, user, db, "select to_regclass('public._prisma_migrations') is not null")
    if exists != "t":
        return "(no _prisma_migrations table)"
    return psql(
        container, user, db,
        "select migration_name from _prisma_migrations where finished_at is not null "
        "order by finished_at desc, migration_name desc limit 1",
    ) or "(none applied)"


def restore_into(container: str, user: str, db: str, dump: Path) -> None:
    # One transaction and stop at the first error: a restore either lands whole or
    # leaves the target database empty, never half-loaded.
    with dump.open("rb") as f:
        docker(
            "exec", "-i", container,
            "pg_restore", "-U", user, "-d", db,
            "--no-owner", "--exit-on-error", "--single-transaction",
            stdin=f,
        )


# ── Bucket ────────────────────────────────────────────────────────────────────


def list_keys(client, s: dict[str, str], kind: str) -> list[dict]:
    prefix = f"{s['BACKUP_S3_PREFIX']}{kind}/"
    items: list[dict] = []
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=s["BACKUP_S3_BUCKET"], Prefix=prefix):
        for obj in page.get("Contents", []):
            if stamp_of(obj["Key"]):
                items.append(obj)
    items.sort(key=lambda o: o["Key"])
    return items


def prune(client, s: dict[str, str], kind: str, keep: int, must_keep: str) -> list[str]:
    items = list_keys(client, s, kind)
    if must_keep not in {o["Key"] for o in items}:
        # The object just uploaded is not listed. Something is wrong with the bucket or
        # the listing; deleting anything now could leave no good backup at all.
        raise BackupError(f"{must_keep} is not in the {kind}/ listing; refusing to prune")
    doomed = [o["Key"] for o in items[:-keep]] if keep > 0 else []
    for key in doomed:
        client.delete_object(Bucket=s["BACKUP_S3_BUCKET"], Key=key)
    return doomed


def resolve_key(client, s: dict[str, str], source: str) -> str:
    if source == "latest":
        newest = [o["Key"] for kind in KINDS for o in list_keys(client, s, kind)]
        if not newest:
            raise BackupError("The bucket holds no backups")
        return max(newest, key=lambda k: stamp_of(k))
    if source.startswith(tuple(f"{kind}/" for kind in KINDS)):
        return s["BACKUP_S3_PREFIX"] + source
    return source


def fetch_to(client, s: dict[str, str], key: str, target: Path) -> Path:
    head = client.head_object(Bucket=s["BACKUP_S3_BUCKET"], Key=key)
    log(f"downloading {key} ({human(head['ContentLength'])})")
    client.download_file(s["BACKUP_S3_BUCKET"], key, str(target))
    want = head.get("Metadata", {}).get("sha256")
    if want:
        got = sha256_of(target)
        if got != want:
            target.unlink(missing_ok=True)
            raise BackupError(f"{key}: sha256 {got} does not match the recorded {want}")
        log("sha256 matches the value recorded at upload")
    return target


def local_source(s: dict[str, str], source: str, workdir: Path) -> Path:
    path = Path(source)
    if path.is_file():
        return path
    client = bucket_client(s)
    key = resolve_key(client, s, source)
    return fetch_to(client, s, key, workdir / Path(key).name)


# ── Commands ──────────────────────────────────────────────────────────────────


def cmd_run(s: dict[str, str], args) -> int:
    if args.pre_deploy:
        return cmd_pre_deploy(s, args)
    lock = acquire_lock()
    heartbeat(s, "/start")
    try:
        summary = run_backup(s)
    except Exception as exc:
        detail = f"{exc}\n\n{traceback.format_exc()}"
        log(f"FAILED: {exc}")
        heartbeat(s, "/fail", detail)
        return 1
    finally:
        lock.close()
    log(summary)
    heartbeat(s, "", summary)
    return 0


def acquire_lock(wait: int = 0):
    import fcntl

    handle = open("/run/dtp-backup.lock" if os.access("/run", os.W_OK) else "/tmp/dtp-backup.lock", "w")
    deadline = time.monotonic() + wait
    while True:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return handle
        except BlockingIOError:
            if time.monotonic() >= deadline:
                raise SystemExit("[dtp-backup] another backup is running")
            time.sleep(2)


def local_backup_dir(s: dict[str, str]) -> Path:
    local_dir = Path(s["BACKUP_LOCAL_DIR"])
    local_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(local_dir, 0o700)
    return local_dir


def dump_and_check(container: str, target: Path) -> tuple[int, int, str]:
    """Dump to target and read its table of contents back. Returns (size, tables, sha256)."""
    dump_database(container, target)
    size = target.stat().st_size
    tables = check_archive(container, target)
    digest = sha256_of(target)
    log(f"dump ok: {target.name}, {human(size)}, {tables} tables with data, sha256 {digest[:16]}...")
    return size, tables, digest


def upload(client, s: dict[str, str], path: Path, key: str, metadata: dict[str, str]) -> None:
    bucket = s["BACKUP_S3_BUCKET"]
    client.upload_file(
        str(path), bucket, key,
        ExtraArgs={"Metadata": metadata, "ContentType": "application/octet-stream"},
    )
    head = client.head_object(Bucket=bucket, Key=key)
    size = path.stat().st_size
    if head["ContentLength"] != size:
        raise BackupError(f"uploaded {key} is {head['ContentLength']} bytes, the dump is {size}")
    log(f"uploaded s3://{bucket}/{key}")


def run_backup(s: dict[str, str]) -> str:
    started = time.monotonic()
    now = dt.datetime.now(dt.timezone.utc)
    local_dir = local_backup_dir(s)

    container = live_postgres(s)
    db = container_env(container, "POSTGRES_DB")
    name = f"{db}-{now.strftime(STAMP_FORMAT)}.dump"
    target = local_dir / name
    log(f"dumping {db} from container {container[:12]}")
    size, tables, digest = dump_and_check(container, target)

    # Keep the newest few on the box: the quickest way back from a bad migration, and
    # still there if the bucket is unreachable. Older ones only cost disk.
    keep_local = max(1, int(s["BACKUP_LOCAL_KEEP"]))
    for old in sorted(local_dir.glob(f"{db}-*.dump"))[:-keep_local]:
        old.unlink()

    # A dump that never leaves the box is not a backup of a box that can be lost, so an
    # unconfigured bucket fails the run (and the heartbeat), loudly, every night.
    client = bucket_client(s)
    bucket = s["BACKUP_S3_BUCKET"]
    daily_key = f"{s['BACKUP_S3_PREFIX']}daily/{name}"
    upload(client, s, target, daily_key, {"sha256": digest, "database": db})

    weekly = list_keys(client, s, "weekly")
    newest_weekly = stamp_of(weekly[-1]["Key"]) if weekly else None
    promoted = ""
    if newest_weekly is None or now - newest_weekly >= dt.timedelta(days=6, hours=12):
        weekly_key = f"{s['BACKUP_S3_PREFIX']}weekly/{name}"
        client.copy_object(Bucket=bucket, Key=weekly_key, CopySource={"Bucket": bucket, "Key": daily_key})
        promoted = weekly_key
        log(f"promoted to {weekly_key}")

    pruned = prune(client, s, "daily", int(s["BACKUP_KEEP_DAILY"]), daily_key)
    pruned += prune(client, s, "weekly", int(s["BACKUP_KEEP_WEEKLY"]), promoted or weekly[-1]["Key"])
    for key in pruned:
        log(f"pruned {key}")

    return (
        f"backup ok: {daily_key} {human(size)} sha256={digest} tables={tables} "
        f"weekly={'yes' if promoted else 'no'} pruned={len(pruned)} "
        f"took={time.monotonic() - started:.0f}s"
    )


def cmd_pre_deploy(s: dict[str, str], args) -> int:
    # Waits out a nightly run (seconds today) rather than failing the deploy over it.
    lock = acquire_lock(wait=600)
    try:
        summary = run_pre_deploy(s, args.release)
    finally:
        lock.close()
    print(summary)
    return 0


def run_pre_deploy(s: dict[str, str], release: str) -> str:
    """The deploy's restore point. Raises if no checked dump is on disk; an upload that
    fails is reported in the summary and is not an error, since the local copy is the
    quick way back from a bad migration and the nightly heartbeat reports the bucket."""
    started = time.monotonic()
    now = dt.datetime.now(dt.timezone.utc)
    container = live_postgres(s)
    user = container_env(container, "POSTGRES_USER")
    db = container_env(container, "POSTGRES_DB")

    # A new box: the first deploy creates the schema, and there is nothing to keep.
    tables = psql(
        container, user, db,
        "select count(*) from information_schema.tables "
        "where table_schema = 'public' and table_type = 'BASE TABLE'",
    )
    if int(tables) == 0:
        return f"pre-deploy: nothing to protect, {db} has no tables yet"

    migration = latest_migration(container, user, db)
    local_dir = local_backup_dir(s)
    name = f"{db}-{now.strftime(STAMP_FORMAT)}.dump"
    # The pre-deploy- prefix keeps these out of the nightly's `{db}-*.dump` pruning.
    target = local_dir / f"pre-deploy-{name}"
    log(f"dumping {db} from container {container[:12]} before deploying {release or '(unnamed release)'}")
    size, count, digest = dump_and_check(container, target)

    keep_local = max(1, int(s["BACKUP_PRE_DEPLOY_LOCAL_KEEP"]))
    for old in sorted(local_dir.glob(f"pre-deploy-{db}-*.dump"))[:-keep_local]:
        old.unlink()

    where = f"local {target}"
    if not offsite_configured(s):
        where += " (bucket not configured: not uploaded)"
    else:
        key = f"{s['BACKUP_S3_PREFIX']}pre-deploy/{name}"
        metadata = {"sha256": digest, "database": db, "migration": migration}
        if release:
            metadata["release"] = release
        try:
            client = bucket_client(s)
            upload(client, s, target, key, metadata)
            for pruned in prune(client, s, "pre-deploy", int(s["BACKUP_KEEP_PRE_DEPLOY"]), key):
                log(f"pruned {pruned}")
            where = f"{key[len(s['BACKUP_S3_PREFIX']):]}, {where}"
        except Exception as exc:
            log(f"WARNING: upload failed, the restore point is on this box only: {exc}")
            where += f" (upload FAILED: {str(exc)[:200]})"

    return (
        f"pre-deploy restore point: {where} {human(size)} tables={count} "
        f"schema={migration} release={release or '-'} took={time.monotonic() - started:.0f}s"
    )


def cmd_list(s: dict[str, str], _args) -> int:
    if offsite_configured(s):
        client = bucket_client(s)
        for kind in KINDS:
            items = list_keys(client, s, kind)
            print(f"{kind}/ ({len(items)})")
            for o in reversed(items):
                print(f"  {o['Key'][len(s['BACKUP_S3_PREFIX']):]}  {human(o['Size']):>10}")
    else:
        print("(bucket not configured)")
    local_dir = Path(s["BACKUP_LOCAL_DIR"])
    local = sorted(local_dir.glob("*.dump"), reverse=True) if local_dir.is_dir() else []
    print(f"local {local_dir} ({len(local)})")
    for path in local:
        print(f"  {path.name}  {human(path.stat().st_size):>10}")
    return 0


def cmd_fetch(s: dict[str, str], args) -> int:
    client = bucket_client(s)
    key = resolve_key(client, s, args.source)
    target = Path(args.output) if args.output else Path.cwd() / Path(key).name
    fetch_to(client, s, key, target)
    print(target)
    return 0


def cmd_verify(s: dict[str, str], args) -> int:
    workdir = Path(tempfile.mkdtemp(prefix="dtp-restore-"))
    name = f"dtp-restore-check-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d%H%M%S')}"
    user, db = "dtp", "dtp_restore_check"
    password = secrets.token_hex(16)
    started = False
    try:
        dump = local_source(s, args.source, workdir)
        log(f"starting scratch {SCRATCH_IMAGE} as {name}")
        docker(
            "run", "-d", "--name", name,
            "-e", f"POSTGRES_USER={user}", "-e", f"POSTGRES_DB={db}", "-e", f"POSTGRES_PASSWORD={password}",
            SCRATCH_IMAGE,
        )
        started = True
        wait_for_postgres(name, user, db, password)
        log(f"restoring {dump.name} ({human(dump.stat().st_size)})")
        t0 = time.monotonic()
        restore_into(name, user, db, dump)
        log(f"restore finished in {time.monotonic() - t0:.1f}s")
        counts = table_counts(name, user, db)
        report = {
            "source": str(args.source),
            "tables": len(counts),
            "rows": sum(c for _, c in counts),
            "latest_migration": latest_migration(name, user, db),
            "counts": dict(counts),
        }
        if args.json:
            print(json.dumps(report, indent=2))
        else:
            for table, count in counts:
                print(f"  {table:<48} {count:>10}")
            print(f"{report['tables']} tables, {report['rows']} rows, latest migration {report['latest_migration']}")
        if report["tables"] == 0:
            raise BackupError("the restored database has no tables")
        if args.keep:
            log(f"kept {name}: docker exec -it {name} psql -U {user} -d {db}   (docker rm -f {name} when done)")
        return 0
    finally:
        if started and not args.keep:
            docker("rm", "-f", "-v", name, check=False)
        shutil.rmtree(workdir, ignore_errors=True)


def wait_for_postgres(container: str, user: str, db: str, password: str, timeout: int = 90) -> None:
    # Over TCP, not the socket: the image's first-boot init runs a temporary server on
    # the socket only, then restarts. TCP answering means the real server is up.
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        probe = docker(
            "exec", "-e", f"PGPASSWORD={password}", container,
            "psql", "-h", "127.0.0.1", "-U", user, "-d", db, "-Atc", "select 1",
            check=False,
        )
        if probe.returncode == 0:
            return
        time.sleep(1)
    raise BackupError(f"scratch Postgres {container} did not come up in {timeout}s")


def cmd_restore_live(s: dict[str, str], args) -> int:
    container = live_postgres(s)
    user = container_env(container, "POSTGRES_USER")
    db = container_env(container, "POSTGRES_DB")
    if args.confirm != db:
        raise BackupError(f"--confirm must name the live database ({db}); nothing was changed")

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d%H%M%S")
    staging_db = f"{db}_restore_{stamp}"
    kept_db = f"{db}_before_restore_{stamp}"
    workdir = Path(tempfile.mkdtemp(prefix="dtp-restore-"))
    try:
        dump = local_source(s, args.source, workdir)
        check_archive(container, dump)

        # 1. A copy of what is there now, whatever it is, before touching anything.
        local_dir = Path(s["BACKUP_LOCAL_DIR"])
        local_dir.mkdir(parents=True, exist_ok=True)
        safety = local_dir / f"pre-restore-{db}-{stamp}.dump"
        dump_database(container, safety)
        log(f"saved the current database to {safety}")

        # 2. Restore beside the live database. The site keeps running throughout.
        psql(container, user, "postgres", f'create database "{staging_db}" owner "{user}"')
        log(f"restoring {dump.name} into {staging_db}")
        try:
            restore_into(container, user, staging_db, dump)
        except Exception:
            psql(container, user, "postgres", f'drop database if exists "{staging_db}"')
            raise
        counts = table_counts(container, user, staging_db)
        log(f"restored {len(counts)} tables, {sum(c for _, c in counts)} rows, "
            f"latest migration {latest_migration(container, user, staging_db)}")

        # 3. Swap. The API and worker are stopped for the two renames, then started on
        #    the restored database.
        app = [c for svc in APP_SERVICES for c in compose_containers(s["DTP_COMPOSE_PROJECT"], svc)]
        if app:
            log(f"stopping {len(app)} app container(s)")
            docker("stop", "-t", "60", *app)
        try:
            psql(container, user, "postgres",
                 f"select pg_terminate_backend(pid) from pg_stat_activity "
                 f"where datname = '{db}' and pid <> pg_backend_pid()")
            psql(container, user, "postgres", f'alter database "{db}" rename to "{kept_db}"')
            psql(container, user, "postgres", f'alter database "{staging_db}" rename to "{db}"')
            log(f"{db} is now the restored backup; the previous database is kept as {kept_db}")
        finally:
            if app:
                docker("start", *app, check=False)
                log("app containers started")
        print(
            "\nNext:\n"
            "  * If the backup predates the running release, apply its migrations: re-run the\n"
            "    deploy for the current commit (it runs `prisma migrate deploy`).\n"
            "    Not when undoing a bad migration: that would apply it again. Roll back the\n"
            "    release instead (the runbook, \"A deploy's migration went wrong\").\n"
            "  * Check https://dtp.africa/api/v1/health/ready and the site.\n"
            f"  * When satisfied: docker exec {container[:12]} dropdb -U {user} {kept_db}\n"
            f"    and remove {safety}\n"
        )
        return 0
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="dtp-backup", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="dump, check, upload and prune (the nightly job)")
    run.add_argument(
        "--pre-deploy", action="store_true",
        help="a restore point before migrating: pre-deploy/ only, no heartbeat, local copy enough",
    )
    run.add_argument("--release", default="", help="with --pre-deploy: the release about to deploy")
    sub.add_parser("list", help="backups in the bucket and on this disk")
    fetch = sub.add_parser("fetch", help="download a backup and check its sha256")
    fetch.add_argument("source")
    fetch.add_argument("-o", "--output")
    verify = sub.add_parser("verify", help="restore into a throwaway Postgres and count rows")
    verify.add_argument("source")
    verify.add_argument("--keep", action="store_true", help="leave the scratch container running")
    verify.add_argument("--json", action="store_true")
    live = sub.add_parser("restore-live", help="replace the compose database with a backup")
    live.add_argument("source")
    live.add_argument("--confirm", required=True, metavar="DBNAME", help="the live database's name")
    args = parser.parse_args(argv)

    settings = load_settings()
    handler = {
        "run": cmd_run,
        "list": cmd_list,
        "fetch": cmd_fetch,
        "verify": cmd_verify,
        "restore-live": cmd_restore_live,
    }[args.command]
    try:
        return handler(settings, args)
    except BackupError as exc:
        log(f"error: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
