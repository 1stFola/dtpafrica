# 17 — Phase 1, Increment 2: the worker container

The first point at which a real media file is touched. **Gate: PASS** —
`vision:e2echeck` reports 28/28 driving the real container against the running
control plane and live R2.

---

## What shipped

### `services/vision-worker` — Python, Docker, provider-neutral

```
dtp_vision_worker/
  config.py         environment only; dies at startup on a bad setting
  control_plane.py  the worker's entire view of the outside world
  media.py          ffprobe / ffmpeg wrappers
  runner.py         the loop, heartbeats, cleanup
  stages/           probe · fingerprint · transcode
```

**843 MB, CUDA-free, non-root (uid 1000), FFmpeg 5.1.9.** Deliberately no CUDA:
every stage here is CPU-bound, and running them on a GPU pod would mean paying
GPU rates for FFmpeg. The GPU image will build `FROM` this one.

Model weights are **not** baked in — they are pulled by `modelVersionId` and
checksum-verified, so the image is not a deployment unit for models.

Exit codes matter to whatever supervises the container: `0` means the queue
drained cleanly, `2` means the image is incompatible or misconfigured and
restarting will not help. Verified.

### A worker learns three things

A callback URL, a bootstrap token, and its resource classes. No storage
credential, no database URL, no provider SDK. There is a test asserting that even
if a launch spec leaked `VISION_R2_SECRET_ACCESS_KEY` or `DATABASE_URL` into the
environment, nothing reads them.

That is the portability requirement in practice: the same image runs on any
provider, or a local machine, because it knows nothing about whose hardware it is
on.

### The stages

| Stage | Does | Notes |
|---|---|---|
| `probe` | ffprobe → container metadata | Detects variable frame rate by comparing nominal against measured rate. VFR is flagged, not silently accepted — annotating it against wall-clock time is how timestamps drift. |
| `fingerprint` | SHA-256 + perceptual hash | SHA-256 proves a dataset member is the bytes it claims. The perceptual hash (sampled frames → 8×8 grey → difference hash) survives re-encoding, so the same match uploaded twice at different qualities lands in one duplicate cluster and cannot be split across a train/test split. Returns `null` rather than a misleading value when the source is too short to sample. |
| `transcode` | Constant-FPS proxy + thumbnails | 25 fps, 720p, CRF 23. **Constant by construction** — that is what makes frame seeking deterministic, and therefore what makes an annotation point at the same moment after a re-transcode. A settings hash lets a re-run be skipped rather than producing a subtly different proxy that invalidates existing annotations. |

### New: inputs are requested by role, not by key

Increment 1 gave the worker a way to *write* safely but no way to *read* its
inputs at all — a gap I left. `POST /jobs/:id/input-url` closes it, and takes a
**role** (`source` | `proxy`), never a key. The control plane resolves the role
from the job's own asset row, so a worker cannot name an input path any more than
it can name an output one.

---

## Gate evidence

`vision:e2echeck <path-to-mp4>` uploads a source to R2, queues a job through the
admin API, provisions a worker, runs the **real container**, and asserts the
outcome — then deletes every object it wrote, including the write-once source via
`deleteProtected`.

```
probe        registered · claimed · presigned GET from master · ffprobe ·
             presigned PUT to derived · completed · drained and exited
transcode    prerequisite gate refused `detect` before transcode existed ·
             proxy at constant 25 fps / 720p · thumbnails · settings hash ·
             every artifact under its own prefix
28/28 checks passed
```

```
api tests                231 passed  (was 207)
worker tests              21 passed  (pytest)
vision-contracts          22 passed
selfcheck               27/27
r2check                 11/11   live R2
jobcheck                23/23   live Postgres + live R2
e2echeck                28/28   real container + live R2
```

---

## Three bugs worth recording

### 1. Mixed injection silently produces `undefined`

Increment 1 noted this for `PrismaService`. It is broader: **in a constructor that
uses `@Inject()` for any parameter, every parameter left to a reflected type
resolves to `undefined`.** `VisionJobsService` and `WorkerTokenService` were both
`undefined` inside `VisionJobsController`, so the first `POST /vision/jobs`
returned 500 while all 207 tests passed.

Every Vision constructor is now fully explicit, and **`vision-di.spec.ts`
compiles the real module and asserts every controller and service has no
`undefined` dependency.** That test exists specifically because unit tests
construct classes by hand and therefore cannot catch this.

### 2. BigInt breaks JSON

`GET /vision/jobs/:id` returned 500 as soon as a cost row existed to include,
because `JSON.stringify` throws on a BigInt and several Vision columns are BigInt
by design. Fixed with `jsonSafe()` — number where lossless, string beyond
`MAX_SAFE_INTEGER`. Deliberately **not** by patching `BigInt.prototype.toJSON`,
which would change serialisation for every other module in the process to fix a
problem local to Vision.

### 3. The harness lied about a working run

The first e2e run reported the worker had failed. It had not — it had done the
entire pipeline correctly. The worker logs to **stderr**, and `execFileSync`
returns stdout only, so the assertions matched against an empty string. Switched
to `spawnSync` and concatenated both streams.

Worth remembering when a check says something failed: confirm the check is
looking in the right place before believing it.

---

## Not in this increment

| Deferred | Note |
|---|---|
| Scheduling `reap()` | Implemented and tested; still not on an interval. |
| Writing stage output back onto the asset | `probe` records its findings in the job summary; nothing yet copies codec/fps/duration onto `VisionVideoAsset`, or the proxy onto `VisionVideoVariant`. Next. |
| Resumable upload endpoints | With the interruption test as its gate. |
| Source catalog + rights screens | `/admin/vision/sources`. |
| Second hosted compute provider | To prove the abstraction holds. |
| `media.py` unit tests | Exercised end to end but not in isolation; the FFmpeg wrappers deserve their own tests. |
