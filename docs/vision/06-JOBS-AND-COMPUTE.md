# 06 — Jobs and compute

## Principles

1. The API never blocks on a worker. Ever.
2. Workers pull; the control plane does not push.
3. A worker holds no standing credentials — no R2 key, no database connection.
4. Every stage is idempotent and retry-safe.
5. A retry never overwrites a previous attempt's output.
6. Every job records what it cost.

---

## The queue

Postgres, claimed with `SKIP LOCKED`. See
[01-ARCHITECTURE.md](./01-ARCHITECTURE.md#queue-postgres-not-redis) for why not Redis.

```sql
UPDATE vision_jobs SET
  state = 'claimed', claimed_at = now(), heartbeat_at = now(), worker_id = $1
WHERE id = (
  SELECT id FROM vision_jobs
  WHERE state = 'queued'
    AND resource_class = ANY($2)
  ORDER BY priority DESC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

Behind a `JobQueue` interface so the move to Redis/BullMQ, when concurrency justifies it, is a
swap rather than a rewrite.

### States

```
queued ──claim──► claimed ──start──► running ──┬──► succeeded
   ▲                  │                        ├──► failed      (attempt < max → requeued)
   │                  │                        └──► cancelled
   └───── requeue ────┴── heartbeat lost / budget exceeded → expired → requeue
```

- **Heartbeat lost:** no heartbeat for 3 intervals → `expired`, requeued if attempts remain.
- **Budget exceeded:** `budgetSeconds` or `budgetUsdCents` breached → cancelled, provider instance
  torn down, job marked failed with a budget reason. Budgets are mandatory, not optional.
- **Poison job:** `attemptNumber > maxAttempts` → terminal `failed`, surfaced in the ops dashboard.

### Resource classes

Job type determines the class. Transcode does not need a GPU.

| Class | Typical hardware | Used by |
|---|---|---|
| `cpu_small` | 4 vCPU, 8 GB, no GPU | `transcode`, `clip`, `fingerprint` |
| `gpu_24gb` | L4 / RTX 4090 / A5000 | `detect`, `track` inference |
| `gpu_48gb` | A6000 / RTX 6000 Ada / L40S | Batch inference, small training |
| `gpu_80gb` | A100 / H100 | Larger training only |

Routing transcode to a cheap CPU class rather than a GPU pod is one of the larger cost savings
available, and neither source document specifies it. See
[12-COST-MODEL.md](./12-COST-MODEL.md).

---

## Job types and the pipeline

Stages are separate jobs, not one monolith. A failed tracking stage must not force a re-run of
detection over 90 minutes of video.

| Type | Input | Output | Phase |
|---|---|---|---|
| `probe` | master object | `ffprobe.json`, asset metadata | 1 |
| `fingerprint` | master object | SHA-256, perceptual fingerprint | 1 |
| `transcode` | master object | proxy (constant FPS), HLS, thumbnails | 1 |
| `detect` | proxy | `detections.parquet` | 3 |
| `track` | `detections.parquet` | `tracks.parquet`, track rows, crops | 4 |
| `identify` | tracks, crops, roster | jersey candidates, identity assignments | 4 |
| `calibrate` | proxy, camera segments | `calibration.parquet` | 5 |
| `gamestate` | tracks + calibration | `gamestate.parquet` | 5 |
| `ball_trajectory` | full-rate pinned detections, camera snapshot | image-space trajectory index and JSONL chunks; explicit lost frames ([80](./80-PHASE-6-INCREMENT-9.md)) | 6 |
| `possession` | compatible ball trajectory and full-rate player tracks; opt-in calibrated mode also pins proxy geometry/checksum and camera calibration | unreviewed candidate/Unknown segments in derived JSONL chunks; calibrated distance/motion vetoes ([84](./84-PHASE-6-INCREMENT-13.md)), contract 1.15.0 | 6 |
| `events` | current original calibrated possession and full-rate tracks; registered weight-free event-carry/v1 version | bounded unreviewed carry artifact, explicit zero output, original provenance; CPU only, contract 1.16.0 ([85](./85-PHASE-6-INCREMENT-14.md)); event ledger import remains next | 6 |
| `clip` | proxy, event window | clip mp4, poster | 7 |
| `vlm` | approved clip + context | scouting observation JSON | 8 |
| `train` | dataset version | weights, metrics | 3+ |
| `benchmark` | model version + gold dataset | metric results per slice | 3+ |

Stage dependencies are explicit in `inputSpec`. The dispatcher will not queue `track` until the
`detect` job for that asset has succeeded and its artifact key is recorded.

---

## The worker API

Workers talk to the control plane over HTTPS and nothing else. No database, no message broker, no
inbound ports on the worker.

All endpoints are under `/api/v1/vision/worker/` and use a **worker token**, not an admin session.
A separate guard — `VisionWorkerGuard` — with no relationship to `AdminAuthGuard`. A worker token
must never be able to reach an admin endpoint, and an admin session must never be able to complete
a job.

```
POST   /worker/register            → { workerId, pollIntervalMs }
POST   /worker/jobs/claim          { workerId, resourceClasses[] } → job | 204
POST   /worker/jobs/:id/heartbeat  { workerId, stage?, progress? }
POST   /worker/jobs/:id/presign    { key, contentType } → { url }     ← key validated against outputPrefix
POST   /worker/jobs/:id/complete   { artifacts[], metrics, cost }     ← idempotency key required
POST   /worker/jobs/:id/fail       { reason, detail, retryable }
```

### Token model

| Token | Scope | TTL |
|---|---|---|
| Bootstrap token | Register only, and nothing else: `tokenKind` keeps it out of every job route, and `register` refuses a worker token ([51](./51-QA-FIX-1-SECRETS.md)). Injected by the provider adapter at pod launch. | 1 hour |
| Worker token | Claim, heartbeat, and act on jobs of its declared resource classes. | 12 hours. Not refreshed: a worker whose claim is refused exits and is provisioned afresh ([53](./53-QA-FIX-3-JOB-PROTOCOL.md)). |
| Job-scoped claim | Encoded in the worker token's active-job binding: a worker may only presign, complete, or fail the job it currently holds. | Life of the job |

`complete` carries an idempotency key. A worker that completes a job, loses its network, and
retries must not double-write. The control plane stores the key and returns the original result.

`complete` is additionally HMAC-signed over the artifact list with the worker's token secret, so a
replayed or tampered completion body is rejected.

### Why presign-per-output

The alternative is giving the worker an R2 credential. On ephemeral third-party GPU hardware that
means a compromised pod can read or overwrite the whole corpus. Per-key presigning with
server-side prefix validation removes that entirely. Because artifacts are a handful of large
Parquet files — see [05-STORAGE.md](./05-STORAGE.md#artifact-granularity--a-cost-and-performance-rule) —
the extra round trips are negligible.

---

## The compute provider interface

```ts
export interface ComputeProvider {
  readonly id: string;                  // "runpod" | "lambda" | "local" | "mock"
  capabilities(): ProviderCapabilities; // resource classes, regions, max concurrency

  launch(spec: WorkerLaunchSpec): Promise<{ providerRef: string }>;
  status(providerRef: string): Promise<WorkerStatus>;
  terminate(providerRef: string): Promise<void>;
  estimateCost(resourceClass: ResourceClass, seconds: number): Promise<CostEstimate>;
}

export type WorkerLaunchSpec = {
  image: string;              // OCI image ref, e.g. dtp-vision-engine:0.4.1
  resourceClass: ResourceClass;
  env: Record<string, string>;   // bootstrap token, API base URL, resource classes
  maxRuntimeSeconds: number;
  maxCostUsdCents: number;
  idleShutdownSeconds: number;   // drain and die
};
```

Implementations in V1: `RunPodProvider` (default), `LambdaCloudProvider` (fallback),
`LocalProvider` (a local NVIDIA box or a CPU container for development), `MockProvider` (tests).

**Write the Lambda provider in Phase 1, not Phase 10.** An abstraction with one implementation is
a guess. Writing the second one is how you find out whether the first leaked.

Vast.ai is permitted for experiments only and has no provider implementation — jobs whose output
enters a dataset or a published fact may not run there. See
[02-DECISIONS.md, D3](./02-DECISIONS.md#d3--fallback-gpu-provider).

### Failover

V1 failover is **manual and observable**, per the HANDOFF. The dispatcher records that capacity
was unavailable and raises an ops alert; an operator switches the active provider by
configuration. Automatic failover requires confidence that a provider's health signal is
trustworthy, which DTP will not have on day one.

---

## The worker container

One image, versioned, portable. Never hand-installed on a pod.

```
dtp-vision-engine:{semver}
  Ubuntu 22.04
  CUDA + cuDNN (pinned)
  Python 3.11, PyTorch (pinned)
  OpenCV, FFmpeg (build config recorded in the OSS register)
  boto3 / S3 client
  DTP worker code + pipeline stages + adapters
```

Requirements:

- The image runs unchanged on RunPod, Lambda Cloud, a local NVIDIA machine, or any CUDA host.
- No provider SDK inside the image. The worker knows only: an API base URL, a bootstrap token, and
  its resource classes.
- Model weights are **not baked in**. They are pulled from the `models` bucket by
  `modelVersionId` and checksum-verified before use. Baking weights in makes the image a
  deployment unit for models, which breaks the model registry.
- Image tag is recorded on every job for reproducibility.
- The image validates the contract JSON Schema from `packages/vision-contracts` at startup and
  refuses to claim work if the control plane's contract version is incompatible.

---

## Idempotency

| Operation | How it is made safe |
|---|---|
| Upload finalize | Keyed on `uploadId`. Repeat calls return the existing asset. |
| Probe / fingerprint | Pure functions of the object. Re-running produces the same values; results are upserted. |
| Transcode | Writes to `derived/proxies/{videoAssetId}/`. Re-run overwrites deterministically with identical encoder settings, or is skipped if a variant row already exists with a matching settings hash. |
| Inference | Writes to `inference/{jobId}/{attempt}/`. A retry gets a new attempt prefix. Nothing is overwritten. |
| Job completion | Idempotency key stored; duplicate completions return the original outcome. |
| Event promotion | `VisionEventCandidate.promotedEventId` is unique. Promoting twice is a no-op. |
| Annotation import | Keyed on `(taskId, annotatorId, payloadChecksum)`. |

The general rule: **an operation that can be retried writes to a new location or upserts on a
natural key.** Nothing important is an in-place mutation.

---

## Observability

Per job, recorded in `VisionJobCost`:

- `gpuSeconds`, `cpuSeconds`, wall-clock seconds
- `bytesRead`, `bytesWritten`, R2 Class A / Class B operation counts
- third-party API cost in cents (VLM calls)
- `estimatedUsdCents`, computed by `ComputeProvider.estimateCost`

Rolled up per match so the question "what did this match cost to analyze?" has a number, not an
estimate. See [12-COST-MODEL.md](./12-COST-MODEL.md).

Per job, in `VisionJobEvent` (append-only): state changes, stage boundaries, warnings, provider
reference, image tag, model versions used.

Ops dashboard metrics: queue depth by resource class, oldest queued job age, jobs failed in the
last 24 h with reasons, GPU spend this month against budget, failed transcodes, stale-heartbeat
reaps, and cost per analyzed match over time.

Structured JSON logs go to the existing logging path. A full metrics stack (Prometheus and
friends) is deliberately deferred — it is another thing to run on a 2 GB box, and the job tables
answer every question that matters in year one.
