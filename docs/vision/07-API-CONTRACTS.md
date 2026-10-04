# 07 — API contracts

All routes sit under the existing global prefix `api/v1` and are guarded by the existing
`AdminAuthGuard` + `PermissionsGuard`, except the worker surface, which has its own guard.

Conventions follow the existing API: NestJS controllers, `class-validator` DTOs, the global
`ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })`, and
`@RequirePermissions(...)` on every route.

**Which routes exist.** The tables in the sections below were written as the design and
edited by hand as routes landed; they explain what a route is for. The list of what the
code has is [Every route, as built](#every-route-as-built) at the end, which is generated
from the controllers and checked by a test. A route a table below names that was never
built says *not built* in its row ([62](./62-QA-FIX-12-DOCS.md)).

---

## Admin surface

### Sources and rights — `vision/sources`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/vision/sources` | `vision.read` |
| `POST` | `/vision/sources` | `vision.sources.write` |
| `PATCH` | `/vision/sources/:id` | not built: a source record is not edited after it is filed |
| `GET` | `/vision/sources/:id` | `vision.read` |
| `POST` | `/vision/sources/import` | `vision.sources.write` |
| `GET` | `/vision/partners` | `vision.read` |
| `POST` | `/vision/partners` | `vision.sources.write` |
| `GET` | `/vision/partners/:id/evidence` | `vision.read` |
| `POST` | `/vision/partners/:id/evidence` | `vision.rights.manage` |
| `POST` | `/vision/partners/:id/signatories` | `vision.rights.manage` |
| `POST` | `/vision/rights/scopes` | `vision.rights.manage` |
| `POST` | `/vision/rights/scopes/:id/revoke` | `vision.rights.manage` |
| `POST` | `/vision/sources/:id/refuse-acquisition` | `vision.rights.manage` |
| `POST` | `/vision/upload-grants/:id/revoke` | `vision.rights.manage` |
| `POST` | `/vision/sources/:id/authorize-acquisition` | `vision.rights.manage` |
| `POST` | `/vision/sources/:id/upload-grant` | `vision.rights.manage` |
| `GET` | `/vision/sources/:id/impact` | `vision.read` |

`POST /vision/sources/import` accepts CSV or JSON of catalog metadata only — partner, channel,
external ID, title, duration, published date. **It never fetches a video.** A row created this way
has `acquisitionStatus = catalogued` and cannot reach a dataset.

Evidence and signatories belong to the partner, and a rights scope is its own thing with a
level (partner, source or player), so their routes are `/vision/partners/:id/…` and
`/vision/rights/scopes`. This table had them under `/vision/sources/:id/…`, where they were
never built.

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
| `GET` | `/vision/assets/:id` | not built: the list carries what the Footage page shows |
| `PATCH` | `/vision/assets/:id/match-link` | not built: an asset takes its match from its source record ([46](./46-WORKER-ON-THE-BOX.md)) |
| `GET` | `/vision/assets/:id/playback` | not built: `GET /vision/review/:assetId/media` serves the proxy |
| `GET` | `/vision/assets/:id/duplicates` | not built |
| `GET` | `/vision/assets/:id/tracks` | `vision.read` |
| `GET` | `/vision/assets/:id/identity` (`?public=1`) | `vision.read` |
| `POST` | `/vision/review/:assetId/camera-segments` | `vision.review` |
| `POST` | `/vision/jobs` | `vision.jobs.run` |

Playback is `GET /vision/review/:assetId/media`: a short-lived signed URL for the **proxy**,
never the master. A worker's read of the master is the only path to it, audited as
`media.raw.read` ([54](./54-QA-FIX-4-RIGHTS.md)).

An asset is bound to its `SbMatch` through its source record, at upload. The planned
`PATCH /match-link` was replaced by that inheritance and never built.

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
| `GET` | `/vision/review/:assetId/timeline` | not built: the screen reads `/tracks`, `/events` and `/camera-segments` |
| `GET` | `/vision/review/:assetId/tracks` (`?job=latest\|all\|<id>`, `?limit=`, `?offset=`) | `vision.read` |
| `GET` | `/vision/review/:assetId/media` | `vision.read` |
| `GET` | `/vision/review/:assetId/positions` (every track of the latest track run) | `vision.read` |
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

**The recorder's minutes** ([55-QA-FIX-5-EVENTS-CLOCK.md](./55-QA-FIX-5-EVENTS-CLOCK.md)).
The minute promotion matches on and writes is the recorder's, not the stopwatch's: the minute
being played counted from one, stopped at the match's own half length, with added time beside
it. The reply's `promotion` is `{ kind, eventId, half, minute, addedMinute, second,
minutesApart }`; matching is within one half, added time counted on. Promotion's refusals now
also include `PromotionStale` (promoted once, and that event has left the match record),
`ClockChangedSinceAcceptance` (the half was anchored or re-anchored after the second person
accepted; the candidate records `acceptedAnchorId`), `ExtraTimeNotRecorded` (the recorder's
record has two halves), `HalfEndNotMarked` (added time in a half whose end whistle is not
marked) and `AlreadyEnriched` (the recorder's event already carries another candidate; 409,
not a 500). `TeamUnknown` also refuses a team that is not one of the match's two. With
`create: true` the goal, the score and the scorer's totals change together, and the row is
marked `metadata.source = "vision"` with `metadata.half` and `metadata.addedMinute`.
`POST .../decision` works only from `unreviewed` (`AlreadyDecided`, 409), and a correction or
decision that loses a race is refused rather than applied twice. The reads add
`promotionStale`; a stale candidate can only be corrected, which starts its review again.
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
| `POST` | `/vision/datasets/:id/splits` | `vision.datasets.manage` |
| `GET` | `/vision/datasets/:id/leakage` | `vision.read` |
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

**Promotion and identity, as fixed** ([57-QA-FIX-7-MODELS.md](./57-QA-FIX-7-MODELS.md)).
`GET /vision/models` returns each version's `pendingPromotion` (`id`, `fromStage`, `toStage`,
`requestedBy`, `requestedByEmail`, `createdAt`) or null. A request, an approval and a rollback
are each one transaction under a lock, conditional on the state read: a second request gets
`PromotionPending`, a second decision `PromotionDecided`, a version that moved `StageChanged`.
`rollback` refuses `RollbackTargetMoved` when what it would restore is no longer in staging and
`AlreadyRolledBack` when it lost a race; its reply adds `alsoDemoted`. The gate's smoke check
counts jobs of the stages that run the model's task, and its record carries `comparedWithAll`.
A benchmark run is judged against the minimums of its model's task. On identity,
`accept` and `reject` work only from `unreviewed` (`AlreadyDecided`); `sides` refuses a
different answer to one already given (`SidesAlreadyDecided`, with `current`) unless the body
carries `override: true`; and an assignment that partly overlaps an earlier one re-files the
part it does not cover, with its decision and review unchanged.

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

**Pipeline maths** ([56-QA-FIX-6-PIPELINE-MATHS.md](./56-QA-FIX-6-PIPELINE-MATHS.md)), contract
`1.12.0`. A camera segment covers `startMs <= t < endMs` everywhere it is read: the worker's
game state, the API's `pitch-positions`, and an event candidate's segment. A `track` job is
also declared `cuts`, the start of every camera segment on the asset but the first, in source
milliseconds; a caller cannot supply them. The tracker ends every live track at a cut and after
`maxAgeMs` (1200) unseen, and its artifact carries `trackedFrames`, every frame it was given as
`[frameIndex, sourceTimeMs]`. A declared homography is oriented, positive `w` for what the
camera sees, by the calibration's own clicked points; a fit whose clicks straddle its horizon
is filed `failed` (`pointsAcrossHorizon` in the preview). Game state adds the reason
`off_pitch` (further than `OFF_PITCH_MARGIN_M`, 5 m, outside the lines), and its coverage
carries `framesTracked` and `coverageBasis`: `validFrameCoverage` is a share of the frames the
tracker was given (`frames_tracked`), or, for a track artifact from before this change, of the
frames with a track on them (`frames_with_tracks`), which reads higher.

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

### The audit trail — `vision/audit`

| Method | Path | Permission |
|---|---|---|
| `GET` | `/vision/audit` | `vision.audit.read` |

Newest first. Filters: `action` (one, or a family ending in a dot such as `identity.`),
`targetKind`, `targetId`, `actor` (an admin id, or part of an email), `method` (`jwt`,
`api_key`, `provision_key`, `none`), `from`, `to`. `limit` is 1 to 200, default 50, and
`cursor` is the `nextCursor` of the page before. The first page also carries `matching` and
`facets`. A filter that cannot be read is `400 AuditFilterInvalid` with the `field`; it is
never dropped. `vision.read` does not open this route, and nothing here writes
([69](./69-AUDIT-TRAIL-SCREEN.md)).

### Highlights, metrics, scout search — Phase 7 and later, not built

The design for the phases after 6. None of these routes exists.

| Method | Path | Permission |
|---|---|---|
| `GET` | `/vision/highlights` | not built · `vision.read` |
| `POST` | `/vision/highlights/:id/regenerate` | not built · `vision.publish` |
| `POST` | `/vision/highlights/:id/publish` | not built · `vision.publish` + rights |
| `POST` | `/vision/highlights/:id/unpublish` | not built · `vision.publish` |
| `GET` | `/vision/players/:playerId/evidence` | not built · `vision.read` |
| `GET` | `/vision/players/:playerId/metrics` | not built · `vision.read` |
| `POST` | `/vision/search` | not built · `vision.evidence.search` |

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

### Provisioning and retiring — `vision/workers`

```
POST /vision/workers/provision
POST /vision/workers/:id/retire
```

An admin with `vision.jobs.run` may call either for any provider. So may the **provision
key**, sent as `x-vision-provision-key`, for the `local` provider only: it is what the
worker on the box holds, the SHA-256 of `vision-worker-provision-v1:` and the operator key
([67](./67-QA-FIX-17-PROVISION-KEY.md)). A wrong key is `401 ProvisionKeyInvalid` and is
not tried as anything else; the key used for another provider, or to retire another
provider's worker, is `403 ProvisionKeyScope`. No other route accepts it. Retiring a
worker that does not exist is `404 NotFound`.

Each provision and each retire that happens writes an audit row, `worker.provisioned` or
`worker.retired`, under whoever did it; the provision key's `actorMethod` is
`provision_key`. The bootstrap token is never in it
([68](./68-QA-FIX-18-WORKER-AUDIT.md)).

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

**Every Vision refusal has this shape** since [64](./64-QA-FIX-14-REFUSAL-SHAPES.md):
`statusCode`, `error` as the refusal's name (`DatasetFrozen`, `WorkerTokenInvalid`,
`NotFound`), `message`, and `remediation`. Some add fields a screen reads, such as `reason`
above or `problems`. A test walks the module and fails on a refusal without a name or a
remediation. Match on `statusCode` and `error`; a `message` is for a person and may be
reworded.

**Contract parity** ([58-QA-FIX-8-CONTRACT-PARITY.md](./58-QA-FIX-8-CONTRACT-PARITY.md)).
`POST /vision/worker/jobs/claim` no longer needs the worker's `contractVersion` to equal the
control plane's. It refuses `400 ContractMismatch` for another major version, a worker newer
than the control plane, a version it cannot read, or a worker behind every stage; otherwise
it hands over only jobs of the stages that worker can serve (`STAGE_CONTRACT_SINCE`).
`POST /vision/review/:assetId/camera-segments` takes `kind` from `CAMERA_SEGMENT_KINDS`
(`live_play`, `replay`, `intro`, `halftime`, `camera_cut`, `unknown`). `DELETE` of a camera
segment refuses `409 SegmentReferenced` while a current event candidate rests on it. Granting
a rights scope refuses `400 RestrictionsInvalid` for a `deny` entry that is not a scope, and
returns `restrictionsWarning` when the grant carries a flag the policy does not understand.

**The workstations** ([59-QA-FIX-9-WORKSTATION.md](./59-QA-FIX-9-WORKSTATION.md)).
`GET /vision/review/:assetId/positions` returns `{ videoAssetId, trackJobId, trackJobs,
positions }`: the positions of every track of the asset's latest track run, keyed by track id,
from one read of the run's artifact. `trackJobs` is how many track runs the asset has, so a
screen can say it is showing the latest. A track the artifact does not hold has an empty list.
The review screen draws from this; the per-track route stays. `GET /vision/overview` counts
`annotationOpen` by the contract's `OPEN_ANNOTATION_TASK_STATES`; it counted two states no
task has and always answered 0.

**Events and refusals** ([63-QA-FIX-13-LOW-FINDINGS.md](./63-QA-FIX-13-LOW-FINDINGS.md)).
An event candidate carries `proposedBy`, the author of the first row in its correction
chain. `POST /vision/review/events/:id/decision` refuses an acceptance with
`403 SelfAcceptanceRefused` from the current row's author and from the first proposer; a
rejection without a reason is `400 ReasonRequired` (it was 409). A correction is
`method: "manual"` with no `modelVersionId`. A promotion refused as `NotInPlay` leaves the
candidate as it was accepted and records `event.promotion.refused` in the audit log. In
the events, promotions, benchmarks and models services an unknown id answers
`404 { error: "NotFound", remediation }`, and `POST /vision/jobs` answers
`400 ModelNotApplicable` or `400 ModelVersionUnknown` where it sent a bare message.

**Performance** ([60-QA-FIX-10-PERFORMANCE.md](./60-QA-FIX-10-PERFORMANCE.md)).
`GET /vision/review/:assetId/tracks` answers for the asset's latest track run unless `job`
names another (`all`, or a job id), a page at a time (`limit`, default 2,000 and at most
5,000; `offset`), and adds `trackJobId`, `trackJobs`, `total`, `offset`, `limit` and
`truncated` to its response. `GET /vision/assets/:id/identity?public=1` takes the same
paging and answers for every run. `GET /vision/review/queue` and `GET /vision/assets` are
unchanged in shape; the first filters and limits in SQL, the second reads the latest job of
each stage. A job's `idempotencyKey` is no longer unique across jobs: two jobs may complete
with the same key, and each job's own retry is still recognised.

---

## Every route, as built

Read from the controllers under `services/api/src/vision`. *Access* is the permission the
route requires of an admin session, or the token it takes when it is not an admin route.
Every admin route also passes `AdminAuthGuard`. To regenerate after adding a route:

```
pnpm --filter @dtp/api vision:routes --write
```

`services/api/scripts/vision-routes.spec.ts` fails when this table and the controllers
disagree, when a table above names a route the code does not have without saying so, and
when a route has neither a permission nor a token guard.

<!-- routes:begin (generated by `pnpm --filter @dtp/api vision:routes --write`; do not edit by hand) -->
| Method | Path | Access | Controller |
|---|---|---|---|
| `GET` | `/vision/annotation/mix` | `vision.read` | `annotation/annotation.controller.ts` |
| `GET` | `/vision/annotation/queue` | `vision.read` | `annotation/annotation.controller.ts` |
| `POST` | `/vision/annotation/queue` | `vision.datasets.manage` | `annotation/annotation.controller.ts` |
| `POST` | `/vision/annotation/queue/:id/convert` | `vision.datasets.manage` | `annotation/annotation.controller.ts` |
| `GET` | `/vision/annotation/schemas` | `vision.read` | `annotation/annotation.controller.ts` |
| `POST` | `/vision/annotation/schemas` | `vision.datasets.manage` | `annotation/annotation.controller.ts` |
| `POST` | `/vision/annotation/schemas/:id/supersede` | `vision.datasets.manage` | `annotation/annotation.controller.ts` |
| `POST` | `/vision/annotation/tasks` | `vision.datasets.manage` | `annotation/annotation.controller.ts` |
| `GET` | `/vision/annotation/tasks/:id` | `vision.read` | `annotation/annotation.controller.ts` |
| `POST` | `/vision/annotation/tasks/:id/abandon` | `vision.datasets.manage` | `annotation/annotation.controller.ts` |
| `POST` | `/vision/annotation/tasks/:id/submit` | `vision.annotate` | `annotation/annotation.controller.ts` |
| `POST` | `/vision/annotation/tasks/claim` | `vision.annotate` | `annotation/annotation.controller.ts` |
| `GET` | `/vision/annotation/versions/:id` | `vision.read` | `annotation/annotation.controller.ts` |
| `POST` | `/vision/annotation/versions/:id/review` | `vision.review` | `annotation/annotation.controller.ts` |
| `GET` | `/vision/assets` | `vision.read` | `assets/assets.controller.ts` |
| `GET` | `/vision/assets/:id/identity` | `vision.read` | `identity/identity.controller.ts` |
| `GET` | `/vision/assets/:id/tracks` | `vision.read` | `jobs/tracks.controller.ts` |
| `GET` | `/vision/audit` | `vision.audit.read` | `audit/audit.controller.ts` |
| `GET` | `/vision/calibration/landmarks` | `vision.read` | `calibration/calibration.controller.ts` |
| `POST` | `/vision/calibration/preview` | `vision.read` | `calibration/calibration.controller.ts` |
| `GET` | `/vision/datasets` | `vision.read` | `datasets/datasets.controller.ts` |
| `POST` | `/vision/datasets` | `vision.datasets.manage` | `datasets/datasets.controller.ts` |
| `GET` | `/vision/datasets/:id` | `vision.read` | `datasets/datasets.controller.ts` |
| `POST` | `/vision/datasets/:id/export` | `vision.datasets.manage` | `datasets/datasets.controller.ts` |
| `POST` | `/vision/datasets/:id/freeze` | `vision.datasets.manage` | `datasets/datasets.controller.ts` |
| `GET` | `/vision/datasets/:id/gold` | `vision.read` | `datasets/datasets.controller.ts` |
| `GET` | `/vision/datasets/:id/leakage` | `vision.read` | `datasets/datasets.controller.ts` |
| `POST` | `/vision/datasets/:id/members` | `vision.datasets.manage` | `datasets/datasets.controller.ts` |
| `GET` | `/vision/datasets/:id/representation` | `vision.read` | `datasets/datasets.controller.ts` |
| `POST` | `/vision/datasets/:id/splits` | `vision.datasets.manage` | `datasets/datasets.controller.ts` |
| `GET` | `/vision/jobs` | `vision.read` | `jobs/jobs.controller.ts` |
| `POST` | `/vision/jobs` | `vision.jobs.run` | `jobs/jobs.controller.ts` |
| `GET` | `/vision/jobs-meta/resource-classes` | `vision.read` | `jobs/jobs.controller.ts` |
| `GET` | `/vision/jobs/:id` | `vision.read` | `jobs/jobs.controller.ts` |
| `POST` | `/vision/jobs/:id/cancel` | `vision.jobs.run` | `jobs/jobs.controller.ts` |
| `GET` | `/vision/jobs/:id/events` | `vision.read` | `jobs/jobs.controller.ts` |
| `POST` | `/vision/jobs/:id/retry` | `vision.jobs.run` | `jobs/jobs.controller.ts` |
| `GET` | `/vision/jobs/dispatcher` | `vision.read` | `jobs/jobs.controller.ts` |
| `POST` | `/vision/jobs/dispatcher/tick` | `vision.jobs.run` | `jobs/jobs.controller.ts` |
| `GET` | `/vision/jobs/queue-depth` | `vision.read` | `jobs/jobs.controller.ts` |
| `GET` | `/vision/models` | `vision.read` | `models/models.controller.ts` |
| `POST` | `/vision/models` | `vision.models.train` | `models/models.controller.ts` |
| `POST` | `/vision/models/:id/versions` | `vision.models.train` | `models/models.controller.ts` |
| `GET` | `/vision/models/benchmarks/:id` | `vision.read` | `models/models.controller.ts` |
| `GET` | `/vision/models/promotions/:id` | `vision.read` | `models/models.controller.ts` |
| `POST` | `/vision/models/promotions/:id/reject` | `vision.models.promote` | `models/models.controller.ts` |
| `GET` | `/vision/models/versions/:id` | `vision.read` | `models/models.controller.ts` |
| `POST` | `/vision/models/versions/:id/benchmark` | `vision.models.train` | `models/models.controller.ts` |
| `GET` | `/vision/models/versions/:id/benchmarks` | `vision.read` | `models/models.controller.ts` |
| `POST` | `/vision/models/versions/:id/promote` | `vision.models.promote` | `models/models.controller.ts` |
| `POST` | `/vision/models/versions/:id/promotion-request` | `vision.models.train` | `models/models.controller.ts` |
| `GET` | `/vision/models/versions/:id/promotions` | `vision.read` | `models/models.controller.ts` |
| `POST` | `/vision/models/versions/:id/rollback` | `vision.models.promote` | `models/models.controller.ts` |
| `GET` | `/vision/overview` | `vision.read` | `vision-status.controller.ts` |
| `POST` | `/vision/partner-uploads` | upload-grant token | `assets/partner-uploads.controller.ts` |
| `GET` | `/vision/partner-uploads/:id` | upload-grant token | `assets/partner-uploads.controller.ts` |
| `POST` | `/vision/partner-uploads/:id/complete` | upload-grant token | `assets/partner-uploads.controller.ts` |
| `POST` | `/vision/partner-uploads/:id/parts` | upload-grant token | `assets/partner-uploads.controller.ts` |
| `GET` | `/vision/partner-uploads/grant` | upload-grant token | `assets/partner-uploads.controller.ts` |
| `GET` | `/vision/partners` | `vision.read` | `sources/sources.controller.ts` |
| `POST` | `/vision/partners` | `vision.sources.write` | `sources/sources.controller.ts` |
| `GET` | `/vision/partners/:id/evidence` | `vision.read` | `sources/sources.controller.ts` |
| `POST` | `/vision/partners/:id/evidence` | `vision.rights.manage` | `sources/sources.controller.ts` |
| `POST` | `/vision/partners/:id/evidence/file` | `vision.rights.manage` | `sources/sources.controller.ts` |
| `POST` | `/vision/partners/:id/signatories` | `vision.rights.manage` | `sources/sources.controller.ts` |
| `GET` | `/vision/review/:assetId/camera-segments` | `vision.read` | `calibration/calibration.controller.ts` |
| `POST` | `/vision/review/:assetId/camera-segments` | `vision.review` | `calibration/calibration.controller.ts` |
| `GET` | `/vision/review/:assetId/clock` | `vision.read` | `clock/clock.controller.ts` |
| `POST` | `/vision/review/:assetId/clock` | `vision.review` | `clock/clock.controller.ts` |
| `GET` | `/vision/review/:assetId/events` | `vision.read` | `events/events.controller.ts` |
| `GET` | `/vision/review/:assetId/game-state` | `vision.read` | `calibration/calibration.controller.ts` |
| `GET` | `/vision/review/:assetId/media` | `vision.read` | `identity/identity.controller.ts` |
| `GET` | `/vision/review/:assetId/positions` | `vision.read` | `identity/identity.controller.ts` |
| `GET` | `/vision/review/:assetId/tracks` | `vision.read` | `identity/identity.controller.ts` |
| `DELETE` | `/vision/review/camera-segments/:id` | `vision.review` | `calibration/calibration.controller.ts` |
| `POST` | `/vision/review/camera-segments/:id/calibration` | `vision.review` | `calibration/calibration.controller.ts` |
| `POST` | `/vision/review/events` | `vision.review` | `events/events.controller.ts` |
| `GET` | `/vision/review/events/:id` | `vision.read` | `events/events.controller.ts` |
| `PATCH` | `/vision/review/events/:id` | `vision.review` | `events/events.controller.ts` |
| `POST` | `/vision/review/events/:id/decision` | `vision.review` | `events/events.controller.ts` |
| `POST` | `/vision/review/events/:id/promote` | `vision.publish` | `events/events.controller.ts` |
| `POST` | `/vision/review/identity/:id/accept` | `vision.review` | `identity/identity.controller.ts` |
| `POST` | `/vision/review/identity/:id/reject` | `vision.review` | `identity/identity.controller.ts` |
| `POST` | `/vision/review/jobs/:jobId/sides` | `vision.review` | `identity/identity.controller.ts` |
| `GET` | `/vision/review/queue` | `vision.review` | `events/events.controller.ts` |
| `GET` | `/vision/review/tracks/:trackId/candidates` | `vision.read` | `identity/identity.controller.ts` |
| `POST` | `/vision/review/tracks/:trackId/identity` | `vision.review` | `identity/identity.controller.ts` |
| `GET` | `/vision/review/tracks/:trackId/pitch-positions` | `vision.read` | `calibration/calibration.controller.ts` |
| `GET` | `/vision/review/tracks/:trackId/positions` | `vision.read` | `identity/identity.controller.ts` |
| `POST` | `/vision/rights/scopes` | `vision.rights.manage` | `sources/sources.controller.ts` |
| `POST` | `/vision/rights/scopes/:id/revoke` | `vision.rights.manage` | `sources/sources.controller.ts` |
| `GET` | `/vision/sources` | `vision.read` | `sources/sources.controller.ts` |
| `POST` | `/vision/sources` | `vision.sources.write` | `sources/sources.controller.ts` |
| `GET` | `/vision/sources/:id` | `vision.read` | `sources/sources.controller.ts` |
| `POST` | `/vision/sources/:id/authorize-acquisition` | `vision.rights.manage` | `sources/sources.controller.ts` |
| `GET` | `/vision/sources/:id/impact` | `vision.read` | `sources/sources.controller.ts` |
| `POST` | `/vision/sources/:id/refuse-acquisition` | `vision.rights.manage` | `sources/sources.controller.ts` |
| `POST` | `/vision/sources/:id/upload-grant` | `vision.rights.manage` | `sources/sources.controller.ts` |
| `POST` | `/vision/sources/import` | `vision.sources.write` | `sources/sources.controller.ts` |
| `GET` | `/vision/status` | `vision.read` | `vision-status.controller.ts` |
| `POST` | `/vision/upload-grants/:id/revoke` | `vision.rights.manage` | `sources/sources.controller.ts` |
| `POST` | `/vision/uploads` | `vision.assets.upload` | `assets/uploads.controller.ts` |
| `DELETE` | `/vision/uploads/:id` | `vision.assets.upload` | `assets/uploads.controller.ts` |
| `GET` | `/vision/uploads/:id` | `vision.assets.upload` | `assets/uploads.controller.ts` |
| `POST` | `/vision/uploads/:id/complete` | `vision.assets.upload` | `assets/uploads.controller.ts` |
| `POST` | `/vision/uploads/:id/parts` | `vision.assets.upload` | `assets/uploads.controller.ts` |
| `POST` | `/vision/worker/jobs/:id/complete` | worker token | `worker/worker.controller.ts` |
| `POST` | `/vision/worker/jobs/:id/fail` | worker token | `worker/worker.controller.ts` |
| `POST` | `/vision/worker/jobs/:id/heartbeat` | worker token | `worker/worker.controller.ts` |
| `POST` | `/vision/worker/jobs/:id/input-url` | worker token | `worker/worker.controller.ts` |
| `POST` | `/vision/worker/jobs/:id/presign` | worker token | `worker/worker.controller.ts` |
| `POST` | `/vision/worker/jobs/claim` | worker token | `worker/worker.controller.ts` |
| `POST` | `/vision/worker/register` | bootstrap token | `worker/worker.controller.ts` |
| `GET` | `/vision/workers` | `vision.read` | `jobs/jobs.controller.ts` |
| `POST` | `/vision/workers/:id/retire` | `vision.jobs.run` or the provision key | `worker/worker-provision.controller.ts` |
| `POST` | `/vision/workers/provision` | `vision.jobs.run` or the provision key | `worker/worker-provision.controller.ts` |
<!-- routes:end -->
