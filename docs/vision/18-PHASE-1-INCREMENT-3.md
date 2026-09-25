# 18 — Phase 1, Increment 3: closing the loop onto the asset

Increment 2 computed the right answers and threw them away. **Gate: PASS** —
`vision:e2echeck` reports 37/37, and the findings now land on the asset row.

---

## The gap this closed

After Increment 2 the pipeline worked and produced nothing durable:

- `probe` read the codec, duration and dimensions into a job summary **nothing read**.
- `transcode` wrote a proxy to object storage with **no row pointing at it**.
- `fingerprint` computed two hashes that went **nowhere**.
- `VisionVideoAsset.ingestState` stayed on `uploaded` forever, so nothing downstream could tell a ready asset from an unprocessed one.

## What shipped

`VisionStageResultsService` — one place that turns a completed stage into domain
state, dispatched by job type and called from the worker's `complete` path.

| Stage | Effect |
|---|---|
| `probe` | Container, codec, dimensions, frame rate, duration and the variable-frame-rate flag onto the asset |
| `fingerprint` | SHA-256 and perceptual hash onto the asset, **plus duplicate clustering** |
| `transcode` | `VisionVideoVariant` rows for the proxy and every thumbnail, then `ingestState = ready` |

### Duplicate clustering lives here, not in the worker

Clustering is a question about the **whole corpus**, and a worker can only see the
one file it was handed. So the control plane looks for twins on either hash:

- **Exact byte match** → `method: checksum`, confidence 1.
- **Matching perceptual hash** → `method: perceptual`, confidence 0.85. A different file, the same football.

Two behaviours that matter more than they look:

- A third re-upload **joins the existing cluster** rather than starting a rival one, or the group splits in two and a match ends up on both sides of a train/test split.
- Creating a cluster **pulls the matched assets into it as well**, because a grouping that only describes one side of a pair is not a grouping.
- A null perceptual hash is **never searched on** — it would match every other asset whose hash was also unknown.

### Idempotency, and why it is not optional

A worker that completed, lost its network and retried reaches `complete` twice.
Applying twice must not re-cluster an asset or duplicate its variants.

- The applier only runs when `queue.succeed` reports `alreadyApplied: false`.
- Variants `upsert` on `(videoAssetId, kind, objectKey)` — a retry writing to a new attempt prefix adds rows; a genuine re-run of the same attempt updates in place.
- Probe writes the same fields to the same values, so re-running is a no-op by construction.

### Failure is recorded, not thrown

If the projection write fails, the job **genuinely succeeded** and its artifacts
exist. Throwing back at a worker that has already exited would un-succeed real
work. So the error is logged and written to `VisionVideoAsset.ingestError`, where
an operator sees it without reading container logs.

Separately, a **terminally** failed ingest stage sets `ingestState = failed` with
the reason. Only terminally: a requeued attempt may still succeed, and marking the
asset failed in between would be misleading.

### Defensive parsing

The summary arrives as JSON from another language, so every field is type-checked
rather than trusted. A `width` of `"1920"` becomes `null`, not a bad row. And a
summary carrying nothing usable is **refused** rather than writing nulls over good
data — losing a codec DTP already knew would be worse than not learning it twice.

---

## Gate evidence

```
Asset projection (probe)
  codec written to the asset                    h264
  duration written to the asset                 number
  dimensions written to the asset               320x240
  no ingest error recorded                      null

Asset projection (transcode)
  asset marked ready                            ready
  proxy registered as a variant                 true
  variant records the constant frame rate       25
  variant points at the object that was written inference/…/1/proxy.mp4
  thumbnails registered as variants             true

37/37 checks passed
```

```
api tests            258 passed  (was 231)
worker tests          21 passed
contract tests        22 passed
selfcheck          27/27
r2check            11/11   live R2
jobcheck           23/23   live Postgres + R2
e2echeck           37/37   real container + live R2
typecheck          clean, 6 projects
```

27 new unit tests cover the applier, weighted towards the clustering rules and the
idempotency guarantees, since those are the ones whose failure would corrupt a
dataset rather than crash a request.

---

## Not in this increment

| Deferred | Note |
|---|---|
| Scheduling `reap()` | Implemented and tested; still not on an interval. Overdue. |
| Resumable upload endpoints | The interruption test is its gate. Next. |
| Source catalog + rights screens | `/admin/vision/sources`. |
| Second hosted compute provider | To prove the abstraction holds. |
| `media.py` unit tests | Exercised end to end, still not in isolation. |
| A `fingerprint` run in the e2e | Clustering is unit-tested thoroughly, but the stage itself is only proven by `probe` and `transcode` end to end. Worth adding when a second real file exists to cluster against. |
