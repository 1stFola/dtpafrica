# FairPlay — backup and restore

Increment 6.2 of the plan ([phase-plan.md](./phase-plan.md)): how to back up the Edge, how to
bring it back on a clean machine, how the cloud's FairPlay tables come back, and what a restore
must not bring back.

## Back up the Edge

From `services/fairplay-edge`, with the Edge running. A match may be on: the database copy is
SQLite's online backup, and it took about 2 s beside two synthetic feeds.

```bash
sudo deploy/backup.sh /mnt/fairplay-backups
```

Each file is written 0600:

| File | Holds |
|---|---|
| `fairplay-edge-<stamp>.tar.gz` | the database, manifests, evidence clips and their manifests, `tls/` with its private keys, loose files such as the bundle and a device token kept in the data folder, and `BACKUP.json` listing every file's SHA-256 |
| `fairplay-edge-<stamp>-config.tar.gz` | this host's `.env`, `publish.env`, `config/sources.toml` and `auth/`: every secret the Edge has |
| `fairplay-edge-<stamp>.sha256` | both files' hashes |

**Not in a backup:** recordings, repaired copies, export packages, and the database copies
`update.sh` leaves in `backups/`. Recordings are about 1.1 GB per camera-hour and kept 14 days. If
the disk is lost, they are lost. The clips, manifests and hashes survive, so a recording
recovered later can still be proved against its manifest.

### Rules for the person holding the backups

1. **An encrypted disk, not the Edge's own.** A backup holds clips and the Edge's private keys,
   and this software does not encrypt it (R23). Treat the disk as you treat the Edge (D12).
2. **After each match and each withdrawal, take a new backup.** What happened after the last
   backup is what a restore loses.
3. **After a withdrawal, destroy every older backup.** They still hold the clip. The Edge cannot
   reach them. Nothing here enforces this rule: it is on the custodian.

## Restore on a clean machine

```bash
deploy/install.sh --label <venue> --lan-ip <ip> ...     # as for any new machine: edge-install.md
sudo deploy/restore.sh /mnt/fairplay-backups/fairplay-edge-<stamp>.tar.gz \
  --config /mnt/fairplay-backups/fairplay-edge-<stamp>-config.tar.gz
```

Never during a match: it stops recording. The script checks the `.sha256`, puts the stack in
maintenance, stops it, puts the configuration back (keeping the image tag this machine built),
restores, starts the stack, waits for it to be healthy, and ends maintenance.

The Edge checks everything **before it changes anything**: every file against its hash, no
file unlisted, the database's integrity, a schema this release can read. An older database is
migrated up. A newer one is refused: install that release first.

| Exit | Means | The stack |
|---|---|---|
| 0 | restored and sound | running |
| 2 | refused: damaged, not a backup, or this Edge already holds a record | as it was; nothing in the record changed |
| 1 | restored, but not sound or not healthy | left in maintenance for a person; the watchdog leaves it alone |

To restore over an Edge that holds a session, an incident or a clip, add `--replace`. Its record
moves to `data/backups/before-restore-<stamp>-*/`. A clip withdrawn later is removed from there
too. Delete that folder once you are satisfied: it holds footage, and retention does not touch it.

### What you will see afterwards

`fairplay-edge restore-verify` prints the audit chain's state, damaged files, withdrawn clips and
counts.

- **`restore_unchecked` (warning), and no clip can leave.** See the next section.
- **`segment_missing` (critical) for each camera, on a new disk.** True: those recordings are not
  here. `recordingsNotHere` counts them. Acknowledge them after recording the restore.
- **`verify-all` exits 1,** with `missing` equal to that count. A `mismatch` or `corrupt` is not
  explained by a restore: look into it.
- **A clip cannot be cut from a recording that is gone.** Clips already cut are in the backup.

## A withdrawn clip must not come back

A clip withdrawn after a backup was taken is back on disk after a restore, with no withdrawal
row. The cloud would never say so by itself: it lists only the withdrawals an Edge has not
confirmed, and this one was confirmed. So a restore leaves `restored.json` in the data folder, and
while it is there:

- no clip can be read, approved, exported or uploaded (`409 restore_unchecked`);
- the next time the Edge reaches the cloud, it asks for **every** withdrawal of its clips
  (`GET /device/withdrawals?all=1`), removes each one again, and only then opens the gate. It does
  not send a second confirmation, which the cloud would call a conflict.

It stays shut if the cloud knows a clip this Edge holds under another hash: that is a person's to
settle. A clip the backup never held does not keep it shut. The marker survives a restart.

**With no cloud to ask:** a person may accept the risk. It goes in the audit chain, so give the
reason and name no player or requester.

```bash
docker compose exec -T edge fairplay-edge restore-accept --by "<your name>" --why "<why>"
```

Check the request records first. **A withdrawal made at the venue and not yet synced when the disk
failed cannot be recovered by anyone's software.** The cloud never heard of it. That is why a new
backup follows each withdrawal. Withdraw that clip again by hand.

## After a restore to an older point

The cloud holds what the Edge sent after the backup, and nothing is overwritten:

- Items already sent are answered `replayed`, which is harmless.
- **New audit entries collide.** The restored chain carries on from the backup's last number, and
  the cloud already holds those numbers with other content. They are parked with an `outbox_parked`
  critical alert. In the live test these were audit entries only. The Edge's chain verifies, and
  the cloud keeps what it first received. Parked items cannot be re-sent without a developer (R12).
- Edits to a session or incident the cloud holds at a higher version are answered `stale` or
  `conflict`, so review the session's record after any restore to an older point.

This is R24. A backup after each match makes the seam small.

## The cloud's FairPlay tables

There is no separate FairPlay backup, and none is needed. `infra/backup/dtp-backup.py` dumps the
whole database nightly and before each deploy, `fairplay_*` included
([the support playbook](../support-playbook/database-backup-and-restore.md)). Restoring only the
FairPlay tables is not offered: they refer to `sb_matches` and `admin_users`.

`fairplay:restorecheck` proves that dump works for these tables, on throwaway databases only. It
dumps as the nightly job does, restores into a new database in one transaction, compares every
`fairplay_` table row by row, and checks that the triggers still refuse to change an audit row or
delete a withdrawal.

```bash
FAIRPLAY_CHECK_DATABASE_URL=postgresql://…/fp62_scratch pnpm --filter @dtp/api fairplay:restorecheck
```

Run `fairplay:cloudcheck` on that database first, so there is something to compare. On the live
database, the drill stays `sudo dtp-backup verify latest`.

**A live restore goes back in time.** It needs approval (the playbook), and for FairPlay:

- A withdrawal made after the dump loses its row. The clip stays deleted from the bucket and the
  Edge, but the cloud's record no longer says so, and its request page shows the clip as held. **Note
  the withdrawals since the dump before restoring, from the request page or the logs, and
  withdraw those clips again afterwards.** The bucket delete and the Edge will find nothing to do.
- Evidence objects deleted by retention since the dump are listed as stored, and are not there.
- Edges have already sent what they hold and do not send it again, so items the dump predates stay
  missing until a developer resets them (R12, R24).

## Tested (31 Oct 2026)

On this laptop's Docker with synthetic feeds and local images only. **Not on a venue machine, and
not after a real disk failure.** The clean machine was a second Compose project, with the first
taken down and its volumes unused. systemd played no part.

A one-off script drove it, and all 40 of its checks passed.

- **Backup while recording:** 2.1 s, 9.7 MB, 14 files. Two clips cut and one withdrawn beforehand:
  the archive holds the remaining clip and no recordings.
- **Restore on a clean install that was already recording:** 14 s; session, evidence and hashes
  back, the audit chain verified, settings back from `--config`, recording resumed.
- **Gate:** the clip withdrawn before the backup answers 410. The clip withdrawn after it answers
  409, as does its export. `restore-accept` opens the gate and is in the chain. The gate holds
  through a restart.
- **Refusals (exit 2, stack running, record intact):** a second restore without `--replace`, and an
  archive with one byte changed. `--replace` set the old record aside.
- **Against the real cloud API** (`fairplay:e2echeck`, 42 of 42): restored from before a cloud
  withdrawal, the clip came back, the gate shut, the cloud's full list removed it, no second
  confirmation was sent, and only audit entries were parked.

The run found three faults, each fixed: a new install already recording counted as "holds a
record", so a clean restore was refused; `.sha256` lookup assumed one output format of
`sha256sum`; and `tar -f` read a Windows path as a remote host.

| Check | Result |
|---|---|
| Edge suite, with docs | 349 passed, 1 skipped (the live e2e, which the API script runs) |
| `fairplay:cloudcheck` | 108 of 108 |
| `fairplay:e2echeck` | 42 of 42 |
| `fairplay:restorecheck` | 30 of 30: 13 tables, identical row by row, triggers refusing |
| `fairplay:securitycheck` | 53 of 53 |
| API `vitest` and `tsc` | 27 passed; clean |

**Not tested:** a real disk failure; a real external or encrypted disk; `sudo` and a Linux host's
file ownership; a backup of a full match's size; `dtp-backup verify` itself against these tables
(it needs the R2 bucket or a local dump, and pulls a Postgres image).

## Handover for 6.2 (prompt pack section K)

```text
DTP FAIRPLAY | PHASE 6.2 DELIVERY
STATUS: complete on this laptop's Docker with synthetic feeds; not run on a venue machine

REPOSITORY FACTS CONFIRMED
- Existing patterns used: update.sh's SQLite online backup; maintenance mode; infra/backup/dtp-backup.py's dump format, which already covers the cloud's tables
- Hardware facts actually verified: none
- Unknowns remaining: the venue machine and its backup disk; a backup's size for a full match

IMPLEMENTED
- Code paths changed: fairplay_edge/backup.py, deploy/backup.sh, deploy/restore.sh (new); CLI backup, restore, restore-verify, restore-accept; evidence.py and api.py (the gate); cloud.py and service.py (every withdrawal after a restore); services/api requests.service.ts, fairplay-device.controller.ts (?all=1); scripts/fairplay-restore-check.ts (new)
- APIs and migrations: GET device/withdrawals?all=1, with origin and edgeConfirmed on each item; alert restore_unchecked; audit actions edge.restored, edge.restore_checked, edge.restore_accepted; no migration
- Local/Cloud config: none new

SECURITY + COST
- Auth and evidence changes: no clip leaves a restored Edge until the cloud has answered or a person has accepted, in the audit chain; a backup is refused whole if any file fails its hash; archive paths, links and device files refused; a withdrawal also removes a set-aside copy
- New dependencies and license: none (Python standard library; bash, tar, gzip, sha256sum on the host)
- New recurring cost: $0

TEST EVIDENCE
- Commands actually run: see "Tested" above
- Passed / failed / untested: all passed as listed; three faults found and fixed on the way; a real disk failure, a Linux host and a full match's size untested
- Measured replay/CPU/RAM/SSD outcomes: backup 2.1 s for 9.7 MB, restore 14 s, on synthetic feeds; not a venue measurement

RISKS, ROLLBACK, NEXT GATE
- Blocking defects: none found
- Steps to revert safely: revert the commit; backups taken stay readable by tar; a restored Edge's restored.json would then be ignored, so finish its check first
- Human approvals required: decisions on new risks R23 and R24; R19 (encrypted disk, custodian) before real footage; a live restore-live as the playbook says
- Proposed next phase: 6.3, operator procedures
```
