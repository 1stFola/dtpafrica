# 04 — Data model

## Naming rules — read before writing any migration

1. **Every Vision model is prefixed `Vision`.** No exceptions.
2. **Never create a football entity.** `Player`, `SbMatch`, `SbTeam`, `SbCompetition`,
   `SbTeamSquad`, `SbMatchSquadPlayer` already exist and hold live data. Vision models carry
   foreign keys into them.
3. Table names are `@@map`ped to `vision_*` snake_case, matching the existing convention.
4. Columns are `@map`ped to snake_case, matching the existing convention.

Rule 1 is not style. **The schema already contains two match models** — `Match` (line 196, SIP
metrics) and `SbMatch` (line 511). A third bare `match` would be genuinely dangerous: a foreign
key pointing at the wrong one is a silent data-integrity failure that would not surface until
someone published a fact about the wrong fixture.

### Binding to the existing graph

| Vision concept | Binds to |
|---|---|
| The match a video shows | `SbMatch.id` |
| The competition | `SbCompetition.id` |
| A team in the video | `SbTeam.id` |
| A person identified in a track | `Player.id` |
| The roster slot constraining identity | `SbTeamSquad.id` / `SbMatchSquadPlayer.id` |
| Approved event destination | `SbMatchEvent` (via promotion) |
| Approved clip destination | `SbHighlight` (via promotion) |
| Who did something | `AdminUser.id` |

`VisionVideoAsset.sbMatchId` is **nullable**: a partner archive video can be catalogued and even
acquired before anyone has worked out which fixture it is. It becomes required before an
inference job may run.

---

## Entity groups

Prisma sketches below are shape, not final. Field lists are indicative; every one needs indexes,
`createdAt`/`updatedAt`, and a migration reviewed against the live schema.

### 1. Sources, rights and provenance — Phase 0/1

```prisma
model VisionSourcePartner {
  id            String  @id @default(uuid())
  name          String
  academyId     String? @map("academy_id")   // -> Academy, when the partner is an existing academy
  contactName   String?
  contactEmail  String?
  notes         String? @db.Text
  @@map("vision_source_partners")
}

model VisionSourceChannel {
  id          String @id @default(uuid())
  partnerId   String @map("partner_id")
  platform    String                        // youtube | direct | other
  externalId  String? @map("external_id")
  url         String?
  @@map("vision_source_channels")
}

/// A known video in the world. Metadata ONLY. Never trainable on its own.
model VisionSourceVideoRecord {
  id                 String   @id @default(uuid())
  partnerId          String   @map("partner_id")
  channelId          String?  @map("channel_id")
  externalVideoId    String?  @map("external_video_id")
  url                String?
  title              String?
  publishedAt        DateTime? @map("published_at")
  durationSeconds    Int?     @map("duration_seconds")
  sbMatchId          String?  @map("sb_match_id")        // -> SbMatch
  sbCompetitionId    String?  @map("sb_competition_id")  // -> SbCompetition
  sourceQualityRank  String   @map("source_quality_rank") // original_master | authorized_export | platform_copy
  originalAvailable  Boolean  @default(false) @map("original_available")
  acquisitionStatus  String   @map("acquisition_status")  // catalogued | authorized | acquiring | acquired | refused
  acquisitionMethod  String?  @map("acquisition_method")  // see 03-RIGHTS
  videoAssetId       String?  @unique @map("video_asset_id")
  @@map("vision_source_video_records")
}

model VisionRightsEvidence {
  id            String   @id @default(uuid())
  partnerId     String   @map("partner_id")
  kind          String                        // contract | email | consent_form | competition_authorization
  objectKey     String   @map("object_key")   // in the master bucket
  documentDate  DateTime? @map("document_date")
  uploadedBy    String   @map("uploaded_by")  // -> AdminUser
  notes         String?  @db.Text
  @@map("vision_rights_evidence")
}

model VisionRightsScope {
  id                   String    @id @default(uuid())
  sourceVideoRecordId  String?   @map("source_video_record_id")
  partnerId            String?   @map("partner_id")   // partner-wide grant
  playerId             String?   @map("player_id")    // per-player consent -> Player
  canAnalyze           Boolean   @default(false) @map("can_analyze")
  canTrain             Boolean   @default(false) @map("can_train")
  canPublishHighlight  Boolean   @default(false) @map("can_publish_highlight")
  canShareWithScout    Boolean   @default(false) @map("can_share_with_scout")
  grantedAt            DateTime  @map("granted_at")
  expiresAt            DateTime? @map("expires_at")
  revokedAt            DateTime? @map("revoked_at")
  revokedReason        String?   @db.Text @map("revoked_reason")
  restrictions         Json?
  evidenceId           String?   @map("evidence_id")
  @@map("vision_rights_scopes")
}

/// Who at a partner may authorize an acquisition. Q1: Team Managers.
model VisionPartnerAuthorizedSignatory {
  id              String    @id @default(uuid())
  partnerId       String    @map("partner_id")
  name            String
  role            String                          // e.g. "Team Manager"
  contactEmail    String?   @map("contact_email")
  contactPhone    String?   @map("contact_phone")
  authorityEvidenceId String? @map("authority_evidence_id") // -> VisionRightsEvidence
  activeFrom      DateTime  @map("active_from")
  activeTo        DateTime? @map("active_to")
  @@map("vision_partner_authorized_signatories")
}

model VisionDeletionRequest { /* asset, reason, requestedBy, policy outcome, executedAt */ }
model VisionPartnerUploadGrant { /* see 03-RIGHTS-AND-GOVERNANCE */ }
```

`VisionSourceVideoRecord` carries both `partnerId` **and** a nullable `rightsOwnerName`: the partner
granting access is not always the copyright owner of the footage, and conflating them is how an
unauthorized training source gets in. `acquisitionAuthorizedBySignatoryId` records *which* signatory
authorized it.

A rights scope may attach at three levels — partner, source video, or individual player. The
policy service resolves **most specific wins, deny beats allow**: an explicit player-level denial
overrides a partner-wide grant. Per
[Q2](./13-OPEN-QUESTIONS.md#q2--consent-for-minors--resolved-publication-and-scout-sharing-unblocked)
this is exactly how a guardian's withdrawal overrides a partner's grant, and it carries a dedicated test.

### 2. Media — Phase 1

```prisma
model VisionVideoAsset {
  id                    String   @id @default(uuid())
  sourceVideoRecordId   String?  @map("source_video_record_id")
  sbMatchId             String?  @map("sb_match_id")   // nullable until linked
  corpus                String                          // dtp_owned | research_only | experimental
  objectKey             String   @unique @map("object_key")  // master bucket
  bytes                 BigInt
  mimeType              String   @map("mime_type")
  checksumSha256        String   @map("checksum_sha256")
  perceptualFingerprint String?  @map("perceptual_fingerprint")
  duplicateClusterId    String?  @map("duplicate_cluster_id")
  // FFprobe
  container             String?
  videoCodec            String?  @map("video_codec")
  width                 Int?
  height                Int?
  fpsNumerator          Int?     @map("fps_numerator")
  fpsDenominator        Int?     @map("fps_denominator")
  isVariableFrameRate   Boolean  @default(false) @map("is_variable_frame_rate")
  durationMs            Int?     @map("duration_ms")
  ingestState           String   @map("ingest_state")  // uploading | uploaded | probing | normalizing | ready | failed
  @@map("vision_video_assets")
}

model VisionVideoVariant {
  id            String @id @default(uuid())
  videoAssetId  String @map("video_asset_id")
  kind          String                        // proxy | hls | thumbnail | poster
  objectKey     String @map("object_key")
  width         Int?
  height        Int?
  fps           Float?                        // constant by construction for proxy
  // the mapping that makes frame seeking deterministic
  sourceOffsetMs Int   @default(0) @map("source_offset_ms")
  @@map("vision_video_variants")
}

model VisionDuplicateCluster { /* representativeAssetId, method, confidence */ }
model VisionUploadSession    { /* key, uploadId, parts, bytesReceived, expiresAt, grantId */ }
model VisionCameraSegment    { /* assetId, startMs, endMs, kind: live_play|replay|intro|halftime|cut */ }
```

`VisionCameraSegment.kind` starts manual and becomes model-assisted. It exists from Phase 1
because replays and intros are the mechanism behind duplicated events and shortcut learning, and
retrofitting the segment table after events exist is painful.

### 3. Jobs and compute — Phase 0/1

```prisma
model VisionJob {
  id              String    @id @default(uuid())
  type            String                         // transcode | detect | track | calibrate | events | clip | train | benchmark
  resourceClass   String    @map("resource_class") // cpu_small | gpu_24gb | gpu_48gb | gpu_80gb
  state           String                         // queued | claimed | running | succeeded | failed | cancelled | expired
  priority        Int       @default(0)
  videoAssetId    String?   @map("video_asset_id")
  datasetVersionId String?  @map("dataset_version_id")
  modelVersionId  String?   @map("model_version_id")
  inputSpec       Json      @map("input_spec")
  outputPrefix    String    @map("output_prefix")
  attemptNumber   Int       @default(1) @map("attempt_number")
  maxAttempts     Int       @default(3) @map("max_attempts")
  budgetSeconds   Int       @map("budget_seconds")
  budgetUsdCents  Int       @map("budget_usd_cents")
  claimedAt       DateTime? @map("claimed_at")
  heartbeatAt     DateTime? @map("heartbeat_at")
  workerId        String?   @map("worker_id")
  providerRef     String?   @map("provider_ref")   // opaque; provider-specific value, never interpreted
  progress        Json?
  error           Json?
  @@index([state, resourceClass, priority])
  @@map("vision_jobs")
}

model VisionJobEvent { /* append-only job log: state changes, stage completions, warnings */ }
model VisionJobCost  { /* gpuSeconds, cpuSeconds, bytesRead, bytesWritten, apiCostCents, estimatedUsdCents */ }
model VisionWorker   { /* workerId, provider, resourceClass, firstSeen, lastSeen, jobsCompleted */ }
```

`providerRef` is deliberately opaque and deliberately named without a provider in it. Nothing
outside the provider adapter may parse it.

### 4. CV outputs — Phases 3–5

Row-level storage in Postgres is only for things a human reviews or a query filters on. **Dense
per-frame output lives in Parquet in R2**, referenced by key. A 90-minute match at 25 fps with 22
players is roughly 3 million detections; that does not belong in a row store on a 2 GB box.

| In Postgres | In R2 Parquet |
|---|---|
| `VisionTrack` (one row per track) | `VisionDetection` (per frame per object) |
| `VisionTrackSegment` | per-frame track positions |
| `VisionIdentityAssignment` | per-frame pitch coordinates |
| `VisionTeamAssignment` | game-state chunks |
| `VisionJerseyCandidate` | |
| `VisionPitchCalibration` (per camera segment) | per-frame homography |
| `VisionPossessionSegment` | |
| `VisionEventCandidate` | |

A game-state chunk (Phase 5, [42](./42-PHASE-5-INCREMENT-5.md)) is one Parquet file per sixty
seconds of source time under the `gamestate` job's prefix, one row per track per frame:
`frame_index, source_ms, half, match_minute, local_track_id, class, x_m, y_m, camera_segment_id,
quality, reason`. Metres are present only through a calibration that passed the bar; otherwise
`x_m`/`y_m` are null and `reason` says why. A `gamestate.json` index beside the chunks names each
one's key, time range and coverage. The job row keeps the keys and the coverage; nothing else
about a chunk is in Postgres.

```prisma
model VisionTrack {
  id             String @id @default(uuid())
  videoAssetId   String @map("video_asset_id")
  inferenceJobId String @map("inference_job_id")
  localTrackId   Int    @map("local_track_id")
  startMs        Int    @map("start_ms")
  endMs          Int    @map("end_ms")
  detectionCount Int    @map("detection_count")
  artifactKey    String @map("artifact_key")   // Parquet holding this track's frames
  @@map("vision_tracks")
}

model VisionIdentityAssignment {
  id           String  @id @default(uuid())
  trackId      String  @map("track_id")
  playerId     String? @map("player_id")        // -> Player; NULL means unknown, and unknown is valid
  sbTeamSquadId String? @map("sb_team_squad_id") // roster slot that constrained it
  confidence   Float
  method       String                            // jersey | roster_constraint | manual | propagated
  validFromMs  Int     @map("valid_from_ms")     // time-aware: substitutions, kit changes
  validToMs    Int?    @map("valid_to_ms")
  reviewState  String  @map("review_state")      // unreviewed | accepted | corrected | rejected
  supersededBy String? @map("superseded_by")
  @@map("vision_identity_assignments")
}
```

`playerId` nullable is load-bearing. **A null identity is a correct answer.** Nothing in the
schema or the UI may pressure it toward a guess.

`validFromMs`/`validToMs` make identity time-aware, which matters because a jersey number is
reused across substitutions and across matches in youth tournaments.

As built ([35](./35-PHASE-4-INCREMENT-4.md)): the row also names the match roster slot
(`matchSquadPlayerId`, `sbTeamId`), who decided (`decidedBy`) and who accepted (`reviewedBy`),
and `validToMs` is required -- a window is always closed, because a track is. `VisionTeamSide`
(one row per identify job and side, `A`/`B` → `sbTeamId`, `decidedBy`) records which of the
match's two teams a kit cluster is, decided by a person; `VisionTeamAssignment` (from [34](./34-PHASE-4-INCREMENT-3.md))
holds the cluster itself. Both relations to `Player` have their foreign key on the Vision side.
`VisionClockAnchor` ([41](./41-PHASE-5-INCREMENT-4.md)) is the match clock anchored to the
footage: one current row per half per asset, the source millisecond of its kick-off and, when
marked, of its end, superseded never edited.

**Calibration, as built** ([38](./38-PHASE-5-INCREMENT-1.md)): `VisionPitchCalibration` hangs
off `VisionCameraSegment` — one current row per segment, superseded never edited — with the
pitch's actual dimensions, `method` (`manual` | `model`), the clicked `points`, the 3 × 3
`homography` from proxy pixels to metres, the reprojection error in metres and pixels, the
worst point, and a `quality` under a recorded `thresholdsVersion`. Per-frame homographies
stay in object storage when the automatic pipeline produces them; the row is the segment's.

### 5. Events and evidence — Phases 6–7

```prisma
model VisionEventCandidate {
  id              String  @id @default(uuid())
  videoAssetId    String  @map("video_asset_id")
  sbMatchId       String? @map("sb_match_id")
  type            String                        // versioned taxonomy, see 09-ML-PIPELINE
  taxonomyVersion String  @map("taxonomy_version")
  startMs         Int     @map("start_ms")
  endMs           Int     @map("end_ms")
  actorTrackId    String? @map("actor_track_id")
  actorPlayerId   String? @map("actor_player_id")   // -> Player, nullable
  sbTeamId        String? @map("sb_team_id")
  confidence      Float
  modelVersionId  String  @map("model_version_id")
  reviewState     String  @map("review_state")
  promotedEventId String? @unique @map("promoted_event_id")  // -> SbMatchEvent once approved
  supersededBy    String? @map("superseded_by")
  @@map("vision_event_candidates")
}

model VisionEvidenceLink { /* fromKind/fromId -> toKind/toId: event -> tracks, detections, calibration */ }
model VisionClip         { /* objectKey, startMs, endMs, renderState, sourceAssetId */ }
model VisionHighlight    { /* clipId, playerId, eventId, relevanceScore, publishState, promotedHighlightId */ }
model VisionScoutingObservation { /* VLM output: clipId, json, promptVersion, modelVersion, reviewState */ }
model VisionCalculationVersion  { /* metric key, formula, units, prerequisites, code ref */ }
model VisionPlayerMetric        { /* playerId, sbMatchId, key, value, calcVersion, evidenceLinkIds, staleAt */ }
```

*As built* ([44](./44-PHASE-6-INCREMENT-1.md)): `VisionEventCandidate` carries, beside the sketch
above, `actorMatchSquadPlayerId` (the roster slot named), `method` (`manual` | `model`) with
`modelVersionId` nullable because a person's candidate has no model, `cameraSegmentId` and
`inPlay` (flagged inside a replay, intro or halftime segment), `decidedBy` / `reviewedBy` /
`reviewNote`, and `promotionKind` (`enriched` | `created`) with `promotedBy` / `promotedAt`.
`VisionEvidenceLink` is `{ candidateId, kind, targetId, note }` with `kind` from `EVIDENCE_KINDS`.

`promotedEventId` and `promotedHighlightId` are the bridge to the public product — see
[02-DECISIONS.md, D10](./02-DECISIONS.md#d10--highlights-and-events-collide-with-existing-models).
The Vision row stays the evidence of record; the ScoreBoard row is the published projection.

`VisionPlayerMetric.staleAt` is how upstream corrections propagate: rejecting an event stamps
every dependent metric stale and queues recomputation, rather than leaving a wrong number on a
player's profile.

### 6. Training — Phase 2

```prisma
model VisionLabelSchemaVersion { /* version, definitions json, effectiveFrom, authoredBy */ }
model VisionAnnotationTask     { /* assetId, sampling strategy, assignedTo, state, cvatTaskId? */ }
model VisionAnnotationVersion  { /* taskId, payloadKey, annotator, supersedes */ }
model VisionReviewDecision     { /* targetKind, targetId, decision, reviewer, reason, at */ }

model VisionDatasetVersion {
  id                    String   @id @default(uuid())
  label                 String   @unique
  labelSchemaVersionId  String   @map("label_schema_version_id")
  manifestKey           String   @map("manifest_key")
  frozenAt              DateTime? @map("frozen_at")
  containsRevokedMembers Boolean @default(false) @map("contains_revoked_members")
  splitPolicy           Json     @map("split_policy")
  @@map("vision_dataset_versions")
}

model VisionDatasetMember {
  id               String @id @default(uuid())
  datasetVersionId String @map("dataset_version_id")
  videoAssetId     String @map("video_asset_id")
  checksumSha256   String @map("checksum_sha256")  // denormalised on purpose: proves immutability
  split            String                           // train | val | test | gold
  @@unique([datasetVersionId, videoAssetId])
  @@map("vision_dataset_members")
}

model VisionActiveLearningItem { /* assetId, window, reason, score, state */ }
```

`checksumSha256` is copied onto the member rather than read through the asset. If the asset row
is ever touched, the dataset can still prove which bytes it was built from.

A frozen dataset version is **immutable**. Revocation marks `containsRevokedMembers` and blocks
new training runs; it does not rewrite history.

### 7. Models — Phase 3+

```prisma
model VisionModel        { /* key, task: detect|track|calibrate|event, description */ }
model VisionModelVersion {
  id                String @id @default(uuid())
  modelId           String @map("model_id")
  version           String
  datasetVersionId  String? @map("dataset_version_id")
  gitCommit         String  @map("git_commit")
  configKey         String  @map("config_key")
  weightsKey        String  @map("weights_key")
  weightsChecksum   String  @map("weights_checksum")
  stage             String                      // candidate|benchmarked|staging|production|archived
  licenceNote       String? @db.Text @map("licence_note")
  @@map("vision_model_versions")
}
model VisionBenchmarkRun { /* modelVersionId, datasetVersionId (gold), completedAt */ }
model VisionMetricResult { /* benchmarkRunId, metric, slice, value */ }
```

`VisionMetricResult.slice` is what makes the no-regression gate possible — metrics are stored per
slice (night, 720p, platform copy, crowded box) and never only as a headline number. See
[10-EVALUATION-AND-GATES.md](./10-EVALUATION-AND-GATES.md).

---

## RBAC: extends the existing catalogue

Add to `services/api/src/admin/rbac/permissions.catalog.ts`:

```ts
{ slug: "vision.read",              resource: "vision", action: "read" },
{ slug: "vision.sources.write",     resource: "vision", action: "sources.write" },
{ slug: "vision.rights.manage",     resource: "vision", action: "rights.manage" },
{ slug: "vision.assets.upload",     resource: "vision", action: "assets.upload" },
{ slug: "vision.jobs.run",          resource: "vision", action: "jobs.run" },
{ slug: "vision.annotate",          resource: "vision", action: "annotate" },
{ slug: "vision.review",            resource: "vision", action: "review" },
{ slug: "vision.datasets.manage",   resource: "vision", action: "datasets.manage" },
{ slug: "vision.models.train",      resource: "vision", action: "models.train" },
{ slug: "vision.models.promote",    resource: "vision", action: "models.promote" },
{ slug: "vision.publish",           resource: "vision", action: "publish" },
{ slug: "vision.media.raw.read",    resource: "vision", action: "media.raw.read" },  // youth-footage gate
{ slug: "vision.evidence.search",   resource: "vision", action: "evidence.search" },
```

Then five role presets alongside the existing ones (`SCOREBOARD_OPS_PERMISSION_SLUGS` and friends)
in the same file, seeded by `seed-rbac.ts`:

| Role | Slugs |
|---|---|
| `vision_admin` | all `vision.*` plus `admin.session.read` |
| `vision_annotator` | `vision.read`, `vision.annotate`, `admin.session.read` |
| `vision_reviewer` | `vision.read`, `vision.review`, `vision.publish`, `vision.media.raw.read`, `admin.session.read` |
| `vision_ml_engineer` | `vision.read`, `vision.datasets.manage`, `vision.models.train`, `vision.jobs.run`, `admin.session.read` |
| `vision_scout_readonly` | `vision.evidence.search`, `admin.session.read` |

Two deliberate omissions:

- **`vision_ml_engineer` does not get `vision.models.promote`.** Promotion needs a second pair of
  eyes. See [10-EVALUATION-AND-GATES.md](./10-EVALUATION-AND-GATES.md).
- **`vision_annotator` does not get `vision.media.raw.read`.** Annotators work from sampled frames
  and clips assigned to them, not from the raw youth-footage corpus.

`seed-rbac.ts` already preserves live role permissions on incremental seeds (commit `420b7e3`);
the new roles follow the same pattern and must not reset existing grants.

---

## Migration policy

- One migration per phase minimum, named `YYYYMMDDHHMMSS_vision_<topic>`, matching the existing convention.
- `prisma migrate` from zero must succeed in CI. `db push` is for local iteration only.
- No Vision migration may alter an existing ScoreBoard or Player table before Phase 6. The two
  planned widenings (`SbMatchEvent` sub-minute precision, `SbHighlight.mediaUrl`) are explicit,
  backwards-compatible, and land in Phase 6/7 with their own review. The first landed in
  [49](./49-PHASE-6-INCREMENT-3.md): `SbMatchEvent.secondInMinute`, nullable, null on every row
  the recorder entered, written by promotion only beside the recorder's own minute.
- `VisionEventCandidate.acceptedAnchorId` ([55](./55-QA-FIX-5-EVENTS-CLOCK.md)) is the clock
  anchor a candidate was accepted on; promotion writes a minute only under that anchor. Its
  migration, `20261005100000_vision_event_accepted_anchor`, is dated after the two
  future-dated migrations already on live because it alters a table the earlier of them
  creates. Until a migration no longer depends on those two, date it after them, not today.
- A `Json` column that a worker or a person writes into is validated at the door, by a
  DTO or by a reader in `packages/vision-contracts`. A `Json` column the control plane
  writes for itself has a documented TypeScript shape. This replaces "every `Json` column
  needs a Zod schema", which the code never kept: the contracts carry no Zod, by the
  decision in their README ([58](./58-QA-FIX-8-CONTRACT-PARITY.md)). The inventory:

  | Column | Written by | Shape and check |
  |---|---|---|
  | `VisionRightsScope.restrictions` | a person | `RightsRestrictions`; `readRestrictions` in the contracts, at grant |
  | `VisionPitchCalibration.points` | a person | `CalibrationPoint[]`; `CalibrationPointDto` |
  | `VisionLabelSchemaVersion.definitions` | a person | free-form by design; `IsObject` only |
  | `VisionDatasetVersion.splitPolicy` | a person | `SplitPolicyDto`, then `toPolicy` |
  | `VisionJob.progress` | a worker | `CompleteJobDto`; each stage's `summary` is parsed where it is applied (`stage-results.service.ts`) |
  | `VisionJob.error` | a worker | `FailJobDto` |
  | `VisionUploadSession.receivedParts` | the control plane, from the store's own listing | `{ partNumber, etag, bytes }[]` |
  | `VisionJob.inputSpec` | the control plane | the stage's `*JobParams` in the contracts |
  | `VisionPitchCalibration.homography` | the control plane | `Homography` |
  | `VisionJobEvent.data`, `VisionAuditLog.data` | the control plane | per event or action, at the call site |
  | `VisionDatasetVersion.leakageReport`, `representationReport` | the control plane | the dataset service's return types |
  | `VisionBenchmarkRun.verdictDetail`, `summary` | the control plane | `BenchmarkVerdict`, `BenchmarkSummary` |
  | `VisionPromotionRequest.checks`, `replacedVersionIds` | the control plane | `PromotionGate`, `string[]` |
  PROMPT rule 19: core domain entities do not live in undocumented JSON blobs.
