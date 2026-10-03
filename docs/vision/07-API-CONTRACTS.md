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
| `GET` | `/vision/assets/:id/tracks` | `vision.read` |
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
| `GET` | `/vision/review/:assetId/media` | `vision.read` |
| `GET` | `/vision/review/tracks/:trackId/positions` | `vision.read` |
| `POST` | `/vision/review/jobs/:jobId/sides` | `vision.review` |
| `GET` | `/vision/review/tracks/:trackId/candidates` (`?all=1` for the whole match squad) | `vision.read` |
| `POST` | `/vision/review/tracks/:trackId/identity` | `vision.review` |
| `POST` | `/vision/review/identity/:id/accept` | `vision.review` |
| `POST` | `/vision/review/identity/:id/reject` | `vision.review` |
| `GET` | `/vision/assets/:id/identity?public=1` | `vision.read` |
| `GET` | `/vision/review/:assetId/clock` (`?sourceMs` reads a moment) | `vision.read` |
| `POST` | `/vision/review/:assetId/clock` | `vision.review` |
| `GET` | `/vision/review/:assetId/game-state` | `vision.read` |
| `GET` | `/vision/overview` (counts for the environment's shell) | `vision.read` |
| `GET` | `/vision/assets` (`?ingestState`, `?partnerId`, `?q`; each with proxy and latest stage runs) | `vision.read` |
| `GET` | `/vision/workers` | `vision.read` |
| `POST` | `/vision/partners/:id/evidence/file` (multipart `file` + `kind`; the document through the API) | `vision.rights.manage` |
| `GET` | `/vision/review/:assetId/events` (`?all=1` includes superseded) | `vision.read` |
| `GET` | `/vision/review/events/:id` | `vision.read` |
| `POST` | `/vision/review/events` | `vision.review` |
| `PATCH` | `/vision/review/events/:id` | `vision.review` |
| `POST` | `/vision/review/events/:id/decision` | `vision.review` |
| `POST` | `/vision/review/events/:id/promote` | `vision.publish` |
| `GET` | `/vision/review/queue` (`?assetId`, `?limit`; as built — [49](./49-PHASE-6-INCREMENT-3.md)) | `vision.review` |

Every write here **creates a superseding row**; none of them update a prediction in place. The
response returns both the new row and the ID it supersedes, so the UI can show what changed.

`POST /vision/review/events/:id/promote` is the bridge into `SbMatchEvent`. It requires an
accepted review decision and a valid `canPublishHighlight`/publication rights check.

**Event candidates, as built** ([44-PHASE-6-INCREMENT-1.md](./44-PHASE-6-INCREMENT-1.md)).
`POST /vision/review/events` files a person's candidate: `{ videoAssetId, type, startMs, endMs,
actorTrackId?, actorMatchSquadPlayerId?, sbTeamId?, confidence?, note?, evidence? }` with `type` from
`VISION_EVENT_TYPES` under `VISION_EVENT_TAXONOMY_VERSION` (`EventNeedsAPerson`,
`EventOutsideAsset`, `ActorNotOnThisAsset`, `NotOnThisMatchSquad`, `TeamNotInThisMatch`). The
service finds the evidence itself — the actor track, the identity current on it at that moment,
the camera segment covering the start and its calibration, the half's clock anchor — and adds the
caller's links beside them; a candidate inside a `replay`, `intro` or `halftime` segment is
`inPlay: false`. `PATCH /vision/review/events/:id` is a correction: a new unreviewed row
superseding the old (`EventSuperseded`, `EventPromoted`). `POST .../decision`
`{ decision: accepted | rejected, reason? }` is a second person's (`SelfAcceptanceRefused`,
`ReasonRequired`). `POST .../promote` `{ create? }` needs, in order, acceptance (`NotAccepted`), a
linked match (`NoMatchLinked`), a recorder type for the candidate's type (`NoScoreBoardType`;
only `goal_candidate` → `goal` today), play (`NotInPlay`, re-checked against the segments as
they are then), publication rights (`PublicationRightsRefused`) and an anchored clock
(`ClockNotAnchored`); it then *enriches* the recorder's event of that type within a minute,
compatible on team and player, by writing `metadata.vision` (`VisionEventPromotionV1`) on it —
or, with `create: true`, where none matches and the team is known, creates one at the candidate's
match minute (`NoMatchingEvent` names the nearest; `AmbiguousRecorderEvent` when two are equally
near; `TeamUnknown`; `AlreadyPromoted`). The reads return each candidate with its `evidence`,
`matchClock`, `scoreboardType` and `promotable`.

**The second, and the queue** ([49-PHASE-6-INCREMENT-3.md](./49-PHASE-6-INCREMENT-3.md)).
Promotion also writes `SbMatchEvent.secondInMinute`, the sub-minute widening D10 planned: on a
created event always; on an enriched one only when the candidate's minute *is* the recorder's and
the recorder entered no second. The minute is never rewritten. The reply's `promotion` carries
`second` (what the row now holds, or null) beside `minute` and `minutesApart`.
`GET /vision/review/queue` is what a signed-in reviewer should look at next: every current,
unreviewed identity assignment and event candidate that is *not their own*, oldest first, as
`items` of `kind: event | identity` (`REVIEW_QUEUE_KINDS`) each with `sourceMs` (the start of its
window), `matchClock`, `asset: { title, match }`, `decidedBy`, `createdAt` and, for an identity,
`trackId`, `localTrackId` and the `slot` named; `waiting: { events, identities }` counts the whole
queue before `limit` (default 100, at most 500) cuts it. The operator key has no queue
(`EventNeedsAPerson`).

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
| `POST` | `/vision/models/promotions/:id/reject` | `vision.models.promote` |
| `POST` | `/vision/models/versions/:id/rollback` | `vision.models.promote` |
| `GET` | `/vision/models/versions/:id/promotions` | `vision.read` |
| `GET` | `/vision/models/promotions/:id` | `vision.read` |

`POST /vision/datasets/:id/freeze` runs the full gate before freezing: rights re-check on every
member, leakage validation, representation report. It fails loudly with the list of offending
members rather than freezing a dirty dataset.

The split between `promotion-request` (`models.train`) and `promote` (`models.promote`) is the
two-person rule from [04-DATA-MODEL.md](./04-DATA-MODEL.md#rbac-extends-the-existing-catalogue).
Both need a signed-in person: the shared operator key is refused (`403 PromotionNeedsAPerson`)
at both ends, and the approver may not be the requester (`403 SelfPromotionRefused`). A request
runs the seven checkable gate conditions and is refused by name (`409 PromotionGateFailed`, with
`failures`, `warnings` and `passed`); approval runs them again. Promotion to production demotes the
incumbent to `staging` and records it on the request; `rollback` restores exactly that. See
[31-PHASE-3-INCREMENT-4.md](./31-PHASE-3-INCREMENT-4.md).

`POST /vision/models/:id/versions` refuses a version whose `licenceNote` is blank, or whose
`datasetVersionId` names a draft, a version holding revoked footage, or one that trains on another
frozen version's gold — the same three refusals the export makes, because registering the version
is how a training run would be *recorded*. There is no route that changes a version's `stage`
until the benchmark ledger exists to justify one.

`POST /vision/annotation/tasks/:id/submit` accepts `boxes` in the payload: each
`{ sourceTimeMs, class, x, y, width, height, uncertain?, fromModelVersionId?, trackId? }`, with the time
in SOURCE milliseconds inside the task's half-open window, the class one of the contract's
four, and the geometry normalised to the proxy frame. A bad box set is `400 InvalidBoxes`
with every problem and its index; nothing is written. The same rule
(`validateAnnotationBoxes` in the contracts) runs again at export, where a failure is
`boxes_invalid`. See [29-PHASE-3-INCREMENT-2.md](./29-PHASE-3-INCREMENT-2.md). A `trackId` links
boxes across frames: one class per track and one box per frame (`track_class_conflict`,
`track_frame_conflict`); the export carries it as FiftyOne `index`. See
[33-PHASE-4-INCREMENT-2.md](./33-PHASE-4-INCREMENT-2.md).

`POST /vision/models/versions/:id/benchmark` scores a detector against gold boxes or a tracker
against gold tracks (`TracksMissing` names gold members with no succeeded `track` job by that
version; the job carries `task: "track"` and reports `mota`, `idf1`, `idsw`, `frag`, `tracks`).
It takes `{ datasetVersionId }` and refuses a draft
or revoked version, one with no gold split, gold one reviewer short, a version never exported,
or a gold member with no succeeded `detect` job by this exact model version
(`DetectionsMissing`, naming them). It queues a `benchmark` job on `cpu_small` whose inputs
list every object the worker may read; the worker fetches each with `input-url`
`{ role: "declared", key }`, and any key not on the job's list is refused. The completion
becomes `VisionMetricResult` rows per `(metric, slice)` and a verdict under the configured
thresholds version, and moves the version `candidate → benchmarked`. See
[30-PHASE-3-INCREMENT-3.md](./30-PHASE-3-INCREMENT-3.md).

`POST /vision/jobs` with `type: "track"` resolves a tracker version like any model-bound job,
and declares the detect artifact the worker will link: the latest succeeded `detect` for the asset,
or the one in `params.detectJobId`. It refuses `DetectionsMissing` when none carries an artifact and
`DetectionsTooSparse` when the detections were sampled below `MIN_TRACK_SAMPLE_FPS`. The completion
becomes one `VisionTrack` row per confirmed track, naming both the tracker and the detector;
`GET /vision/assets/:id/tracks` lists them. See [32-PHASE-4-INCREMENT-1.md](./32-PHASE-4-INCREMENT-1.md).

`POST /vision/jobs` with `type: "identify"` resolves an identify version (kit clustering,
registered as a model so every assignment names what made it) and declares the track artifact it
assigns teams on: the latest succeeded `track` for the asset, or the one in `params.trackJobId`,
refusing `TracksMissing` otherwise. It runs on `cpu_small`, reads the proxy by role and the
artifact by declared key, and its completion becomes one `VisionTeamAssignment` per track —
`team` `A`, `B` or `null` (unknown is an answer), `confidence`, `method` (`kit_cluster`,
`kit_outlier`, `not_clustered`), `kitDescription`, and `reviewState: unreviewed`. The tracks route
returns each track's latest assignment as `teamAssignments[0]`. See
[34-PHASE-4-INCREMENT-3.md](./34-PHASE-4-INCREMENT-3.md).

**Identity** is a person's word, never a machine's. `POST /vision/review/jobs/:jobId/sides` says
which of the match's two teams cluster `A` and `B` are (`SidesSame`, `SidesNotTheMatch`,
`NotAnIdentifyJob`); `GET /vision/review/tracks/:trackId/candidates` is the track's side's match
squad, or the whole squad when nothing narrows it, with a stated clock caveat; `POST
/vision/review/tracks/:trackId/identity` writes one `VisionIdentityAssignment` for a window of the
track (`matchSquadPlayerId` or `null` for unknown; `validFromMs`/`validToMs` default to the track;
`propagateTo` writes the same person onto other tracks as `propagated` rows; `acceptSideMismatch`
overrules the kit and marks its side `corrected`). Refusals: `IdentityNeedsAPerson`,
`WindowOutsideTrack`, `WindowEmpty`, `NotOnThisMatchSquad`, `SideDisagrees`,
`PropagateTargetInvalid`, `PropagateUnknownRefused`. A new window supersedes every current
assignment it overlaps -- a split is two windows, a merge is propagation, there is no merge or
split of tracks themselves. `accept` needs a second person (`SelfAcceptanceRefused`;
`AssignmentSuperseded`); `reject` takes a reason. `GET /vision/assets/:id/identity?public=1` returns
only accepted, named, current assignments, and is the only read anything public may make. See
[35-PHASE-4-INCREMENT-4.md](./35-PHASE-4-INCREMENT-4.md).

The review screen plays `GET /vision/review/:assetId/media` (a presigned proxy, never the
master, with its clock and picture size) and draws tracks from
`GET /vision/review/tracks/:trackId/positions`, which reads the track artifact through the
control plane -- a browser cannot read the bucket -- caches it by key, and refuses one over
32 MB (`ArtifactTooLarge`) or missing (`ArtifactMissing`). The review view carries each
identity's roster `slot` and the match's two teams. The planned `crops` route is dropped: the
proxy frame with the box on it serves the need. See
[36-PHASE-4-INCREMENT-5.md](./36-PHASE-4-INCREMENT-5.md).

`POST /vision/models/versions/:id/benchmark` for an **identify** version is scored in the control
plane, from rows, and the run comes back already `completed` with `jobId: null`: team accuracy,
coverage and unknown precision (`IDENTITY_METRIC_NAMES`) over tracks whose identity two people
accepted, on `all` and per kit colour, with `summary.unit: "tracks"`. It refuses
`TeamAssignmentsMissing` (a gold member with no identify job by the version), `SidesNotDecided`
and `IdentitiesMissing` after the dataset rules every run has. See
[37-PHASE-4-INCREMENT-6.md](./37-PHASE-4-INCREMENT-6.md).

**Calibration** (`vision.review` to write, `vision.read` to read): `GET /vision/calibration/landmarks`
(`?lengthM&widthM`) is the pitch's landmark catalogue placed from its dimensions; `POST
/vision/calibration/preview` fits the clicked points and returns the homography, its
reprojection error in metres and pixels and a `quality`, saved nowhere. `POST
/vision/review/:assetId/camera-segments` declares a segment (`SegmentEmpty`,
`SegmentOutsideAsset`, `SegmentOverlaps`; the operator key is refused with
`CalibrationNeedsAPerson`) and `GET` lists them with each one's current calibration and coverage.
`POST /vision/review/camera-segments/:id/calibration` files a person's calibration, superseding the
segment's current one, and refuses `CalibrationDegenerate` when no homography can be made. `GET
/vision/review/tracks/:trackId/pitch-positions` is the first coordinate anyone can derive and is
under the suppression rule: positions in metres only through a calibration that passed the bar,
and `distance` is `{ suppressed: true, reason }` unless every position was placed. See
[38-PHASE-5-INCREMENT-1.md](./38-PHASE-5-INCREMENT-1.md).

The preview and a filed calibration also carry `overlay` — the pitch's markings projected into
proxy pixels through the inverse homography, each polyline broken at the horizon — and
`reprojected`, each click's position as the fit would place it with its error in metres; a filed
calibration carries its `clicked` points so the editor can load them back. See
[40-PHASE-5-INCREMENT-3.md](./40-PHASE-5-INCREMENT-3.md).

**The match clock.** `POST /vision/review/:assetId/clock` files a person's anchor for a half —
`{ half, sourceMs, endMs? }`, the kick-off and optionally the whistle ending it — superseding the
half's current anchor (`ClockNeedsAPerson`, `HalfUnknown`, `AnchorOutsideAsset`,
`HalfEndsBeforeItStarts`, `HalfOutOfOrder`). `GET /vision/review/:assetId/clock?sourceMs=` returns
the anchors and where that millisecond falls, broadcast minutes (`47:12`), or `before_kickoff`,
`between_halves`, `after_play`, `unanchored`. The review view carries `clock` and each track's
`matchClock`; once anchored, a track's candidates carry `onPitch` (`yes` | `partly`, the `no`s
removed) and a `window` with what the clock removed, substitutions applied from the match record.
See [41-PHASE-5-INCREMENT-4.md](./41-PHASE-5-INCREMENT-4.md).

**Game state.** `POST /vision/jobs` with `type: "gamestate"` queues the placement stage on
`cpu_small` after `track`, refusing `TracksMissing` and `NoCalibration` (no camera segment has a
calibration); optional `params.chunkMs`. The job is handed the track artifact by declared key,
every camera segment on the asset with its current calibration or nulls, and the clock anchors —
none of which a caller can supply. The stage writes Parquet chunks (`gamestate_chunk`, one row
per track per frame: `frame_index, source_ms, half, match_minute, local_track_id, class, x_m, y_m,
camera_segment_id, quality, reason`) and an index (`gamestate`) with each chunk's key, time range
and coverage; `x_m`/`y_m` are null with a `reason` (`no_camera_segment`,
`segment_not_calibrated`, `calibration_failed`, `beyond_horizon`) wherever no calibration passed
the bar. The completion lands nothing in Postgres beyond the job's summary. `GET
/vision/review/:assetId/game-state` returns the latest succeeded job's `coverage`
(`validFrameCoverage` is the share of frames a passing calibration covered), `placedWith`
(segments, calibrations, anchors), `trackJobId`, the `pitch` dimensions the placement used, and
a presigned URL for the index and for each chunk with the chunk's `index`, `fromMs` and `toMs`
(from its name and the job's chunk size); the API reads none of the rows. The minimap in the
identity workstation fetches and decodes the chunks in the browser
([43-PHASE-5-INCREMENT-6.md](./43-PHASE-5-INCREMENT-6.md)), which needs the derived bucket's
CORS rule to allow `GET` from the UI's origin. See
[42-PHASE-5-INCREMENT-5.md](./42-PHASE-5-INCREMENT-5.md).

`POST /vision/jobs` with `type: "cuts"` queues the scene-change proposer on `cpu_small` after
`transcode`, with optional `params.threshold` and `params.minSegmentMs`; its completion files
proposed segments as `source: scene_detect`, kind `unknown`, skipping any that overlap a segment
a person declared or calibrated, replacing earlier uncalibrated proposals, and adding nothing on
a retry. `DELETE /vision/review/camera-segments/:id` removes a segment with no calibration
(`SegmentCalibrated` otherwise; a person only). See
[39-PHASE-5-INCREMENT-2.md](./39-PHASE-5-INCREMENT-2.md).

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
POST /vision/worker/jobs/:id/input-url
POST /vision/worker/jobs/:id/complete
POST /vision/worker/jobs/:id/fail
```

A job that has moved on answers `409 JobNotClaimable`; one held by another worker,
`403 JobNotHeldByWorker`. A worker that gets either on a heartbeat stops work on the
job and does not report on it. `input-url` with `role: "proxy"` resolves to the asset's
newest proxy variant, or `409 ProxyNotTranscoded` ([53](./53-QA-FIX-3-JOB-PROTOCOL.md)).

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
