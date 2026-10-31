# Database Backup, Restore and Alerts

Everything runs on one t3.small. Postgres is a container on the instance's root volume,
and that volume is deleted with the instance. This page covers what keeps a copy
elsewhere, how to get it back, and what tells you when something is wrong.

## What protects the data

| Layer | Where | How often | Kept | Restores |
|---|---|---|---|---|
| `pg_dump` (custom format) | R2 bucket, `postgres/daily/` | nightly 02:30 UTC | newest 14 | the database, into any Postgres 16 |
| Same dump, promoted | R2 bucket, `postgres/weekly/` | once a week | newest 8 (about 2 months) | the same |
| Same dump, local copy | `/var/backups/dtp-db` on the box | nightly | newest 2 | quick undo of a bad migration |
| Pre-deploy restore point | R2 bucket, `postgres/pre-deploy/` | every deploy, just before migrations | newest 10 | the database as it was moments before a migration |
| Same, local copy | `/var/backups/dtp-db/pre-deploy-*.dump` | every deploy | newest 3 | the same, with no bucket needed |
| EBS snapshot (DLM) | AWS, outlives the instance | daily 03:30 UTC | 7 | the whole box, as it was. **Not active:** Terraform applies are on hold |

- Nightly job: `/usr/local/bin/dtp-backup run`, from `dtp-backup.timer`. Installed by
  `infra/ansible/roles/backup` on every deploy. Source: `infra/backup/dtp-backup.py`.
- Each run dumps inside the Postgres container, checks the archive with
  `pg_restore --list`, uploads it, confirms the uploaded size, records a sha256, and
  then prunes. It never prunes if it cannot see the object it just uploaded.
- Every deploy that migrates (`run_migrations`, so not the rollback) runs
  `dtp-backup run --pre-deploy` just before `prisma migrate deploy`. It keeps its own
  folder and counts, so deploys never push a nightly out of `daily/`, and it sends no
  heartbeat, so a deploy cannot hide a nightly that stopped. If the dump fails, the
  deploy stops there with the old release still serving; if only the upload fails, the
  deploy goes on with the local copy and says so. The deploy log's *Report the restore
  point* line names the object. A new box with no tables yet skips it.
- Media is not here. It is in R2 already (the `VISION_R2_BUCKET_*` buckets).

## Alerts

| What | Watches | Alerts when | Where it lives |
|---|---|---|---|
| Uptime | `https://dtp.africa/api/v1/health/ready` | not 200, or no `"db":"ok"` | external monitor (one-time setup) |
| Backup heartbeat | `dtp-backup run` | `/fail` ping, or no success ping in a day | healthchecks.io |
| Disk heartbeat | `dtp-disk-check`, every 15 min | root volume at or above 80%, or no ping for 30 min | healthchecks.io |
| CPU credits | CloudWatch `CPUCreditBalance` | under 30 for 10 min | `infra/terraform/alerts.tf` (**not active:** Terraform applies are on hold) |
| Status checks | CloudWatch `StatusCheckFailed` | failing for 5 min, or no data | `infra/terraform/alerts.tf` (**not active:** Terraform applies are on hold) |

`/api/v1/health` is liveness only and never touches the database: the deploy's smoke test
uses it. `/api/v1/health/ready` runs `SELECT 1` with a 3 s limit and returns 503
`{"db":"down"}` when Postgres does not answer.

Both heartbeats are dead man's switches, so they also fire when the box is gone or the
timer has stopped.

### First response

- **Backup failed.** `journalctl -u dtp-backup -n 50` on the box. The healthchecks.io
  event holds the error too. Common causes: the bucket credentials changed, Postgres is
  down, or the disk is full. Re-run it with `sudo systemctl start dtp-backup.service`.
- **Disk at 80%.** `docker system df`, then `du -xh / --max-depth=2 | sort -h | tail`.
  Compose logs are capped at 50 MB a service. The usual cause is images left behind by
  a failed deploy: `docker image prune -af` (never `docker system prune --volumes`,
  which deletes the Postgres volume).
- **CPU credits low.** `top` or `docker stats`: something is spinning. On this box that
  has meant building images here, or the Vision worker transcoding. When the balance
  reaches 0 the box answers TCP but not HTTP.
- **Uptime down, liveness up.** The API is running but cannot reach Postgres. Check
  `docker compose ... ps` and the Postgres container's logs.
- **Status check failed.** EC2 recovers a failed host on its own. If the instance itself
  is impaired, reboot it from the console. If it is gone, see *The box is lost* below.

## Using the tool

On the box, with the settings Ansible wrote in `/etc/dtp-backup/backup.env`:

```bash
sudo dtp-backup list                    # bucket (daily/, weekly/, pre-deploy/) and local copies
sudo systemctl start dtp-backup.service # back up now, as the timer would
journalctl -u dtp-backup -n 50
sudo dtp-backup fetch latest -o /tmp/latest.dump   # download, sha256 checked
sudo dtp-backup verify latest           # restore into a throwaway Postgres, count rows
```

From a laptop with Docker and Python 3 (`pip install boto3`), point it at the bucket:

```bash
cat > backup.env <<'EOF'
BACKUP_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
BACKUP_S3_BUCKET=dtp-db-backups
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
EOF
DTP_BACKUP_CONFIG=backup.env python3 infra/backup/dtp-backup.py verify latest
```

`SOURCE` for `fetch`, `verify` and `restore-live` is `latest` (the newest of all three
folders), a key as `list` prints it (`daily/dtp_africa-2026-10-17T023012Z.dump`,
`pre-deploy/dtp_africa-2026-10-17T144312Z.dump`), or a local `.dump` file.

## Restores

### Drill: prove the latest backup restores (monthly, and after any schema change)

```bash
sudo dtp-backup verify latest
```

The tool starts a scratch `postgres:16-alpine`, restores in one transaction (any error
fails it), prints every table's row count and the latest Prisma migration, then deletes
the container. Exit 0 means the backup is good. Add `--keep` to leave the container up
and query it.

### A deploy's migration went wrong

The deploy took a restore point moments before it migrated. Its log names it, under
*Report the restore point*: `pre-deploy/dtp_africa-<stamp>.dump`, with the release and the
last migration applied before it. `sudo dtp-backup list` shows the same.

1. Check it: `sudo dtp-backup verify pre-deploy/dtp_africa-<stamp>.dump`. The latest
   migration it prints should be the one before the bad one.
2. Restore it (needs approval, see below):

   ```bash
   sudo dtp-backup restore-live pre-deploy/dtp_africa-<stamp>.dump --confirm dtp_africa
   ```

   With the bucket unreachable, use the local copy instead:
   `/var/backups/dtp-db/pre-deploy-dtp_africa-<stamp>.dump`.
3. Revert the commit that added the migration and let CD deploy the revert. Its
   `migrate deploy` finds nothing new, because the restored database is at the schema the
   previous release expects. **Do not re-run the deploy of the bad commit**: it would
   apply the same migration again. Until the revert is live, the newer release is
   running against the older schema.

Anything written between the restore point and the restore is in the kept
`dtp_africa_before_restore_<stamp>` database, if it needs to be copied across.

### Bad data or a bad migration; the box is fine

```bash
sudo dtp-backup list
sudo dtp-backup restore-live daily/dtp_africa-<stamp>.dump --confirm dtp_africa
```

What it does, in order:

1. Dumps the current database to `/var/backups/dtp-db/pre-restore-*.dump`, so the
   restore can itself be undone.
2. Restores the backup into a new database beside the live one. The site keeps serving.
   If the restore fails, the new database is dropped and nothing else has changed.
3. Stops `api` and `worker`, renames the live database to
   `dtp_africa_before_restore_<stamp>`, renames the restored one to `dtp_africa`, and
   starts them again. Downtime is seconds.

Then:

- If the backup is older than the running release's schema, re-run the deploy for the
  current commit (CD, *Run workflow*). Its `prisma migrate deploy` applies what is
  missing.
- Check `/api/v1/health/ready` and the site.
- When you are satisfied, drop the kept database (the tool prints the exact command)
  and delete the pre-restore dump.

### The box is lost (terminated, volume gone)

1. **Fastest, if a snapshot exists.** In EC2 → Snapshots, find the newest snapshot
   tagged `SnapshotCreator = dlm`. Register an AMI from it (root device `/dev/sda1`,
   x86_64, ENA on), launch a t3.small from that AMI in the same subnet and security
   group, and move the Elastic IP to it. The box comes up as it was at 03:30 UTC, and
   Postgres replays its WAL on start. Then restore the night's dump if it is newer
   (`restore-live latest`).
2. **Otherwise, rebuild.** Recreate the instance (`infra/DEPLOYMENT.md`, Terraform),
   run the CD deploy, which installs Docker, the stack, an empty migrated database and
   `dtp-backup`, and then:

   ```bash
   sudo dtp-backup restore-live latest --confirm dtp_africa
   ```

   Re-run the deploy so any migration newer than the backup is applied.

### FairPlay after a restore

The nightly dump includes the `fairplay_*` tables. A restore rolls them back with everything
else, and a clip withdrawal made after the dump loses its record in the cloud, although the
clip stays deleted from the bucket and from the Edge. Before and after a restore, follow
[the FairPlay section](../fairplay/edge-backup.md#the-clouds-fairplay-tables).

## One-time setup

All of this is by hand. None of it is done by a deploy, and each step costs nothing or
very little (see *Cost*).

1. **R2 bucket.** Cloudflare → R2 → create the bucket `dtp-db-backups`. Then
   *Manage API tokens* → create a token with **Object Read & Write**, scoped to that
   bucket only. Do not reuse the Vision keys: a leaked Vision key should not be able to
   delete the backups.
2. **Heartbeats.** On healthchecks.io (free plan), create two checks:
   - `dtp-db-backup`: period 1 day, grace 3 hours.
   - `dtp-disk`: period 15 minutes, grace 30 minutes.
3. **Secret.** Add these keys to the `dtp/staging/app` secret in Secrets Manager. Each
   is optional; any that is absent leaves that part unconfigured, and the deploy says so.

   | Key | Value |
   |---|---|
   | `BACKUP_S3_ENDPOINT` | `https://<account id>.r2.cloudflarestorage.com` |
   | `BACKUP_S3_BUCKET` | `dtp-db-backups` |
   | `BACKUP_S3_ACCESS_KEY_ID` | from step 1 |
   | `BACKUP_S3_SECRET_ACCESS_KEY` | from step 1 |
   | `BACKUP_HEARTBEAT_URL` | the `dtp-db-backup` ping URL |
   | `DISK_HEARTBEAT_URL` | the `dtp-disk` ping URL |

   The next deploy writes them to the box. Then run
   `sudo systemctl start dtp-backup.service && sudo dtp-backup verify latest` once, to
   see a real backup arrive and restore.
4. **Uptime.** Create an HTTP keyword monitor on any free external service (UptimeRobot
   and Better Stack both have one): URL `https://dtp.africa/api/v1/health/ready`,
   keyword `"db":"ok"`, every 5 minutes, alerts by email.
5. **Terraform. On hold since 17 October 2026; skip this step until applies resume.** (`alerts.tf`, `snapshots.tf`). Set `alert_email` in a tfvars file,
   then `terraform plan`. The plan must say only *to add* (an SNS topic and
   subscription, two alarms, an IAM role and attachment, a DLM policy) with
   **0 to change, 0 to destroy**. If it wants to change or replace anything that
   exists, stop. Apply, then click the confirmation link AWS emails to the address.

## Cost

| Item | Monthly |
|---|---|
| R2: dumps are about 1 MB today, under 1 GB for a long while (10 GB free) | $0 |
| healthchecks.io: 2 checks (free plan has 20) | $0 |
| External uptime monitor, free plan | $0 |
| CloudWatch: 2 alarms (first 10 free); SNS email (first 1,000 free) | $0 |
| EBS snapshots, 7 daily: incremental, about $0.05/GB-month for blocks actually used | about $1 to $3 |

## How this was tested (17 October 2026)

Locally, against a compose project shaped like staging: Postgres 16 holding a copy of
the dev database (81 tables, 13,581 rows), an `api` container holding a connection, an
S3 mock standing in for R2, and the script run from Ubuntu 22.04 with its packaged
`python3-boto3`, as on the box.

- `run`: dump, archive check, upload, size check, weekly promotion, heartbeat start
  and success.
- Retention: with 20 old daily and 10 old weekly objects planted, it kept exactly the
  newest 14 and 8, and the newest 2 local.
- Failures (no bucket configured, bucket unreachable, Postgres stopped): each exits 1
  and posts to `/fail` with the reason. With no bucket configured the local dump is
  still made.
- `verify latest`: restored 81 tables and 13,581 rows, matching the source table by
  table, and the scratch container was removed. A random file and a sha256 mismatch
  are both refused.
- `restore-live`: after a table was truncated, it restored the table's 3,474 rows, kept
  the damaged database beside it, took the safety dump first, and the `api`
  reconnected. A wrong `--confirm` changed nothing.
- The Ansible roles were applied to a systemd Ubuntu 22.04 container: both timers
  scheduled, `systemd-analyze verify` clean, the second run `changed=0`, and the disk
  check exits 1 over its threshold.

### The pre-deploy restore point (17 October 2026)

The same way, against a fresh copy of the dev database (81 tables, plus a planted
`_prisma_migrations` so the schema field is exercised):

- An empty database: *nothing to protect*, exit 0.
- `run --pre-deploy --release <tag>`: dump, archive check, upload to `pre-deploy/` with the
  release and latest migration recorded, local `pre-deploy-*.dump`. No heartbeat ping.
- Retention: with 13 planted under `pre-deploy/` it kept the newest 10 and the newest 3
  local. Three nightly runs alongside left `pre-deploy/` and the local pre-deploy copies
  alone, and the pre-deploy runs left `daily/`, `weekly/` and the nightly local copies
  alone.
- No bucket configured, or the bucket unreachable: the local copy is made, exit 0, with
  a warning. Postgres stopped: exit 1.
- With the lock held by a nightly run, it waited and then ran. The nightly still refuses
  to start while the lock is held.
- A bad migration (3,474 rows deleted, a migration recorded) was undone with
  `restore-live pre-deploy/...`: every row and the previous latest migration back.
  `verify latest` picked the pre-deploy dump as the newest, and a local pre-deploy file
  verifies as a `SOURCE`.
- The deploy role's two tasks, run by ansible-core: a deploy takes and reports the
  restore point; `run_migrations=false` and `pre_deploy_backup=false` skip it; with
  Postgres stopped the play fails at the dump and never reaches the migration.

## Human Approval Required

- `restore-live` on the live box.
- Dropping a kept `*_before_restore_*` database.
- Any Terraform apply.
- Changing the bucket token or the `dtp/staging/app` secret.
