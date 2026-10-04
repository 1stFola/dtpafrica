# 70 — The audit rows the gates left behind

The audit screen ([69](./69-AUDIT-TRAIL-SCREEN.md)) showed a developer's trail for the
first time, and nearly all of it was the gates': rows about models, jobs, datasets and
footage that a gate had made through the API and then deleted. Of 1,494 rows on the dev
database, 1,493 pointed at something that no longer existed.

Live is not affected. No gate runs there. This is about a developer's database, and
about CI's, which is thrown away.

It also found a hole in the guard that keeps gates off a live database. That is the
second section, and it is the part that matters more.

---

## Why the rows stayed

A gate makes things through the API. The API writes an audit row for each. The gate
then deletes the things, and the audit rows by a list of ids it kept:

```ts
prisma.visionAuditLog.deleteMany({ where: { targetId: { in: [...fx.modelIds, ...fx.jobIds] } } })
```

Every list missed some kind. Model **versions** were never in a list of model ids. The
end-to-end gate deleted its jobs and footage and no audit rows at all.

## The fix: ask whether the target exists

Keeping a better list in twenty-two gates would miss the next kind too. The question is
asked the other way round, of any row: **does its target still exist?**

- **`AUDIT_TARGET_MODELS`** in `gate-harness.ts` maps each of the twenty-two target
  kinds to its table. A test reads every `targetKind` the Vision module writes and fails
  if one has no table here.
- **`orphanedAuditRows`** returns the rows whose target is gone.
- **`closeGate(prisma)`** stands where `prisma.$disconnect()` stood in every gate. It
  removes the rows written since the gate started whose target the gate has removed,
  then lets the database go. A gate cannot clean up its fixtures and forget its trail,
  and a test fails if a gate disconnects by hand.
- **The end-to-end gate** also checks it: after cleanup, the trail holds nothing about
  the footage, the job or the workers it made.

**A person's row is kept.** On a developer's database a person removes things too: a
camera segment, an abandoned task. The row that says so is the trail doing its job. A
row is a gate's leavings only if its target is gone **and** no admin user who still
exists stands behind it. A gate's rows are the operator key's, a worker's, or a scratch
sign-in's that the gate has since deleted.

A row with no target, or of a kind the map does not know, is left alone. Not knowing
where a target lives is no reason to say it is gone.

## The purge

`db:purge:gate-litter` has a new last step that finds what earlier runs left, by the
same rule, and lists it by kind and action. It is a dry run unless `--apply` is given.

**It runs only on a database on this machine.** On live an audit row is meant to outlive
what it is about, so "the target is gone" is history there, not litter. The rest of the
purge goes by names only a gate uses and is safe anywhere. This step goes by absence,
which is not. It is skipped, with a line saying why, on any host that is not local, and
the gates' override does not switch it on.

---

## The guard took `postgres` for this machine

[61](./61-QA-FIX-11-GATES-CI.md) made every gate refuse a database that is not local.
Its list of local hosts included `postgres` and `db`, as "a container beside it".

The live API container reaches the live database as `postgres`. That is the service's
name in `infra/docker-compose.staging.yml`. So a gate run inside that container, which is
where the `db:*` scripts are run on live, passed the check. Its default API address,
`localhost:3000`, is the live API from in there.

Nobody did this. But the guard exists because gates once wrote into real matches, and it
did not cover the one place a gate could be run on live by habit.

`postgres` and `db` are no longer local. A compose service name says nothing about whose
database it is. A developer who runs gates inside a compose stack names the host:
`VISION_GATE_ALLOW_DB_HOST=postgres`. A test reads the live compose file's database host
and holds the guard to refusing it.

---

## Tests and checks

| Check | Result |
|---|---|
| API suite | 1,566 passed (was 1,557); typecheck clean |
| Mutation runner | 14 of 14 killed: the host list, a kind missing from the map, a row whose target exists, a person's row, the thousand-at-a-time lookup, a gate clearing rows from before it started, the purge on a database elsewhere, the purge honouring the override, a gate disconnecting by hand |
| All twenty-one API gates, twice | all pass, both rounds |
| `vision:e2echeck`, twice | 39 of 39 both times, with the new check |
| **The trail across those runs** | 1,494 rows before; 1,486 after the first round; 1,486 after the second; 1,486 after the end-to-end gate. Forty-four gate runs added nothing |
| The purge's delete path, on a throwaway database | seven rows planted: three gate rows removed (the operator key's, a worker's, a deleted sign-in's); four kept (target exists, a person removed it, unknown kind, no target). A second run deletes nothing |
| The purge on the dev database | dry run only: it lists 1,485 rows by kind. Not applied |

The eight rows that went in the first round were not counted one by one. The likely
reading: some gates reuse fixed-name fixtures and clear the last run's rows about them
when they start, so each run used to leave eight and remove the previous eight. Now none
are left, so the count dropped once and stayed.

## What is not done

| Item | Why |
|---|---|
| **The dev database's 1,485 old rows** | Deleting them is one command, and it is a developer's to run on their own database: `pnpm --filter @dtp/api db:purge:gate-litter -- --apply`. |
| **The per-gate id lists** | Still there. They are now redundant for rows whose target is deleted, and still remove rows by a scratch sign-in's id. Removing them is tidying. |
| **The API guard** | `assertDevDatabase` also checks the API's host. `localhost` inside the live container is the live API, and nothing can tell that from a hostname. The database check is what stops it now. |

## After merge

Nothing to deploy. CI's gates job runs every gate through `closeGate`.
