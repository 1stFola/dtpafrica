# 16 — Phase 1, Increment 1: the job spine

The queue, the worker API, and the credential model everything else hangs off.
**Gate: PASS** — `pnpm --filter @dtp/api vision:jobcheck` reports 23/23 against
real Postgres and real R2.

---

## What shipped

### The queue — Postgres, behind a port

`JobQueue` is the port; `PostgresJobQueue` claims with
`UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`. `SKIP LOCKED` is
what makes concurrent pollers safe: each transaction locks a different candidate
instead of queueing behind the same one. Ordered by priority then age, so a
hand-raised job jumps the queue but equal-priority jobs stay FIFO.

The port exists so moving to Redis/BullMQ is a swap rather than a rewrite. The
trigger is measured queue latency, not a hunch — see
[01-ARCHITECTURE](./01-ARCHITECTURE.md#queue-postgres-not-redis).

### The worker API

```
POST /vision/worker/register            bootstrap token -> worker token
POST /vision/worker/jobs/claim          one job, or { job: null }
POST /vision/worker/jobs/:id/heartbeat
POST /vision/worker/jobs/:id/presign    one write URL, prefix-validated
POST /vision/worker/jobs/:id/complete   idempotent
POST /vision/worker/jobs/:id/fail
```

Two-stage credentials. `mintBootstrap` creates the worker row and a one-hour
token, injected into the container's environment at launch; `register` exchanges
it for a longer-lived worker token **and rotates the stored hash**, so a launch
spec recovered from provider logs cannot register a second worker. Tokens are
SHA-256 at rest and compared in constant time. Unknown and expired tokens return
the same message — a worker has no business learning which it was.

### The security property this increment exists for

**A worker cannot choose where its output lands.** It holds no storage
credential, so every write goes through `presign`, and the control plane
validates the requested key against that job's own `outputPrefix` *and* routes
the bucket from the job type via `OUTPUT_BUCKET_BY_JOB_TYPE`. A worker never
writes to `master`.

Refused, with tests for each: traversal out of the prefix, a sibling attempt's
prefix, another job's prefix, the bare prefix itself, a worker that does not hold
the job, and any write after the job has finished. `complete` re-validates every
artifact path it is told about — a worker reporting an artifact it was never
allowed to write is broken or lying, and either way the claim is not recorded.

This matters more than it would with versioning available: R2 has none
([05-STORAGE](./05-STORAGE.md)), so a write into `master` could not be undone.

### Separation from admin auth

`VisionWorkerGuard` reads `x-vision-worker-token` and shares no code path with
`AdminAuthGuard`. It ignores `Authorization` entirely, so a proxy that helpfully
forwards an admin bearer token cannot satisfy worker auth. Verified against the
running API in all three directions:

| Request | Result |
|---|---|
| Worker endpoint, no token | 401 |
| Admin endpoint with a worker token | 401 |
| Worker endpoint with the admin API key | 401 |

### Orchestration

`VisionJobsService.enqueueForAsset` gates in cost order, cheapest refusal first:
the asset exists and is linked to a fixture, then `canAnalyze` is granted *now*,
then every prerequisite stage has already succeeded. Without the last check a
`track` job would claim, find no detections, and burn an attempt — or a GPU
minute.

Operator endpoints: list, get, events, queue depth, retry, cancel, plus
`POST /vision/workers/provision`, which launches capacity through the configured
`ComputeProvider` and returns the bootstrap token exactly once.

### Retry and reaping

A retry is a new attempt writing to a **new output prefix**, so a failed
attempt's artifacts survive for debugging rather than being overwritten.
`reap()` handles the two ways a job stops being viable without reporting it:
a stale heartbeat (requeued if attempts remain) and a breached budget (terminal,
because re-running would breach the same budget).

---

## Gate evidence

`vision:jobcheck` drives one job through the real queue and writes a real
artifact to real object storage, inside a transaction that rolls back and with
the object deleted afterwards. 23 checks, including:

- bootstrap token cannot be replayed
- a foreign worker cannot heartbeat a job it does not hold
- traversal keys rejected; artifact round-trips through storage
- first completion applies, repeat is a no-op
- job log reads `queued > claimed > running > succeeded`
- a retryable failure requeues, advances the attempt, and changes the prefix

```
api tests                 207 passed  (was 183)
vision-contracts           22 passed
vision:selfcheck         27/27
vision:r2check           11/11  (live R2)
vision:jobcheck          23/23  (live Postgres + live R2)
typecheck                 clean, 6 projects
```

---

## A bug worth recording

Every Vision service that injected `PrismaService` by reflected type alone was
**broken at runtime** — `this.prisma` was `undefined`. It never showed up because
`RightsPolicyService` and `VisionAuditService` had only ever been constructed
directly in tests and scripts, never resolved through Nest's container. The first
HTTP request that touched one returned a 500.

The fix is explicit `@Inject(PrismaService)`, which is what 30 other files in this
service already do. Mixing `@Inject(SYMBOL)` parameters with reflected ones is
what breaks it.

**Lesson for later increments:** a service that is only ever exercised by unit
tests with hand-built constructors has not been proven to start. `vision:jobcheck`
constructs through the same path the container does, which is why it caught this.

---

## Not in this increment

| Deferred | Note |
|---|---|
| Scheduling `reap()` | Implemented and callable; not yet on an interval. The dispatcher lands with the worker. |
| `services/vision-worker` | The Python container: probe, fingerprint, transcode. Next. |
| Resumable upload endpoints | With the interruption test as its gate. |
| Source catalog + rights screens | `/admin/vision/sources`. |
| Second hosted compute provider | Written to prove the abstraction holds. |
