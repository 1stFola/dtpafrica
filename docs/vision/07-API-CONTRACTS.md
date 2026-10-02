# 07 — API contracts

All routes sit under the existing global prefix `api/v1` and are guarded by the existing
`AdminAuthGuard` + `PermissionsGuard`, except the worker surface, which has its own guard.

Conventions follow the existing API: NestJS controllers, `class-validator` DTOs, the global
`ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })`, and
`@RequirePermissions(...)` on every route.

---

## Admin surface

### Sources and rights — `vision/sources`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/vision/sources` | `vision.read` |
| `POST` | `/vision/sources` | `vision.sources.write` |
| `PATCH` | `/vision/sources/:id` | `vision.sources.write` |
| `GET` | `/vision/sources/:id` | `vision.read` |
| `POST` | `/vision/sources/import` | `vision.sources.write` |
| `POST` | `/vision/sources/:id/rights-evidence` | `vision.rights.manage` |
| `POST` | `/vision/sources/:id/rights-scopes` | `vision.rights.manage` |
| `POST` | `/vision/sources/:id/revoke` | `vision.rights.manage` |
| `POST` | `/vision/sources/:id/authorize-acquisition` | `vision.rights.manage` |
| `POST` | `/vision/sources/:id/upload-grant` | `vision.rights.manage` |
| `GET` | `/vision/sources/:id/impact` | `vision.read` |

`POST /vision/sources/import` accepts CSV or JSON of catalog metadata only — partner, channel,
external ID, title, duration, published date. **It never fetches a video.** A row created this way
has `acquisitionStatus = catalogued` and cannot reach a dataset.

`GET /vision/sources/:id/impact` answers "what breaks if I revoke this?" — the lineage query from
[03-RIGHTS-AND-GOVERNANCE.md](./03-RIGHTS-AND-GOVERNANCE.md#revocation-and-deletion-lineage).
Operators see the blast radius before acting, not after.

### Upload — `vision/uploads`

| Method | Path | Permission |
|---|---|---|
| `POST` | `/vision/uploads` | `vision.assets.upload` |
| `GET` | `/vision/uploads/:id` | `vision.assets.upload` |
| `POST` | `/vision/uploads/:id/parts` | `vision.assets.upload` |
| `POST` | `/vision/uploads/:id/complete` | `vision.assets.upload` |
| `DELETE` | `/vision/uploads/:id` | `vision.assets.upload` |

`POST /vision/uploads` refuses unless acquisition is authorized and rights evidence is attached.
Rights are checked here, at the door, not after 6 GB has landed.

`GET /vision/uploads/:id` returns received parts so a client can resume:

```jsonc
{
  "id": "…", "state": "in_progress",
  "key": "originals/…/source.mp4",
  "partSizeBytes": 16777216,
  "receivedParts": [{ "partNumber": 1, "etag": "…" }],
  "bytesReceived": 285212672,
  "expiresAt": "2026-10-01T09:00:00Z"
}
```

`POST /vision/uploads/:id/parts` returns short-lived signed URLs for a requested range of part
numbers. Clients re-request expired parts rather than restarting.

**Partner variant:** the same three endpoints exist under `/vision/partner-uploads/*`,
authenticated by an upload-grant token instead of an admin session. Scoped to one key, one
session, and nothing else.

### Assets — `vision/assets`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/vision/assets` | `vision.read` |
| `GET` | `/vision/assets/:id` | `vision.read` |
| `PATCH` | `/vision/assets/:id/match-link` | `vision.sources.write` |
| `GET` | `/vision/assets/:id/playback` | `vision.read` + rights `canAnalyze` |
| `GET` | `/vision/assets/:id/duplicates` | `vision.read` |
| `POST` | `/vision/assets/:id/segments` | `vision.annotate` |
| `POST` | `/vision/assets/:id/jobs` | `vision.jobs.run` |

`/playback` returns a short-lived signed URL for the **proxy**, never the master, and is
rights-checked at issue. Raw master playback requires `vision.media.raw.read` and writes an audit
entry — that is the youth-footage gate.

`PATCH /match-link` binds the asset to `SbMatch`, teams, and rosters. Required before any
inference job may be queued.

### Jobs — `vision/jobs`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/vision/jobs` | `vision.read` |
| `GET` | `/vision/jobs/:id` | `vision.read` |
| `POST` | `/vision/jobs/:id/retry` | `vision.jobs.run` |
| `POST` | `/vision/jobs/:id/cancel` | `vision.jobs.run` |
| `GET` | `/vision/jobs/:id/events` | `vision.read` |

Progress is polled. No SSE or WebSocket in V1 — the existing app has one WebSocket already (live
audio commentary) and a 2 GB box does not need a second long-lived connection per open dashboard.
Poll at 5 s while a job page is open.

### Review — `vision/review`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/vision/review/:assetId/timeline` | `vision.read` |
| `GET` | `/vision/review/:assetId/tracks` | `vision.read` |
| `GET` | `/vision/review/tracks/:trackId/crops` | `vision.review` |
| `POST` | `/vision/review/tracks/:trackId/identity` | `vision.review` |
| `POST` | `/vision/review/tracks/merge` | `vision.review` |
| `POST` | `/vision/review/tracks/:trackId/split` | `vision.review` |
| `POST` | `/vision/review/events` | `vision.review` |
| `PATCH` | `/vision/review/events/:id` | `vision.review` |
| `POST` | `/vision/review/events/:id/decision` | `vision.review` |
| `POST` | `/vision/review/events/:id/promote` | `vision.publish` |
| `GET` | `/vision/review/queue` | `vision.review` |

Every write here **creates a superseding row**; none of them update a prediction in place. The
response returns both the new row and the ID it supersedes, so the UI can show what changed.

`POST /vision/review/events/:id/promote` is the bridge into `SbMatchEvent`. It requires an
accepted review decision and a valid `canPublishHighlight`/publication rights check.

### Datasets and models

| Method | Path | Permission |
|---|---|---|
| `GET` | `/vision/datasets` | `vision.read` |
| `POST` | `/vision/datasets` | `vision.datasets.manage` |
| `POST` | `/vision/datasets/:id/members` | `vision.datasets.manage` |
| `POST` | `/vision/datasets/:id/split` | `vision.datasets.manage` |
| `GET` | `/vision/datasets/:id/leakage-report` | `vision.read` |
| `GET` | `/vision/datasets/:id/representation` | `vision.read` |
| `POST` | `/vision/datasets/:id/freeze` | `vision.datasets.manage` |
| `POST` | `/vision/datasets/:id/export` | `vision.datasets.manage` |
| `GET` | `/vision/models` | `vision.read` |
| `POST` | `/vision/models` | `vision.models.train` |
| `GET` | `/vision/models/versions/:id` | `vision.read` |
| `POST` | `/vision/models/:id/versions` | `vision.models.train` |
| `POST` | `/vision/models/versions/:id/benchmark` | `vision.models.train` |
| `GET` | `/vision/models/versions/:id/benchmarks` | `vision.read` |
| `GET` | `/vision/models/benchmarks/:id` | `vision.read` |
| `POST` | `/vision/models/versions/:id/promotion-request` | `vision.models.train` |
| `POST` | `/vision/models/versions/:id/promote` | `vision.models.promote` |
| `POST` | `/vision/models/versions/:id/rollback` | `vision.models.promote` |

`POST /vision/datasets/:id/freeze` runs the full gate before freezing: rights re-check on every
member, leakage validation, representation report. It fails loudly with the list of offending
members rather than freezing a dirty dataset.

The split between `promotion-request` (`models.train`) and `promote` (`models.promote`) is the
two-person rule from [04-DATA-MODEL.md](./04-DATA-MODEL.md#rbac-extends-the-existing-catalogue).

`POST /vision/models/:id/versions` refuses a version whose `licenceNote` is blank, or whose
`datasetVersionId` names a draft, a version holding revoked footage, or one that trains on another
frozen version's gold — the same three refusals the export makes, because registering the version
is how a training run would be *recorded*. There is no route that changes a version's `stage`
until the benchmark ledger exists to justify one.

`POST /vision/annotation/tasks/:id/submit` accepts `boxes` in the payload: each
`{ sourceTimeMs, class, x, y, width, height, uncertain?, fromModelVersionId? }`, with the time
in SOURCE milliseconds inside the task's half-open window, the class one of the contract's
four, and the geometry normalised to the proxy frame. A bad box set is `400 InvalidBoxes`
with every problem and its index; nothing is written. The same rule
(`validateAnnotationBoxes` in the contracts) runs again at export, where a failure is
`boxes_invalid`. See [29-PHASE-3-INCREMENT-2.md](./29-PHASE-3-INCREMENT-2.md).

`POST /vision/models/versions/:id/benchmark` takes `{ datasetVersionId }` and refuses a draft
or revoked version, one with no gold split, gold one reviewer short, a version never exported,
or a gold member with no succeeded `detect` job by this exact model version
(`DetectionsMissing`, naming them). It queues a `benchmark` job on `cpu_small` whose inputs
list every object the worker may read; the worker fetches each with `input-url`
`{ role: "declared", key }`, and any key not on the job's list is refused. The completion
becomes `VisionMetricResult` rows per `(metric, slice)` and a verdict under the configured
thresholds version, and moves the version `candidate → benchmarked`. See
[30-PHASE-3-INCREMENT-3.md](./30-PHASE-3-INCREMENT-3.md).

`POST /vision/jobs` accepts `modelVersionId` for a model-bound job type (`MODEL_TASK_BY_JOB_TYPE`
in the contracts). Omitted, the single `production` version for the task is used; with none, the
job is refused (`NoProductionModel`) rather than run against whichever version happened to exist.
Any stage downstream of `transcode` is dispatched with the proxy's clock under
`inputs.params.proxy` (`{ fps, sourceOffsetMs }`), resolved from the variant row at enqueue; a
caller's own `params.proxy` is overwritten, not trusted.

`POST /vision/worker/jobs/:id/complete` refuses, with `403 ProvenanceMismatch`, a completion whose
`modelVersionIds` is not exactly the version the job was dispatched with, and with
`403 WeightsMismatch` one whose `summary.weightsSha256` differs from the checksum the version is
pinned to. The first accepted completion that reports a checksum pins the version to it. See
[28-PHASE-3-INCREMENT-1.md](./28-PHASE-3-INCREMENT-1.md).

### Highlights, metrics, scout search

| Method | Path | Permission |
|---|---|---|
| `GET` | `/vision/highlights` | `vision.read` |
| `POST` | `/vision/highlights/:id/regenerate` | `vision.publish` |
| `POST` | `/vision/highlights/:id/publish` | `vision.publish` + rights |
| `POST` | `/vision/highlights/:id/unpublish` | `vision.publish` |
| `GET` | `/vision/players/:playerId/evidence` | `vision.read` |
| `GET` | `/vision/players/:playerId/metrics` | `vision.read` |
| `POST` | `/vision/search` | `vision.evidence.search` |

`POST /vision/search` returns clip IDs, timestamps, and evidence references — never a free-text
answer. Results are rights-filtered per row at query time, not filtered in the UI.

---

## Worker surface

Separate guard, separate token. See
[06-JOBS-AND-COMPUTE.md](./06-JOBS-AND-COMPUTE.md#the-worker-api).

```
POST /vision/worker/register
POST /vision/worker/jobs/claim
POST /vision/worker/jobs/:id/heartbeat
POST /vision/worker/jobs/:id/presign
POST /vision/worker/jobs/:id/complete
POST /vision/worker/jobs/:id/fail
```

Hard rule: **no worker endpoint accepts an admin session, and no admin endpoint accepts a worker
token.** Enforced by distinct guards and covered by a test asserting cross-use returns 401.

---

## The prediction envelope

Every machine-produced fact, in every stage, in every artifact, uses the same wrapper. One shape
means one review UI, one provenance drawer, one supersede mechanism.

```jsonc
{
  "id": "…",
  "videoAssetId": "…",
  "sbMatchId": "…",
  "sourceTimeMs": 347812,          // authoritative: time in the SOURCE, not the proxy
  "proxyTimeMs": 347812,           // what the player seeks to
  "frameIndex": 8695,              // in the constant-FPS proxy
  "modelVersionId": "detector-…",
  "datasetVersionId": "…",         // what the model was trained on
  "prediction": { },               // stage-specific payload
  "confidence": 0.91,
  "qualityFlags": ["wide_shot", "platform_copy"],
  "reviewState": "unreviewed",     // unreviewed | accepted | corrected | rejected
  "supersededBy": null,
  "createdAt": "…"
}
```

Notes that matter:

- **`sourceTimeMs` and `proxyTimeMs` are both present.** They diverge whenever the source is
  variable-frame-rate or the proxy was trimmed. Storing only one is how annotations end up
  pointing at the wrong moment after a re-transcode.
- **`qualityFlags` are the benchmark slices.** They are attached at prediction time because
  reconstructing them later is guesswork.
- **`reviewState` and `supersededBy` are on the prediction, not in a side table.** The
  ground-truth hierarchy is visible in the shape of the data.

Absent values are `null`, never a plausible default. A missing ball position is `null` with a
`ball_unknown` flag, never a last-known coordinate carried forward.

---

## Outbound contracts

The Vision Engine writes into existing product surfaces through explicit, versioned contracts —
never by writing to another module's tables directly.

| Destination | Contract | Notes |
|---|---|---|
| ScoreBoard events | `VisionEventPromotionV1` | Creates `SbMatchEvent` with a reference back to the candidate. See [D10](./02-DECISIONS.md#d10--highlights-and-events-collide-with-existing-models). |
| Highlights | `VisionHighlightPublicationV1` | Creates or updates `SbHighlight`. Needs the `mediaUrl` widening in Phase 7. |
| Player profile | `VisionPlayerEvidenceV1` | Read model consumed by the profile page; approved evidence only. |
| Rating Engine | `VisionFeatureSetV1` | Versioned feature contract. Rating formulas never change silently because a Vision model was retrained. |

Every contract carries a version in its name. A breaking change is a new version with both
supported during migration — the existing ScoreBoard and profile surfaces keep working throughout.

---

## Error shape

Follows the existing API's conventions, with a Vision-specific rights case that the UI must handle
distinctly:

```jsonc
{
  "statusCode": 403,
  "error": "RightsDenied",
  "message": "Training rights are not granted for this source.",
  "reason": "no_scope",                 // RightsDenialReason enum
  "assetId": "…",
  "remediation": "Attach rights evidence and grant canTrain on the source record."
}
```

A rights denial always tells the operator what to do next. "Forbidden" with no reason produces a
support ticket; this produces an action.
