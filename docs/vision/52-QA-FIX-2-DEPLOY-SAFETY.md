# 52 — QA fix 2: deploy safety

PR-2 of the fix plan in [50](./50-QA-PHASES-1-6.md) §3. It covers critical C4, the
deploy and worker findings in appendix E, and the worker's signal handling in
appendix C. Fola agreed the migration path before any code was written: `migrate
deploy` as an explicit, forward-only deploy step.

---

## Migrations: once per deploy, forward only, never on rollback (C4)

The API image's `CMD` ran `prisma db push --accept-data-loss` on every start. That
included the automatic rollback, which starts the previous image. A rollback past a
schema change therefore dropped every table and column the newer release had added,
with their data. Today that would be `vision_event_candidates`, `vision_evidence_links`
and `sb_match_events.second_in_minute`.

Now:

- The `CMD` runs the squad-duplicate repair and `start`. It never touches the schema.
- A new script, `db:migrate:deploy`, is `prisma migrate deploy`.
- Ansible has a new step after the pull and before `up -d`:
  `docker compose run --rm --no-deps -T api pnpm --filter @dtp/api db:migrate:deploy`.
  It runs the new image's committed migrations against the live database. If it fails,
  the deploy stops and the old release keeps serving.
- The rollback passes `run_migrations=false`.
- `deploy.sh`, the manual path, runs `db:migrate:deploy` where it ran `db:push`.

Live was baselined on 3 October 2026, with every migration recorded, so the first
deploy under this applies only what is new. **From now on a migration reaches live this
way and no other.** Nobody runs `migrate resolve --applied` after a deploy any more.
Migrations should be additive, adding and never dropping or narrowing within one
release, so the previous image still runs after a rollback. PR-1's `token_kind`
migration uses `IF NOT EXISTS`. That keeps it safe even if PR-1 deploys under `db
push` and nobody records it before this deploy runs.

`infra/DEPLOYMENT.md` records the decision as done, marks the old "current state"
table superseded, and drops the hand-applied step from "Turning Vision on".

## The box checks out the deployed commit

Ansible cloned `git_branch`, which is the branch tip. The compose file could therefore
be newer than the images CI had verified and built, and a rollback re-checked out the
same tip. CD now passes `git_version=${DEPLOY_SHA}`. A rollback passes the restored
tag, and tags are commit SHAs. The role uses `git_version | default(git_branch)`, so a
manual run is unchanged.

## The worker survives being stopped

- **SIGTERM.** The worker was PID 1 with no handler, and PID 1 ignores SIGTERM by
  default. Every deploy changes the worker's image tag, so `up -d` waited 10 s and
  SIGKILLed it. The job in hand was lost, `retire` never ran, and the worker row went
  stale. `__main__` now installs a handler that raises `WorkerTerminated`, a
  `BaseException` that `except Exception` cannot swallow. `run_one` fails the job in
  hand as retryable (`worker_terminated`) and re-raises. `subprocess.run` kills FFmpeg
  on the way out, the work dir is removed, `main` returns 0, and `bootstrap` retires
  the row.
- **Compose.** The worker gets `init: true`, so an init forwards the signal and reaps
  FFmpeg, and `stop_grace_period: 60s`.

## Limits on a 2 GB box

The worker gets `mem_limit: 768m` and `cpus: "1.0"`. `VISION_FFMPEG_THREADS=2` adds
`-threads 2` to the transcode's decoder and encoder (`media.ffmpeg_threads()`). The
thread cap is a resource choice, not part of the recipe, so `settings_hash()` does not
change and no proxy is invalidated.

The work dir moves from a 2 GB tmpfs, which was RAM on a box with 2 GB, to a named
volume, `dtp_staging_vision_work`. The image creates `/var/lib/dtp-vision` owned by
`worker`, so a new volume is writable. The worker empties the directory after every
job.

**A real match master still needs disk.** The root volume is 20 GiB, and the
deploy already refuses to pull with less than 4 GB free. Growing it to the planned
100 GiB (appendix F) is now a prerequisite for the first full-match transcode on the
box. That is Fola's, not code.

## The deploy checks the worker

When Vision is on, the deploy now waits up to 180 s for the `worker` service to be
running and to log `provisioned worker`. If it doesn't, the deploy prints the
worker's last 60 log lines and fails, which triggers the rollback. A worker that
cannot provision exits 2. Before this change, `restart: unless-stopped` looped it
forever behind a green deploy.

## `VISION_ENABLED` read one way

The API reads 1, true or yes, in any case. The template switched the worker's profile
on only for the exact string `true`, so `True` from a JSON boolean turned the API on
and left the worker off. A `vision_on` fact now uses the API's rule. The template and
the new tasks read it, and PR-1's secrets step already writes booleans in lower case.
Turning Vision off now also stops a running worker (`--profile vision stop worker`).
Before, `up -d` with the profile inactive left it polling.

## Smaller things in the same files

- An empty `VISION_PROVISION_WAIT_SECONDS` is unset. It used to raise in `float("")`
  and send the worker into an exit-2 restart loop.
- An empty or non-numeric `VISION_RUNPOD_DISK_GB` is unset. `Number("")` was 0, a pod
  with no disk.
- `cd.yml` permissions drop to `contents: read`. Nothing pushes now that the Terraform
  state branch is commented out, and the token lands in the box's clone.

## Tests and checks

| Check | Result |
|---|---|
| Worker pytest | 259 passed. New: SIGTERM mid-job fails the job as retryable and re-raises; it still stops when reporting fails; `main` installs the handler and returns 0; the thread cap; empty provision wait. Mutation: drop the `WorkerTerminated` branch → fails |
| API vision suite | 745 passed; empty RunPod disk size reads as 60 |
| `pnpm typecheck` | clean |
| `ansible-playbook --syntax-check` | passes, in a throwaway container with the pinned collections |
| `vision_on` and the env template | Ansible run in a container: `true`, `True`, `1`, `yes` and a boolean read as on; `""`, `false`, `0` as off; `COMPOSE_PROFILES` renders `vision` and empty |
| `docker compose --profile vision config` | renders `init`, `stop_grace_period: 1m0s`, `mem_limit`, `cpus`, the volume and the thread cap |
| The migrate step in the real image | API image built locally; `pnpm --filter @dtp/api db:migrate:deploy` inside it against a scratch database: 32 applied, then "No pending migrations" on the second run; the image's `Cmd` has no `db push`. Scratch database dropped |
| The worker image | built; a new named volume at `/var/lib/dtp-vision` is owned by and writable as `worker`; `docker stop` on a worker under `--init` returns in 1 s (exit 143) instead of waiting out the grace period |

## The first deploy

The deploy of #211 (CD run 37149315798) ran the new step through `docker compose run
… pnpm --filter @dtp/api db:migrate:deploy`. The migration applied:
`20261003180000_vision_worker_token_kind`, then "All migrations have been successfully
applied." But the process never exited. `timeout 600` killed it (rc 124), the
playbook failed, and the rollback put back the previous image. The site answered
throughout, and the rollback's health check passed.

It did not reproduce locally. The same image and command, with stdin held open as
Ansible leaves it, returned in 9 s. So the step now removes everything between Ansible
and Prisma:

- `docker run` on the project network instead of `docker compose run`;
- the Prisma binary as the entrypoint instead of the `pnpm` wrapper and its update
  check;
- `CHECKPOINT_DISABLE=1` for Prisma's telemetry ping;
- stdin from `/dev/null`;
- `timeout --kill-after=15 300`.

A step before it removes any `dtp-staging-api-run-*` container a killed run left
behind. `DATABASE_URL` reaches the container through the task's `environment`, as a
bare `-e DATABASE_URL`, so it is on no command line and in no log. Locally, against a
throwaway compose project, the new command applied 32 migrations to an empty database
in 5 s, found nothing pending on a re-run in 3 s, and failed in 10 s with `P1001`
against an unreachable host.

## What is not done

| | |
|---|---|
| **The root volume** | Done since, on 4 October 2026: 100 GiB. As listed: 20 GiB; a full-match master needs it grown. Fola's. |
| **A provision-only key** | Done since, in [67](./67-QA-FIX-17-PROVISION-KEY.md). As listed: still the admin key; [51](./51-QA-FIX-1-SECRETS.md). |
| **The first deploy** | `cd.yml` and the role only take effect on `main`. Watch the first deploy: the new "Apply database migrations" step should report no pending migrations, or apply only `token_kind` if PR-1's deploy was not recorded. |
