# 61 — QA fix 11: the gates and CI

PR-11 of the fix plan in [50](./50-QA-PHASES-1-6.md) §3. It covers the gate and CI
findings in appendix E. No API, schema or contract change: everything here is in
`services/api/scripts/` and `.github/workflows/ci.yml`.

A gate is a script that runs the control plane for real: a database, a booted API, HTTP.
There are twenty-two. Until this PR none of them ran anywhere but a developer's machine,
none checked which database it was pointed at, and one wrote goals into a match somebody
had recorded.

---

## A gate refuses a database that is not local

"Never production" was a comment at the top of a few gates. A gate run in a shell that
still had a live `DATABASE_URL` exported would have created partners, active admin
accounts and goals on live.

Every gate's `main` now begins with `assertDevDatabase` (`scripts/gate-harness.ts`). It
refuses, with exit 2, unless the database host is this machine (`localhost`, `127.0.0.1`,
`::1`, `host.docker.internal`, or a compose service called `postgres` or `db`). A gate
that calls the API holds the API's host to the same rule, because the API writes to
whatever database *it* was given.

To run a gate somewhere else on purpose, name the host:

```
VISION_GATE_ALLOW_DB_HOST=staging-db.example.com VISION_GATE_ALLOW_API_HOST=staging.example.com pnpm vision:clockcheck
```

The value has to equal the host. `=1` or `=true` allows nothing, so the override cannot
become a line in someone's profile. The refusal names the host and never prints the URL,
which carries the password.

`vision:r2check` has no database and is not covered. It writes to the bucket it is
configured for; dev and live sharing buckets is appendix E's separate finding, for
PR-12's runbook changes.

## Ctrl-C cleans up

Cleanup was in a `finally`. An interrupt skips it, so a gate stopped halfway left its
rows, including admin accounts that are active and hold every competition.

`onInterrupt(cleanup)` runs the gate's own cleanup on SIGINT or SIGTERM and exits 130. A
second Ctrl-C while it runs exits at once. Three gates had their cleanup inline in the
`finally`; it is now a function (`tidy`) so both paths call the same code. The two gates
whose work is one rolled-back transaction (`jobcheck`, `selfcheck`) need nothing: the
database rolls back when the connection drops.

The first version of this had a bug its test found: a separate "second signal" listener
ran on the *first* signal too, and ended the process before cleanup had done anything.
There is one listener now.

## A gate writes into no match but its own

The event gate took the first real match with squads and no goals, wrote up to six goals
into it, and afterwards put the score and the scorer's career and competition totals back
by hand. The clock gate wrote a substitution into a real match. Two more read real squads.

`createGateMatch` makes a competition, two teams, a match of 45-minute halves, squads on
both sides whose players are `Player` rows, and a second match for "a slot from another
match". `removeGateMatch` deletes all of it. The event, clock, identity, identity-metrics,
model and job gates use it. The event gate's last check changed with it: there is no score
to restore, so it checks that the match, its goals, its competition, its players and their
totals are gone.

Six gates still look up an existing match (`calibration`, `cuts`, `gamestate`, `team`,
`track`, `e2e`). They link their footage to it and write nothing to it. They also need the
object store, so they are not among the gates CI runs.

## The purge covers what a gate creates outside its partner

`db:purge:gate-litter` removed a gate's partner and footage. It did not know about:

| Left behind | Now matched by |
|---|---|
| Admin accounts | `gate-<label>-<run>@example.test`, the reserved domain and a run id |
| Models | `detector/`, `tracker/` or `identify/` + `gate-<run>` |
| Workers | the `mock` provider, holding no job |
| Goals and substitutions in a real match | `detail` exactly `gate-<run>`. The purge names the matches, because a goal that promotion created moved the score |
| A gate's own match | competition slug `gate-<run>` with the matching name; player slugs `gate-<run>-h1` and the like |

Each pattern is anchored and tested, mostly on the names that must *not* match. The
per-partner deletes are one transaction; a purge that died halfway used to leave a partner
with no footage.

Checked for real: the event gate was killed three seconds in, with no chance to clean up.
The dry run listed its fixture, its competition and two matches, eight players and three
active accounts. `--apply` deleted sixteen rows, a second dry run found nothing, and a
second `--apply` deleted nothing.

## Three gates had been failing

Nobody ran them, so nobody saw. Each was the gate's expectation, not the code:

| Gate | Was failing on | Because |
|---|---|---|
| `annotationcheck` (7 checks) | a submission refused with 400 | its boxes were `{x: 1, y: 2}`; a submission's boxes have been validated since the box format landed ([29](./29-PHASE-3-INCREMENT-2.md)) |
| `benchcheck` (2) | "a tracker cannot be benchmarked", and a missing `detections` param | a tracker can be benchmarked since [33](./33-PHASE-4-INCREMENT-2.md) (it is refused for having no track run), and the job's artifacts are `predictions` |
| `teamcheck` (1) | an unknown side with a kit named | an abstention carries the kit of the side it was nearest, on purpose, so a slice by kit holds abstentions too ([37](./37-PHASE-4-INCREMENT-6.md)) |

## CI runs gates

A new job, **Vision gates against a real database**: Postgres, the migrations applied to
an empty database, the RBAC seed, the API booted with Vision on and storage in memory, and
then `pnpm vision:gates:db`.

That script runs eight gates and then the purge's dry run, and fails if anything is left
behind:

`selfcheck`, `jobcheck`, `annotationcheck`, `modelcheck`, `clockcheck`, `identitycheck`,
`identitymetricscheck`, `eventcheck`.

The rule for the list (`DB_GATES` in `scripts/run-db-gates.ts`) is that a gate needs a
database and an API and nothing else. The other twelve put an artifact in the object store
for the API to read, or run the Python worker, or both. In-memory storage is per process,
so the API would not see what the gate wrote. They still run by hand.

The same job then runs the worker's **bootstrap entrypoint** against that API: the path
the staging box takes. It provisions itself with the admin key, registers, asks for work,
finds none, and retires, and must exit 0.

Two smaller additions to the existing jobs:

- The staging compose file is validated with `--profile vision`. Without the profile the
  worker's block was never read. The step also requires the bootstrap entrypoint, `init`
  and a memory limit to still be there.
- The bootstrap entrypoint is run with no configuration, in the `verify` job and inside
  the worker image, and must exit 2 naming what is missing. Under `restart:
  unless-stopped` anything else is a crash loop that a green deploy does not show.

`scripts/gates.spec.ts` reads every gate and fails if one does not begin with the
database check, lacks the interrupt hook, writes to a match without making its own, or is
in the CI list while depending on a match that already exists.

## Tests and checks

| Check | Result |
|---|---|
| API suite | 1,492 passed (was 1,470); typecheck clean |
| Web, contracts, worker | not run: nothing in them changed |
| Mutation runner | 30 of 30 killed. One more mutation survived at first because the clause it removed was redundant; the clause is deleted |
| All twenty gates that run without Docker, twice, on the dev database | all pass. `annotationcheck` 53/53, `benchcheck` 49/49 and `teamcheck` 52/52 are the three that were failing |
| `vision:e2echeck`, the real worker container | 38/38, with its cleanup now a function |
| `db:purge:gate-litter` after all of it | nothing to delete |
| A gate pointed at a remote database, and at a remote API | refused, exit 2, before any query |
| The CI job, simulated locally | an empty database built by `migrate deploy`, the RBAC seed, an API started with every value of the local `.env` blanked and storage in memory: `vision:gates:db` 9/9; the bootstrap provisioned, registered, drained and retired, exit 0 |
| The compose file with `--profile vision` | lists `worker`; renders the entrypoint, `init` and `mem_limit` |

**The CI job itself has not run on GitHub yet.** The local simulation is as close as I
could get; this PR's own CI run is the first real one.

## What is not done

| Item | Why | Where |
|---|---|---|
| The twelve gates that need the object store or the worker, in CI | They need a bucket two processes share. A MinIO service in the job would do it; it is a larger change than this PR | a follow-up |
| A real SIGINT against a real gate | Windows delivers Ctrl-C to a console only. The hook is tested with a child process that raises the signal itself | run one on Linux |
| `vision:r2check` held to the host rule | It has no database | PR-12, with the per-environment buckets |
| The six gates that link footage to an existing match | They write nothing to it. Giving each a gate match is mechanical | a follow-up |
| Worker rows from the `local` provider | The e2e gate removes its own; the purge matches the `mock` provider only, because `local` is what the staging box really uses | not planned |

## After merge

Nothing to deploy: no code that ships changed. The first CI run of the new job is on this
PR. To clear anything earlier gate runs left on a database:

```
pnpm --filter @dtp/api db:purge:gate-litter          # lists
pnpm --filter @dtp/api db:purge:gate-litter --apply  # deletes
```

The purge is not held to the local-host rule. It is dry-run by default and matches only
anchored names ending in a run id, and live had gate litter once.
