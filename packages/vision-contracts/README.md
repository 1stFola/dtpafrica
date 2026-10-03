# @dtp/vision-contracts

One source of truth for the Vision Engine's cross-boundary shapes: rights decisions, media
enums, object keys, job specs and the prediction envelope.

Three consumers, two languages:

| Consumer | How it uses this |
|---|---|
| `@dtp/api` (TypeScript) | Imports the types directly |
| `@dtp/web` (TypeScript) | Imports the types directly |
| `services/vision-worker` (Python) | Validates against generated JSON Schema — **not yet, see below** |

## Why no Zod in Phase 0

[docs/vision/01-ARCHITECTURE.md](../../docs/vision/01-ARCHITECTURE.md) specifies Zod schemas here,
emitting JSON Schema for the Python worker to validate against.

Phase 0 ships **plain TypeScript types and constants instead**, for two reasons:

1. There is no worker yet. A codegen step with no consumer is a build step that rots.
2. The API validates inbound payloads with `class-validator`, like the rest of this codebase.
   Adding Zod alongside it would mean two validation libraries and two ways to describe the same
   DTO.

**Phase 1 adds the runtime schemas and the JSON Schema emitter**, when the worker exists to consume
them. The constants here are deliberately `as const` arrays rather than bare unions so that
generating schemas from them later is mechanical.

`VISION_CONTRACT_VERSION` is already exported and already carried on every job spec, so the worker
handshake works from day one.

## Rules

- **No provider names.** Nothing in here may mention RunPod, Cloudflare, R2, or Lambda. Those live
  in their adapters. A job spec that carries a provider-specific field has leaked, and there is a
  test asserting it has not.
- **Additive changes only** within a major version. The worker and the control plane deploy
  independently, so a removed field breaks a running worker.
- **Bump `VISION_CONTRACT_VERSION`** on any change to the job spec or the prediction envelope.

## Versions

| Version | Change |
|---|---|
| `1.0.0` | Phase 0 through Spike S0. |
| `1.1.0` | A model-bound job (`MODEL_TASK_BY_JOB_TYPE`) is dispatched with exactly one `modelVersionIds` entry, and any stage downstream of `transcode` receives the proxy's clock under `params.proxy`. The `detect` artifact is `DetectionArtifact`: contract classes, both clocks, `ball_unknown`, the model version and the weights checksum. A worker reports `modelVersionIds` on completion. A 1.0.0 worker is refused at the handshake: it would run `detect` and write predictions nobody can attribute. |
| `1.2.0` | `benchmark` exists as a CPU stage (`cpu_small`) with `BenchmarkJobParams` under `params`, reads objects by declared key (`inputs.readKeys`, input role `declared`), and reports a `BenchmarkSummary` of `BenchmarkMetric` rows. |
| `1.3.0` | `track` exists as a CPU stage bound to a tracker model version (`MODEL_TASK_BY_JOB_TYPE.track`), given `TrackJobParams` (the one detect artifact, by declared key) and the proxy clock, and writing a `tracks` artifact of `TrackRecord`s whose positions are observations only. |
| `1.4.0` | `benchmark` takes a `task` and `predictions` (one artifact per gold member, `detections` or `tracks`); a tracker is scored with `TRACKING_METRIC_NAMES`. An `AnnotationBox` may carry a `trackId`, with `track_class_conflict` and `track_frame_conflict` in the box rule. |
| `1.5.0` | `identify` exists as a CPU stage bound to an `identify` model version (`MODEL_TASK_BY_JOB_TYPE.identify`), given `IdentifyJobParams` (the one track artifact, by declared key) and the proxy clock, and reporting `TeamAssignmentRow`s under `IDENTITY_ARTIFACT_ROLE`: a `TeamLabel` (`A`/`B`) or `null`, a margin as confidence, and a method. |
| `1.6.0` | A `TeamAssignmentRow` carries `nearest`, the side the kit was nearest to even when `team` is null, so an abstention can be judged. `IDENTITY_METRIC_NAMES` (team accuracy, coverage, unknown precision, tracks) are scored in the control plane; a `BenchmarkSummary` may say `unit: "tracks"`. |
| `1.7.0` | Calibration's shapes: `PitchDimensions` (default 105 × 68), `Homography` (row-major 3 × 3, proxy pixels to metres), `CalibrationPoint`, `PitchCalibration` with its reprojection error and a `CalibrationQuality` (`good`, `usable`, `failed`) the suppression rule reads. Manual first; a `calibrate` stage will write the same shape. |
| `1.8.0` | `cuts` exists as a CPU stage after `transcode` (`CutsJobParams`: `threshold`, `minSegmentMs`), writing a `cuts` artifact of `CameraCut`s and `ProposedSegment`s in source time. A camera segment's `CameraSegmentSource` is `manual` or `scene_detect`. |
| `1.9.0` | `gamestate` exists as a CPU stage after `track` (`GameStateJobParams`: the track artifact by declared key, every `DeclaredSegment` with its calibration or nulls, the `DeclaredClockAnchor`s, `chunkMs`), writing Parquet chunks (`GAMESTATE_CHUNK_ROLE`) and a `GameStateIndex` (`GAMESTATE_INDEX_ROLE`) with per-chunk `GameStateCoverage` and the `GAMESTATE_SUPPRESSION_REASONS`. Its prerequisite is `track` alone: calibration is a person's row, checked at enqueue, not a stage. |
| `1.10.0` | Event candidates (`events.ts`): `VISION_EVENT_TYPES` under `VISION_EVENT_TAXONOMY_VERSION`, `SCOREBOARD_TYPE_OF` (which types have a recorder event to promote into), `NON_PLAY_SEGMENT_KINDS`, review and promotion states, `EVIDENCE_KINDS`, and `VisionEventPromotionV1`, what promotion writes under the recorder event's metadata. No stage changes. |
| `1.11.0` | The review queue's kinds, `REVIEW_QUEUE_KINDS` (`event`, `identity`): what `GET /vision/review/queue` lists, oldest first, the reader's own left out. Promotion also writes `SbMatchEvent.secondInMinute` beside the recorder's minute, the sub-minute widening D10 planned. No stage changes. |
