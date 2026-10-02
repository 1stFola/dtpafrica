# 28 — Phase 3 Increment 1: the registry, and a prediction that names its model

> Every prediction carries model version, source frame/time, and confidence.
> — [10-EVALUATION-AND-GATES](./10-EVALUATION-AND-GATES.md), Phase 3 gate

Phase 3 is detection, and the obvious first increment is a benchmark. It cannot be:
the corpus holds window-level labels and not a single box
([26 § What is not done](./26-PHASE-2-INCREMENT-5.md#what-is-not-done)), so there is
nothing yet to score a detector against. What *can* be built first is the half of
the gate that is about plumbing rather than accuracy — and Spike S0 had just shown
it was missing. The `detect` stage wrote COCO labels with no model version and no
source time, and the control plane threw its output away with "no domain effect".
A detection nobody can attribute is not evidence, however good the detector.

So this increment is the model registry, and the provenance chain from a registered
version, through the job that runs it, to the artifact a worker writes and the
completion the control plane accepts.

---

## What the gate found before anything was built

Three latent faults, none of which any test had caught, because each test agreed
with the code it was testing.

| | |
|---|---|
| **The artifact spoke COCO.** | `person` and `sports ball`, no model version, no source time, and a `frameIndex` that was the sampled frame's ordinal rather than the proxy frame the envelope promises. A reader had to know what torchvision calls a football. |
| **`sampleFps` was read from the wrong level.** | The stage read it off the top of `inputs`; the control plane writes a job's `inputSpec` under `inputs.params`. An operator's sample rate was silently ignored in favour of the default. The test passed because it put the value where the code looked. |
| **`VisionJob.modelVersionId` was never written.** | The column has existed since Phase 0 and the claim response already copied it into `inputs.modelVersionIds`. Nothing ever set it. |

Each is the S0-1 shape again ([27](./27-SPIKE-S0-SURPRISES.md)): a contract mirrored,
not satisfied.

## The registry

`VisionModel` and `VisionModelVersion` existed as tables. They now have a service,
two write routes and two read routes
([07 § Datasets and models](./07-API-CONTRACTS.md#datasets-and-models)), and a version
cannot be registered without what makes it reproducible: a commit, a config key, an
image tag, and a licence note. The note is **required, not defaulted**, because the
[OSS register](../licenses/OSS_REGISTER.md) says nothing ships without an entry, and
"we'll fill it in later" is how an AGPL dependency reaches production.

A version that names a dataset meets the same three refusals the export makes —
`DatasetNotFrozen`, `DatasetContainsRevokedMembers`, `GoldContamination` — because
registering the version is how a training run would be *recorded*, and recording it
is the moment the contamination becomes a fact.

**No route changes `stage`.** Promotion is the two-person act in
[10](./10-EVALUATION-AND-GATES.md#promotion-gate), and it arrives with the benchmark
ledger that justifies it. Until then a version moves by hand, and the dispatcher
treats two versions marked production as an error rather than a choice.

## Dispatch

`POST /vision/jobs` for a model-bound type (`MODEL_TASK_BY_JOB_TYPE` — `detect`, and
only `detect`, because declaring `track` before its stage exists would be S0-1 a
third time) resolves exactly one version: the one named, checked for task and stage,
or the single `production` version for the task. With neither, the job is refused
(`NoProductionModel`). There is deliberately no fallback to "the newest candidate":
a job that ran whatever happened to exist produces predictions whose provenance is
an accident.

Any stage downstream of `transcode` is also dispatched with the **proxy's clock** —
`params.proxy = { fps, sourceOffsetMs }` from the variant row. The worker cannot
work either out: it holds a presigned URL, and a URL does not know by how much a
proxy was trimmed. The clock is spread last into the job's inputs, so a caller's own
`params.proxy` is overwritten rather than trusted. A proxy with no recorded frame
rate refuses the job (`ProxyWithoutFps`), the same refusal the export makes for the
same reason: a guessed rate produces frame indices that look precise and are wrong.

## The artifact

`detect` now refuses to run — non-retryably, before downloading anything — unless
the job names exactly one model version and the proxy clock. What it writes is
`DetectionArtifact` ([prediction.ts](../../packages/vision-contracts/src/prediction.ts)):

- **Contract classes.** `person → player`, `sports ball → ball`. COCO has no
  goalkeeper and no referee, so the baseline calls every person a player; the mapping
  is written into every artifact as `classes` so that limitation is stated in the file
  rather than assumed by its reader. A label outside the mapping fails the run — a
  detector emitting a class this pipeline has no word for is a wiring bug, not an
  empty frame.
- **Both clocks on every frame**, like the envelope. `proxyTimeMs` from the sample
  index; `sourceTimeMs = proxyTimeMs + sourceOffsetMs`; `frameIndex` the proxy frame,
  **floored** — the same rule as [26](./26-PHASE-2-INCREMENT-5.md#the-two-clocks-and-the-conversion-between-them),
  because frame 12 covers [480ms, 520ms) and a sample at 500ms belongs to it, not to 13.
- **`ball_unknown`** on every frame with no ball. Unknown beats wrong: an absence is a
  flag, never a box carried forward from the last frame that had one.
- **The model version, the dataset version** (`null` for a pretrained baseline — COCO
  was trained on nothing of DTP's), **and the checksum of the weights that ran.** The
  real detector hashes the checkpoint torchvision cached; a test detector reports
  `null` rather than a plausible fake.

The worker reports `modelVersionIds` on completion as well, because the artifact is
in object storage, the summary is in Postgres, and the check is at the door.

## The door

`POST /vision/worker/jobs/:id/complete` already refused an artifact outside the job's
prefix before letting the job succeed, on the grounds that a worker reporting what it
was never allowed to write is either broken or lying. Provenance is the same category,
checked at the same door, before `succeed`:

| Refusal | When |
|---|---|
| `403 ProvenanceMismatch` | The completion's `modelVersionIds` is not exactly the version the job was dispatched with; or a stage that runs no model reports one; or the job carries no version at all. |
| `403 WeightsMismatch` | The reported `weightsSha256` is not a digest, or differs from the checksum the version is pinned to. |

A refused completion is an error in the worker's eyes, so the runner fails the job
and the attempt is spent. That is the right outcome: a stage that cannot attribute its
own output does not get to count as done.

**Pinning.** The first accepted completion that reports a checksum pins the version to
it, after the job has succeeded and only where nothing is recorded (`updateMany` with
`weightsChecksum: null` in the `where`), so a refused completion records nothing and
two first runs cannot overwrite each other. Every later run on that version must
match. A URL can serve different bytes on different days; a version that meant
"whatever the URL served" would mean nothing.

## Contract 1.1.0

The job spec changed — a model-bound job carries a version, a proxy-reading job
carries a clock — so the version is bumped and a 1.0.0 worker is refused at the
handshake. That is the handshake doing its job: a 1.0.0 image would accept a `detect`
job and write predictions nobody can attribute.

## Verification

```
api tests              1,047 passed
  model registry          34 new
  enqueue resolution      12 new   (the enqueue path had no spec before)
  worker door              5 new
  detect projection        5 new
vision-contracts          30 passed   (was 24)
vision-worker            101 passed
  detect                  31 test functions   (was 12)
  contract guard           8                  (was 4)
  runner                  13                  (was 9)
typecheck               clean, including scripts/**
vision:modelcheck       49/49 against the real API and Postgres, run twice
```


Nine mutations, each breaking a guard this increment added, each caught by a test:
the `ball_unknown` flag dropped; the frame index rounded instead of floored; the
source offset not applied; the model version not reported on completion; `sampleFps`
read from the top level again; a completion accepted under another model version; a
weights mismatch ignored; the caller allowed to forge the proxy clock; and the
provenance check removed from the door.

The gate (`pnpm --filter @dtp/api vision:modelcheck`) exercises the whole path over
HTTP against a real Postgres: a blank licence note is refused at the DTO; a draft, a
revoked and a gold-contaminated dataset are each refused by name and a clean one
accepted; `detect` is refused before transcode, refused with no production model,
refused with a tracker's version, refused on a proxy with no frame rate; the queued
job row carries the version and the variant's clock while a forged clock is
overwritten; and then a fake pod provisions, registers, claims, is refused for naming
another version, for naming none, and for a checksum that is not a digest, is
accepted on an honest completion, pins the version, is recognised on retry, and on
a second job is refused for different weights and accepted with none.

## What is not done

| | |
|---|---|
| **The benchmark ledger** | `VisionBenchmarkRun` and `VisionMetricResult` ([04 § Models](./04-DATA-MODEL.md#7-models--phase-3)), the thresholds configuration, and the `benchmark` stage. Blocked on the next item. |
| **Box-level ground truth** | The annotation payload is a window; there are no boxes to score against. Increment 2 adds boxes to the payload and `Detections` to the export. |
| **Promotion, canary, rollback** | `stage` moves by hand. The two-person rule and `vision.models.promote` are wired in RBAC and have no route to guard yet. |
| **Goalkeeper and referee** | The baseline cannot tell them from players and says so. RF-DETR on DTP footage is the answer, after the licence review the register still requires. |
| **Parquet** | The artifact is JSON. At 2fps a match is ~11,500 frames and JSON is fine; the data model's Parquet layout waits for tracking, which is 25fps. |
| **The registry screen** | `/admin/vision/models` ([08](./08-FRONTEND.md#model-registry-and-benchmarks)) has an API and no page. |
| **Registering the baseline on staging** | `detector/torchvision-fasterrcnn-coco` is described in the register and registered by the gate's fixture; the real row on staging is one `POST`, made when the first pod run is funded. |

## Next

**Increment 2 — box-level ground truth.** The annotation payload gains per-frame
boxes in contract classes; the review workstation draws them, or CVAT does and the
adapter imports them; the FiftyOne export emits `Detections` beside
`TemporalDetections`. **Increment 3 — the benchmark ledger**: a `benchmark` stage
that scores a registered version against a frozen gold version per class and per
slice, writes `VisionMetricResult` rows, and moves `candidate → benchmarked`; a
versioned thresholds configuration; and the promotion request with its second
approver. Only then can anything be said to have met the Phase 3 gate.
