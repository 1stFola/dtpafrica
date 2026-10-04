# 65 — QA fix 15: the rest of the gates in CI

[61](./61-QA-FIX-11-GATES-CI.md) put eight gates in CI and left twelve that "still run by
hand", because they need an object store the gate and the API both see.
[62](./62-QA-FIX-12-DOCS.md) listed that as a follow-up. This does it. Nothing that ships
changes: this is `services/api/scripts/` and `.github/workflows/ci.yml`.

CI now runs **twenty-one of the twenty-two gates** on every pull request.

---

## One store for two processes

A gate such as `vision:trackcheck` writes a track artifact into the store and then asks
the API for the positions in it. In CI storage was in memory, which is per process: the
API never saw what the gate wrote.

The API's storage backend is R2 through the S3 protocol, with a configurable endpoint. CI
now runs an S3 server beside Postgres and points both the API and the gates at it:

| | |
|---|---|
| Server | `adobe/s3mock:5.2.3`, as a service container on port 9090 |
| Buckets | four, created at start from an environment variable |
| Credentials | none to manage. The mock accepts any pair; the two values the API's configuration requires are generated per run and masked |
| Backend | `VISION_STORAGE_BACKEND=r2`, `VISION_R2_ENDPOINT=http://localhost:9090` |

**Why this image.** The plan in 61 named MinIO. Its images are no longer published:
`minio/minio` is gone from Docker Hub and its own registry refuses anonymous pulls. Of
three alternatives that could be pulled, S3Mock is the one built for tests: it needs no
command line, so it runs as a service container, and no credentials. It is pinned to a
version, so a gate's result does not change when somebody else publishes an image.

**What it does and does not prove.** The mock checks no signature and keeps nothing after
the job. The gates prove the control plane's own logic: which key a job may write, that a
master is written once, that a presigned URL is for the proxy and not the master, that an
upload resumes. They do not prove anything about Cloudflare R2 itself. `vision:r2check`
run against real R2 from a developer's machine still does that.

## No gate depends on a match that already exists

Six gates looked up the first match in the database to link their footage to
(`calibration`, `cuts`, `gamestate`, `team`, `track`, `e2e`). They wrote nothing to it, but
CI's database is empty, so they could not run there. They now make their own with
`createGateMatch`, as the other gates have since 61, and remove it.

`gates.spec.ts` no longer has a list of gates allowed to look a match up. Any gate that
does fails the test.

## The lists

`run-db-gates.ts` has two lists and one command for each:

```
pnpm --filter @dtp/api vision:gates:db   # 8: a database and an API
pnpm --filter @dtp/api vision:gates:ci   # 21: those, and 13 that need the store
```

The second refuses to start when storage is in memory, and says why. It ends, as before,
with the purge's dry run, and fails if any gate left a row behind.

The thirteen store gates: `r2check`, `uploadcheck`, `catalogcheck`, `datasetcheck`,
`boxcheck`, `benchcheck`, `promotioncheck`, `trackcheck`, `trackmetricscheck`,
`teamcheck`, `calibrationcheck`, `cutscheck`, `gamestatecheck`. Seven run the worker's own
Python for the arithmetic they check; CI installs the worker before the gates and names
the interpreter in `VISION_WORKER_PYTHON`.

**The one gate not in CI** is `vision:e2echeck`. It runs the worker's container. The
image takes minutes to build, and the container would have to reach the store by a
hostname other than the one the gate uses. The test names it as the one exception, so a new gate has to be
put in a list or named there with a reason.

## Tests and checks

| Check | Result |
|---|---|
| API suite | 1,522 passed (was 1,519); typecheck clean |
| Mutation runner | 8 of 8 killed, after one test was tightened: it accepted a gate that only mentioned the Python variable in an error message |
| **The CI job, rehearsed locally** | an empty database built by `migrate deploy`, the RBAC seed, the same `adobe/s3mock:5.2.3` image, an API started with every value of the local `.env` blanked: `vision:gates:ci` **22/22** (21 gates and the left-behind check) |
| The runner on in-memory storage | refuses, exit 2, with the reason |
| The six converted gates on the dev database with real R2, twice | all pass |
| `vision:e2echeck`, the real worker container, with its own match | 38/38 |
| `db:purge:gate-litter` | nothing to delete |
| The workflow file | parses; the job has both services and the steps in order |

**The changed CI job has not run on GitHub yet.** The rehearsal used the same image, the
same commands and an empty database, on Windows; this PR's own CI run is the first on
Linux. The previous version of the job passed first time on the same footing.

## What is not done

| Item | Why | Where |
|---|---|---|
| `vision:e2echeck` in CI | It needs the worker image built in the job and the store reachable from inside the container | a job of its own, on `main` pushes, beside the worker-image job |
| The gates against real R2, on a schedule | The mock proves the control plane, not the provider. A nightly run with real buckets would need per-environment buckets first ([62](./62-QA-FIX-12-DOCS.md)) | after the buckets are separated |
| A health check on the mock's service container | The image has no shell tool to probe with; a step waits for it to list its buckets | fine as it is |
| The job's time | About twenty gates in sequence; the rehearsal took a few minutes locally | split into two jobs if it grows |

## After merge

Nothing to deploy. To run the full set locally you need an S3-compatible store; the
simplest is the same image:

```
docker run -d -p 9090:9090 -e COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=gates-master,gates-derived,gates-models,gates-clips adobe/s3mock:5.2.3
```

with the API and the shell both given `VISION_STORAGE_BACKEND=r2`,
`VISION_R2_ENDPOINT=http://localhost:9090`, the four `VISION_R2_BUCKET_*` names and any
two values for the key pair. Running one gate against real R2, as before, needs none of
this.
