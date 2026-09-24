# 01 — Architecture

## The three planes

| Plane | Runs on | Owns | Must never |
|---|---|---|---|
| **Control plane** | Existing AWS EC2 (`t3.small`, 2 vCPU / 2 GB) | Web app, API, Postgres, metadata, rights, job coordination, signed-URL issuance, review decisions | Proxy video bytes, transcode, run inference |
| **Data plane** | Cloudflare R2 (S3-compatible) | Source masters, proxies, HLS, thumbnails, crops, clips, dataset manifests, inference artifacts, model weights | Be addressed by Cloudflare-specific calls from domain code |
| **Compute plane** | On-demand GPU/CPU workers (RunPod default) | Transcode, detection, tracking, calibration, events, clip rendering, training | Hold long-lived R2 credentials or a Postgres connection |

The control plane is small on purpose and stays small. Everything heavy happens somewhere else.

## Data path

```
Partner / DTP Admin
      |
      | 1. register source (metadata only)  ---------> Control plane (EC2)
      | 2. attach rights evidence                          |
      | 3. request upload  <-- signed multipart URLs ------+
      |
      v 4. direct resumable multipart PUT (bytes never touch EC2)
Cloudflare R2
      |
      | 5. finalize -> checksum, fingerprint, duplicate cluster  --> Control plane
      | 6. job enqueued (Postgres)
      v
On-demand worker (RunPod, Lambda fallback)
      |  claim -> heartbeat -> progress -> presign-write -> complete
      |  reads source/proxy from R2, writes artifacts to R2
      v
R2 artifacts  +  Control plane structured outputs
      |
      v
Human review --> Approved evidence --> Player profiles / ScoreBoard / Rating Engine / Scout search
```

The critical property: **step 4 and all worker R2 traffic bypass EC2 entirely.** EC2 sees job
records and small JSON, never a multi-GB body.

---

## Conformance to Architecture Freeze v1

This documentation set implements the frozen architecture from the Infrastructure Handoff (§12)
without deviation. The mapping, box by box:

| Freeze v1 | Here | Where |
|---|---|---|
| DTP Africa on AWS EC2 — web, API, DB, ScoreBoard, player profiles | Control plane, unchanged. Vision is a module inside the existing API. | This document |
| Job request → **DTP Job Queue** | `vision_jobs` table in the existing Postgres, claimed with `SKIP LOCKED`, behind a `JobQueue` interface | [06](./06-JOBS-AND-COMPUTE.md#the-queue) |
| Cloudflare R2 — raw video, datasets, annotations, models, clips, results | Same contents, regrouped into 4 buckets by access and retention policy rather than 6 by content type | [05](./05-STORAGE.md#buckets), [02 D2](./02-DECISIONS.md#d2--bucket-layout) |
| RunPod GPU — Docker, CUDA, PyTorch, Vision Engine | `services/vision-worker`, one OCI image, behind `ComputeProvider` | [06](./06-JOBS-AND-COMPUTE.md#the-worker-container) |
| Vision results → Cloudflare R2 | Artifacts written to `derived/inference/{jobId}/{attempt}/` | [05](./05-STORAGE.md#key-scheme) |
| → DTP API | Worker posts a structured summary on `complete`; bulk artifacts stay in R2 | See refinement 1 below |
| → Player Profiles / ScoreBoard / Rating Engine / Scout Intelligence | Versioned outbound contracts plus an explicit promotion step, gated on human review | [07](./07-API-CONTRACTS.md#outbound-contracts) |
| RunPod unavailable → Lambda Cloud | `LambdaCloudProvider`, written in Phase 1. Failover is manual and observable in V1. | [06](./06-JOBS-AND-COMPUTE.md#failover), [02 D3](./02-DECISIONS.md#d3--fallback-gpu-provider) |

### Three refinements the diagram does not resolve

The freeze fixes the topology. These are the places it leaves a choice that had to be made, and
where getting it wrong would break the "EC2 never touches video" property the freeze exists to protect.

1. **Results do not flow back through EC2.** The diagram's `Vision Results → R2 → DTP API` arrow
   is read here as: the worker writes artifacts to R2 and posts a *small structured summary* to
   the API. The API never reads bulk artifacts out of R2 — the review UI fetches Parquet directly
   via signed URL. If the API pulled results from R2, EC2 would become a data-plane hop, which is
   exactly what the freeze is trying to prevent.

2. **The upload path is a separate flow the freeze diagram omits.** Browser or partner uploads go
   **direct to R2** with signed multipart URLs; EC2 issues the URLs and records metadata. This is
   §5 and §11 of the Handoff, and it is the flow that makes the `t3.small` viable.

3. **Not every job needs a GPU.** Transcode, fingerprinting, and clip rendering are CPU-bound and
   run on a cheap `cpu_small` worker class in the same queue. Routing FFmpeg to a GPU pod would
   mean paying GPU rates for work that does not use the GPU — see [Where transcode runs](#where-transcode-runs).

---

## Why the control plane stays NestJS, not FastAPI

The PID recommends Python FastAPI for the API tier and instructs Phase 0 to "create
`services/api` (FastAPI)". **DTP already has `services/api` — a NestJS 10 application with 217
TypeScript files, roughly 250 routes, Prisma 6, and the entire football graph.** Creating a
FastAPI service at that path would collide with it. Running it alongside would fork auth, RBAC,
and the player/match schema across two languages and two connection pools on a 2 GB box.

The Master Prompt's own rules 1 and 2 settle it: inspect first, reuse working components,
preserve working DTP behaviour, implement the least disruptive compatible design.

**Ruling:** the control plane is the existing NestJS app. Python lives only where it earns its
place — inside the worker container, which is where the CV ecosystem actually is.

See [02-DECISIONS.md, D1](./02-DECISIONS.md#d1--control-plane-language).

---

## Module layout

Added to the existing monorepo. Nothing is moved.

```
services/api/src/vision/            NEW - NestJS control-plane module
  vision.module.ts
  sources/                          partner catalog, rights evidence, acquisition
  assets/                           video assets, variants, upload sessions, fingerprints
  jobs/                             job queue, claim/heartbeat/complete, cost roll-up
  worker/                           worker-facing API (separate guard, separate token)
  datasets/                         dataset versions, members, splits, leakage checks
  models/                           model registry, benchmark runs, promotion
  review/                           annotations, review decisions, corrections
  evidence/                         detections/tracks/events read models, clips, metrics
  rights/                           rights policy service - the gate everything calls
  storage/                          ObjectStore interface + R2 implementation
  compute/                          ComputeProvider interface + RunPod/Lambda/mock
  guards/  dto/  rbac/

packages/vision-contracts/          NEW - types shared by API, web, and worker
  Zod/TS schemas, generated JSON Schema for the Python worker

apps/web/src/modules/vision/        NEW - scout/public read surfaces
apps/web/src/modules/admin/vision/  NEW - admin screens, inside the EXISTING AdminApp

services/vision-worker/             NEW - Python, Docker/OCI, runs off-platform
  pipeline/  adapters/  cli/  Dockerfile

infra/vision/                       NEW - R2 bucket/lifecycle config, worker image CI
docs/vision/                        this documentation set
```

### Why `packages/vision-contracts`

The worker is Python and the control plane is TypeScript. Without one source of truth for the job
spec and the prediction envelope, they drift within a month. The package holds Zod schemas and
emits JSON Schema at build time; the worker validates against that JSON Schema at startup and on
every payload. A contract mismatch then fails loudly at the boundary instead of silently in a
Parquet file three stages later.

---

## Failure isolation

Non-negotiable: **a Vision Engine failure must not take down `dtp.africa`.**

| Risk | Control |
|---|---|
| Vision queries saturate the shared Postgres | Vision tables share the database, but every Vision query runs under a statement timeout and heavy reads use a read-only path. Revisit a separate database when Vision row counts exceed the football graph by an order of magnitude — see [13](./13-OPEN-QUESTIONS.md). |
| A stuck GPU job pins the API | Workers poll. The API never blocks on a worker. Jobs carry hard wall-clock budgets and are reaped. |
| Worker floods the API with progress updates | Heartbeat and progress are rate-limited per job; progress is throttled to at most one write per 10 s. |
| A Vision module crash takes the process down | Vision controllers catch and log. No Vision code runs in the bootstrap path of existing modules. |
| R2 outage | Ingestion and inference stall. The existing site, ScoreBoard, and profiles are unaffected because none of them read R2. |
| Vision fills the disk | Nothing Vision-related is written to EC2 local disk except logs. Enforced in review: no filesystem writes outside the OS temp dir anywhere in `services/api/src/vision/`. |

---

## Deployment topology

No change to the existing stack shape. Vision adds:

```
EC2 (existing shape, unchanged)
  nginx :80           - serves web, proxies /api/
  api  :3000          - NestJS, plus the vision module
  postgres :5432      - plus vision tables
  vision-dispatcher   - NEW, tiny: reaps stale jobs, enforces budgets, requests capacity
                        (a scheduled task inside the API process in V1)

Cloudflare R2         - NEW, 4 buckets, see 05-STORAGE.md

GPU/CPU workers       - NEW, ephemeral, off-platform, no inbound ports
                        pull work over HTTPS from api.dtp.africa/api/v1/vision/worker/*
```

The dispatcher is deliberately *not* a separate always-on container in V1. A 2 GB box does not
need another Node process to run an interval that reaps stale jobs. Promote it to its own
container when it needs independent scaling, not before.

---

## Queue: Postgres, not Redis

The PID suggests Redis plus Celery/RQ/Dramatiq. That is the right shape for a Python control
plane with many workers. It is the wrong shape for this one in V1:

- Redis is another container on a 2 GB box already running Postgres, the API, and nginx.
- Celery and RQ are Python; the control plane is TypeScript.
- Expected first-year concurrency is a handful of matches, not thousands of tasks.
- Job state must be transactionally consistent with rights, assets, and review decisions, which
  all live in Postgres. A separate broker introduces a two-phase-commit problem for no benefit at
  this scale.

**Ruling:** V1 uses a Postgres-backed queue with `SELECT ... FOR UPDATE SKIP LOCKED` claiming.
Move to Redis/BullMQ when sustained concurrency exceeds roughly four workers or when queue
latency is measurably the bottleneck — measured, not assumed. The `JobQueue` interface makes that
a swap rather than a rewrite. See [06-JOBS-AND-COMPUTE.md](./06-JOBS-AND-COMPUTE.md).

---

## Where transcode runs

Neither source document states this clearly, and getting it wrong breaks the platform.

FFmpeg normalization of a 90-minute match on a `t3.small` takes hours of 100%-pinned CPU and
would starve the API that serves `dtp.africa`. **Transcode is a job type in the same queue as
inference and runs on a worker, never on EC2.** It does not need a GPU: transcode jobs request a
cheap CPU worker class, inference jobs request a GPU class. Same queue, same contract, different
`resourceClass`.

The only media work EC2 ever performs is reading FFprobe *metadata* returned by the worker as
JSON. It never opens a video file.

---

## The abstraction boundaries

Domain code depends on interfaces, never on a vendor. Six interfaces carry the design:

| Interface | Implementations (V1) | Guards against |
|---|---|---|
| `ObjectStore` | `R2ObjectStore`, `InMemoryObjectStore` (tests) | Cloudflare lock-in |
| `ComputeProvider` | `RunPodProvider`, `LambdaCloudProvider`, `LocalProvider`, `MockProvider` | GPU vendor lock-in |
| `DetectorAdapter` | `RfDetrDetector` | Model lock-in |
| `TrackerAdapter` | `ByteTrackTracker`, `BotSortTracker` | Model lock-in |
| `CalibrationAdapter` | `KeypointHomographyCalibrator` | Model lock-in |
| `EventModelAdapter` | `RuleBasedEventEngine`, learned model later | Premature ML |
| `VideoLanguageModelAdapter` | managed API first | VLM vendor lock-in |

Rule: **no provider name appears in a table name, column name, API path, dataset manifest, or
domain type.** The strings `runpod`, `cloudflare`, and `r2` are allowed only inside their own
adapter directory and in configuration. Finding them elsewhere is a review failure.
