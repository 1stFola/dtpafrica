/**
 * Job and compute contracts.
 *
 * See docs/vision/06-JOBS-AND-COMPUTE.md.
 *
 * Nothing in this file may name a compute or storage provider. A worker receives
 * a job ID, its inputs, an output prefix, budgets and a callback base URL — and
 * nothing that tells it whose hardware it is running on.
 */

import { DEFAULT_PITCH_LENGTH_M, DEFAULT_PITCH_WIDTH_M, type BoundingBox, type DetectionClass } from "./prediction";

/** Bumped on any change to VisionJobSpec or the prediction envelope. */
/**
 * 1.1.0 — a `detect` job now carries the model version it must run, and the proxy's
 * clock (`params.proxy`), so every prediction can name its model and its source time.
 * A worker on 1.0.0 would run `detect` and produce predictions nobody can attribute,
 * which is why the handshake refuses it rather than warning.
 *
 * 1.2.0 — `benchmark` exists: a CPU stage that scores a model version's detect
 * artifacts against a frozen gold version's boxes. It reads objects by declared key
 * (`inputs.readKeys`, input role `declared`) rather than by asset role, and it routes
 * to `cpu_small` -- comparing predictions to truth needs no card.
 *
 * 1.3.0 -- `track` exists: a CPU stage that links a detect artifact's boxes across
 * frames (declared key, like `benchmark`), bound to a tracker model version and
 * naming the detector version it consumed. Routes to `cpu_small`.
 *
 * 1.4.0 -- `benchmark` takes a `task`: `detect` scores detect artifacts against gold
 * boxes as before; `track` scores track artifacts against gold tracks (boxes linked by
 * `trackId`, exported as FiftyOne `index`) with MOTA, IDF1, identity switches and
 * fragmentations.
 *
 * 1.5.0 -- `identify` exists: a CPU stage that assigns a team to each track by kit
 * appearance, clustered per match. Model-bound to an `identify` version (an
 * algorithm with parameters), reading the proxy by role and the one track artifact by
 * declared key.
 *
 * 1.6.0 -- a `TeamAssignmentRow` records the side the kit was `nearest` to even when
 * the margin was too small to name it, so an abstention can later be judged: unknown
 * precision asks whether abstaining avoided a wrong answer. `IDENTITY_METRIC_NAMES`
 * are what the ledger measures for an `identify` version, scored in the control
 * plane against identities two people accepted -- rows, not artifacts.
 *
 * 1.7.0 -- calibration's shapes: a `PitchCalibration` is a homography from proxy
 * pixels to pitch metres for one camera segment, with its reprojection error and a
 * `CalibrationQuality` the suppression rule reads. Manual first; a `calibrate` stage
 * will write the same shape.
 *
 * 1.8.0 -- `cuts` exists: a CPU stage that proposes camera segments from the proxy's
 * scene changes (`CutsJobParams`, a `cuts` artifact of `CameraCut`s and
 * `ProposedSegment`s in source time). The control plane files proposals as
 * `scene_detect` segments beside, never over, the ones a person declared.
 *
 * 1.9.0 -- `gamestate` exists: a CPU stage that places every track's foot point on
 * the pitch in metres through the camera segments, calibrations and clock anchors the
 * control plane declares (`GameStateJobParams`), under the suppression rule, as Parquet chunks
 * (`GAMESTATE_CHUNK_ROLE`) with a `GameStateIndex` (`GAMESTATE_INDEX_ROLE`). It
 * follows `track`; calibration is a person's row, not a stage, so the control plane
 * refuses `NoCalibration` rather than waiting on a `calibrate` job.
 *
 * 1.10.0 -- event candidates (`events.ts`): the first taxonomy under
 * `VISION_EVENT_TAXONOMY_VERSION`, review states, evidence kinds, promotion kinds,
 * and `VisionEventPromotionV1`, what promotion writes under the recorder event's
 * metadata. No stage changes.
 *
 * 1.11.0 -- the review queue's kinds (`REVIEW_QUEUE_KINDS`: `event`, `identity`),
 * what `GET /vision/review/queue` lists. Promotion now also writes
 * `SbMatchEvent.secondInMinute` beside the recorder's minute. No stage changes.
 *
 * 1.12.0 -- pipeline maths (docs/vision/56). `track` may be given `cuts`, ends
 * tracks at them, ages a track by the clock (`maxAgeMs`, not `maxAge` frames) and
 * writes `trackedFrames`. `gamestate` reads segments half-open, suppresses
 * `off_pitch`, and reports coverage against the tracked frames
 * (`framesTracked`, `coverageBasis`). A declared homography is oriented: positive
 * `w` for what the camera sees.
 *
 * 1.13.0 -- `ball_trajectory`: CPU smoothing of full-rate, provenance-pinned
 * detections. Explicit lost states reset smoothing; coordinates remain in image
 * space. No new model or possession inference is implied.
 *
 * 1.14.0 -- `possession`: unreviewed track candidates from pinned ball/player
 * observations. Image proximity and continuity only; gaps remain Unknown.
 *
 * 1.15.0 -- optional possession ground-plane vetoes pin proxy geometry/checksum
 * and current calibration. Missing/failed calibration remains Unknown.
 *
 * 1.16.0 -- CPU carry event proposals from original calibrated possession and
 * exact player observations, bound to a registered weight-free rule version.
 *
 * 1.17.0 -- `camera_motion`: CPU frame-to-frame homographies over the pinned proxy
 * and the shots between edit cuts, proposed as `camera_motion` camera segments.
 * No model; the per-frame rows are the input calibration propagation reads
 * (docs/vision/92).
 *
 * 1.18.0 -- `calibrate` is a CPU stage: a person's keyframe calibrations carried
 * to every frame along pinned `camera_motion`, per-frame rows with a reason where
 * there is none, and drift measured between keyframes of one shot. Requires
 * `camera_motion`; loads no model (docs/vision/93).
 *
 * 1.19.0 -- possession, events and gamestate read a keyframed segment's calibration
 * frame by frame: a `carried` segment names its keyframes and pitch, and the
 * calibrate run is pinned (`carried`) beside the segments. A frame no keyframe
 * reached is unplaced (`calibration_not_carried` in game state) (docs/vision/94).
 *
 * 1.20.0 -- `detect` is told which detector config it runs (`detector.configKey`,
 * from the model version) and reports it back (`detectorConfig`). The ball-tiles
 * config adds a tiled pass that keeps only confident ball boxes; an older worker
 * would run the plain detector under that version's name, so detect needs 1.20
 * (docs/vision/95).
 *
 * 1.21.0 -- the ball-tiles/v2 detector keeps a tiled ball only if it is not
 * yellow, orange or red, and marks each one `source: "ball_tiles"`. Ball
 * trajectory, given such detections, is pinned to the current camera motion
 * (`cameraMotion`) and drops a tiled ball that stays on one spot of the ground for
 * 2.4 s: a ball not in play. Both stages need 1.21 (docs/vision/95).
 *
 * 1.22.0 -- `hard_frames`: a CPU stage over a pinned detect run and its ball
 * trajectory that picks the frames worth labelling (the ball missed between two
 * sightings, a low-confidence ball, a ball only the tiled pass found, and a share of
 * ordinary play) and writes the detector's boxes for each as pre-labels. No model
 * runs (docs/vision/99).
 *
 * 1.23.0 -- `train`: a GPU stage that fine-tunes the torchvision Faster R-CNN baseline
 * on a frozen dataset's export (its train split; its val split is scored with the
 * benchmark's own evaluation) and writes the weights, their config and the metrics to
 * the models bucket. The control plane pins the export's checksum and lists every
 * proxy the stage may read (docs/vision/102).
 */
export const VISION_CONTRACT_VERSION = "1.23.0";

/**
 * The detectors a worker can run, named by the model version's config key. The
 * worker runs nothing else: a version whose config is not here is refused at
 * enqueue rather than run as whichever detector the worker happens to default to.
 */
export const DETECTOR_CONFIG_BASE = "builtin/torchvision/fasterrcnn_resnet50_fpn/COCO_V1";
/** The same weights, plus four overlapping corner tiles at 60% of the frame for the ball only (docs/vision/95). */
export const DETECTOR_CONFIG_BALL_TILES = "builtin/torchvision/fasterrcnn_resnet50_fpn/COCO_V1+ball-tiles/v1";
/** Ball tiles plus a colour check on each tiled ball, and the tiled balls marked for ball trajectory's parked check (docs/vision/95). */
export const DETECTOR_CONFIG_BALL_TILES_V2 = "builtin/torchvision/fasterrcnn_resnet50_fpn/COCO_V1+ball-tiles/v2";
export const DETECTOR_CONFIGS = [DETECTOR_CONFIG_BASE, DETECTOR_CONFIG_BALL_TILES, DETECTOR_CONFIG_BALL_TILES_V2] as const;
export type DetectorConfigKey = (typeof DETECTOR_CONFIGS)[number];
/** A tiled ball box is kept only at or above this score: below it, on the pilot, were boots and heads. */
export const BALL_TILE_MIN_SCORE = 0.7;
/** What the control plane adds to a detect job: the config the model version names. */
export type DetectJobParams = { detector: { configKey: DetectorConfigKey } };

/**
 * Which worker may serve which stage (docs/vision/58).
 *
 * The version used to have to match exactly. Every bump, including the ones that
 * changed no stage, made every worker image built before it unusable until it
 * was rebuilt -- 1.10.0 and 1.11.0 did that to the GPU image for nothing.
 *
 * The rule now: same major version, the worker no newer than the control plane,
 * and per stage the worker at or past the version in which that stage's inputs
 * or outputs last changed. A bump that touches no stage leaves every worker
 * serving what it served. A bump that changes a stage moves that stage's entry
 * here, and an older worker goes on serving the others.
 *
 * Every entry starts at 1.12.0, the version this rule arrived in: under exact
 * matching no older worker was being served anyway.
 */
export const STAGE_CONTRACT_SINCE: Record<VisionJobType, string> = {
  probe: "1.12.0",
  fingerprint: "1.12.0",
  transcode: "1.12.0",
  cuts: "1.12.0",
  camera_motion: "1.17.0",
  detect: "1.21.0",
  track: "1.12.0",
  identify: "1.12.0",
  calibrate: "1.18.0",
  gamestate: "1.19.0",
  ball_trajectory: "1.21.0",
  hard_frames: "1.22.0",
  possession: "1.19.0",
  events: "1.19.0",
  clip: "1.12.0",
  vlm: "1.12.0",
  train: "1.23.0",
  benchmark: "1.12.0",
};

/** `1.12.0` as numbers, or null when it is not three of them. */
export function parseContractVersion(version: unknown): [number, number, number] | null {
  if (typeof version !== "string") return null;
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative when `a` is older than `b`, zero when the same, positive when newer. */
export function compareContractVersions(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export type WorkerCompatibility =
  | { compatible: true; stages: VisionJobType[] }
  | { compatible: false; reason: "unreadable" | "major" | "worker_newer"; detail: string };

/**
 * What a worker speaking `workerVersion` may be handed by a control plane
 * speaking `controlVersion`: the stages it can serve, or why none.
 */
export function workerCompatibility(workerVersion: unknown, controlVersion: string = VISION_CONTRACT_VERSION): WorkerCompatibility {
  const worker = parseContractVersion(workerVersion);
  const control = parseContractVersion(controlVersion);
  if (!worker || !control) {
    return { compatible: false, reason: "unreadable", detail: `"${String(workerVersion)}" is not a contract version` };
  }
  if (worker[0] !== control[0]) {
    return { compatible: false, reason: "major", detail: `worker speaks major ${worker[0]}, control plane major ${control[0]}` };
  }
  if (compareContractVersions(worker, control) > 0) {
    // A worker ahead of the control plane may send what this control plane has never heard of.
    return { compatible: false, reason: "worker_newer", detail: `worker speaks ${String(workerVersion)}, newer than the control plane's ${controlVersion}` };
  }
  const stages = VISION_JOB_TYPES.filter((type) => {
    const since = parseContractVersion(STAGE_CONTRACT_SINCE[type]);
    return since !== null && compareContractVersions(worker, since) >= 0;
  });
  return { compatible: true, stages: [...stages] };
}

export const VISION_JOB_TYPES = [
  "probe",
  "fingerprint",
  "transcode",
  "cuts",
  "camera_motion",
  "detect",
  "track",
  "identify",
  "calibrate",
  "gamestate",
  "ball_trajectory",
  "hard_frames",
  "possession",
  "events",
  "clip",
  "vlm",
  "train",
  "benchmark",
] as const;
export type VisionJobType = (typeof VISION_JOB_TYPES)[number];

export const VISION_RESOURCE_CLASSES = [
  "cpu_small",
  "gpu_24gb",
  "gpu_48gb",
  "gpu_80gb",
] as const;
export type VisionResourceClass = (typeof VISION_RESOURCE_CLASSES)[number];

/**
 * Default hardware class per job type.
 *
 * Transcode, fingerprinting and clip rendering are CPU-bound. Routing them to a
 * GPU pod would mean paying GPU rates for FFmpeg, which is one of the larger
 * avoidable costs in the pipeline.
 */
export const DEFAULT_RESOURCE_CLASS: Record<VisionJobType, VisionResourceClass> = {
  probe: "cpu_small",
  fingerprint: "cpu_small",
  transcode: "cpu_small",
  // FFmpeg's scene-change score over the proxy: a decode, no model.
  cuts: "cpu_small",
  // Corner tracking and homographies over a decode of the proxy: arithmetic, no model.
  camera_motion: "cpu_small",
  clip: "cpu_small",
  detect: "gpu_24gb",
  // Association over stored detections is arithmetic; see `benchmark`.
  track: "cpu_small",
  // Kit colour over a few decoded frames per track is arithmetic; see `benchmark`.
  identify: "cpu_small",
  // A person's keyframes carried along measured motion: matrix products, no model, no video.
  calibrate: "cpu_small",
  gamestate: "cpu_small",
  ball_trajectory: "cpu_small",
  // Picking frames from stored detections and ball rows: arithmetic, no model, no video.
  hard_frames: "cpu_small",
  possession: "cpu_small",
  events: "cpu_small",
  vlm: "cpu_small",
  train: "gpu_48gb",
  // A benchmark compares stored predictions with stored truth. The predictions
  // needed a GPU; the comparison does not, and routing it to one would bill GPU
  // rates for arithmetic. See docs/vision/30-PHASE-3-INCREMENT-3.md.
  benchmark: "cpu_small",
};

export const VISION_JOB_STATES = [
  "queued",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
] as const;
export type VisionJobState = (typeof VISION_JOB_STATES)[number];

export const TERMINAL_JOB_STATES: readonly VisionJobState[] = [
  "succeeded",
  "failed",
  "cancelled",
];

/** States a worker may still act on. */
export const ACTIVE_JOB_STATES: readonly VisionJobState[] = ["claimed", "running"];

/**
 * Stage prerequisites. The dispatcher will not queue a job until every
 * prerequisite type has succeeded for the same asset.
 */
export const JOB_TYPE_PREREQUISITES: Record<VisionJobType, readonly VisionJobType[]> = {
  probe: [],
  fingerprint: [],
  transcode: ["probe"],
  cuts: ["transcode"],
  camera_motion: ["transcode"],
  detect: ["transcode"],
  track: ["detect"],
  identify: ["track"],
  // Carries a person's keyframes (docs/vision/38, /93) along the measured motion; the
  // control plane checks that calibrations exist when queueing.
  calibrate: ["camera_motion"],
  gamestate: ["track"],
  ball_trajectory: ["detect"],
  hard_frames: ["ball_trajectory"],
  possession: ["ball_trajectory", "track"],
  events: ["possession", "track"],
  clip: ["transcode"],
  vlm: ["clip"],
  train: [],
  benchmark: [],
};

/**
 * Job types that run a model, and therefore must be dispatched with exactly one
 * model version. The control plane resolves it before the job is queued and the
 * worker refuses to run without it: a prediction that cannot name its model cannot
 * be reviewed, benchmarked or rolled back.
 *
 * One entry per stage that exists. `track`, `calibrate` and the rest join as their
 * stages are written -- declaring them early would repeat the mistake Spike S0 found
 * (docs/vision/27-SPIKE-S0-SURPRISES.md, S0-1): a contract promising what no worker
 * can honour.
 */
export const MODEL_TASK_BY_JOB_TYPE: Partial<Record<VisionJobType, VisionModelTask>> = {
  detect: "detect",
  // A tracker is an algorithm with parameters rather than trained weights, and it is
  // registered as a model version all the same: every track names the tracker that
  // made it, or it cannot be reproduced or rolled back.
  track: "track",
  // Kit clustering is an algorithm with parameters; it is a version so that every
  // team assignment names what made it.
  identify: "identify",
  events: "event",
};

/** What a `VisionModel` is for. One task per model; a version inherits it. */
export const VISION_MODEL_TASKS = ["detect", "track", "identify", "calibrate", "event", "vlm"] as const;
export type VisionModelTask = (typeof VISION_MODEL_TASKS)[number];

/** Registry lifecycle. Promotion rules are in docs/vision/10-EVALUATION-AND-GATES.md. */
export const VISION_MODEL_STAGES = [
  "candidate",
  "benchmarked",
  "staging",
  "production",
  "archived",
] as const;
export type VisionModelStage = (typeof VISION_MODEL_STAGES)[number];

/**
 * The proxy's clock, handed to any stage that reads the proxy.
 *
 * Resolved by the control plane from the variant row at enqueue time, because the
 * worker sees a presigned URL and nothing else: it cannot ask the proxy what its
 * source offset is, and guessing zero would put every source timestamp on a trimmed
 * proxy out by the trim.
 */
export type ProxyClock = {
  /** Constant by construction; what makes a frame index a timestamp. */
  fps: number;
  /** `sourceTimeMs = proxyTimeMs + sourceOffsetMs`. */
  sourceOffsetMs: number;
};

export type VisionJobInputs = {
  videoAssetId?: string;
  /** Objects the worker is permitted to read, as logical refs. */
  readKeys?: { bucket: string; key: string }[];
  datasetVersionId?: string;
  modelVersionIds?: string[];
  /**
   * Stage-specific parameters, validated per job type. A stage downstream of
   * `transcode` finds the proxy's clock under `params.proxy` (a `ProxyClock`).
   */
  params?: Record<string, unknown>;
};

export type VisionJobBudget = {
  maxRuntimeSeconds: number;
  maxCostUsdCents: number;
};

/**
 * What a worker receives. Provider-neutral by construction.
 */
export type VisionJobSpec = {
  contractVersion: string;
  jobId: string;
  type: VisionJobType;
  resourceClass: VisionResourceClass;
  attemptNumber: number;
  inputs: VisionJobInputs;
  /** Every artifact this job writes must land under this prefix. */
  outputPrefix: string;
  budget: VisionJobBudget;
  /** Where to claim, heartbeat, presign and complete. */
  callbackBaseUrl: string;
  heartbeatIntervalSeconds: number;
};

export type VisionJobProgress = {
  stage: string;
  /** 0-1, or null when the stage cannot report a fraction. */
  fraction: number | null;
  message?: string;
};

export type VisionJobArtifact = {
  /** Key relative to nothing — the full key, which must sit under outputPrefix. */
  key: string;
  bucket: string;
  bytes: number;
  contentType: string;
  /** What this artifact is, e.g. "detections", "proxy", "weights". */
  role: string;
};

export type VisionJobCostReport = {
  gpuSeconds: number;
  cpuSeconds: number;
  wallClockSeconds: number;
  bytesRead: number;
  bytesWritten: number;
  classAOperations: number;
  classBOperations: number;
  thirdPartyApiCostUsdCents: number;
};

export type VisionJobCompletion = {
  /** Retry-safe: a repeat completion with the same key returns the first result. */
  idempotencyKey: string;
  artifacts: VisionJobArtifact[];
  /** Small structured summary. Bulk output stays in object storage. */
  summary: Record<string, unknown>;
  cost: VisionJobCostReport;
  /** Image tag and model versions actually used, for reproducibility. */
  workerImage: string;
  modelVersionIds: string[];
};

export type VisionJobFailure = {
  reason: string;
  detail: string;
  retryable: boolean;
};

/**
 * What a compute provider needs to start a worker.
 *
 * `env` carries the bootstrap token and callback URL. The provider adapter adds
 * its own fields internally; none of them appear here.
 */
export type WorkerLaunchSpec = {
  /** OCI image reference, e.g. dtp-vision-engine:0.1.0 */
  image: string;
  resourceClass: VisionResourceClass;
  env: Record<string, string>;
  maxRuntimeSeconds: number;
  maxCostUsdCents: number;
  /** Drain the queue then exit, so nothing idles on the clock. */
  idleShutdownSeconds: number;
};

export const WORKER_STATUSES = [
  "pending",
  "running",
  "stopped",
  "failed",
  "unknown",
] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export type ProviderCapabilities = {
  providerId: string;
  resourceClasses: readonly VisionResourceClass[];
  maxConcurrentWorkers: number;
  /** False for providers that may only run throwaway experiments. */
  productionApproved: boolean;
};

export type CostEstimate = {
  resourceClass: VisionResourceClass;
  seconds: number;
  usdCents: number;
  /** True when the rate came from configuration rather than a live quote. */
  fromConfiguredRate: boolean;
};

/**
 * Which logical bucket each job type writes its artifacts to.
 *
 * A worker never writes to `master`: source media and rights evidence are
 * uploaded by an authorised client and are immutable thereafter. The control
 * plane validates every presign request against both this and the job's
 * `outputPrefix`, so a worker cannot choose where its output lands.
 */
export const OUTPUT_BUCKET_BY_JOB_TYPE: Record<VisionJobType, "derived" | "models" | "clips"> = {
  probe: "derived",
  fingerprint: "derived",
  transcode: "derived",
  cuts: "derived",
  camera_motion: "derived",
  detect: "derived",
  track: "derived",
  identify: "derived",
  calibrate: "derived",
  gamestate: "derived",
  ball_trajectory: "derived",
  hard_frames: "derived",
  possession: "derived",
  events: "derived",
  vlm: "derived",
  benchmark: "models",
  train: "models",
  clip: "clips",
};

/** Reasons a job ended without succeeding, distinct from a worker's own message. */
export const JOB_FAILURE_KINDS = [
  "worker_reported",
  "heartbeat_lost",
  "budget_exceeded",
  "attempts_exhausted",
  "cancelled_by_operator",
  "prerequisite_failed",
] as const;
export type JobFailureKind = (typeof JOB_FAILURE_KINDS)[number];

// ── Benchmarks ──────────────────────────────────────────────────────────────

/**
 * What a `benchmark` job is given, under `inputs.params`.
 *
 * The gold labels are the dataset's FiftyOne export (`samples.json`), and the
 * predictions are the `detect` artifacts the control plane found for every gold
 * member, each produced by the model version under test. The worker reads all of
 * them by declared key: it may fetch exactly these objects and no others.
 */
export type BenchmarkJobParams = {
  benchmarkRunId: string;
  /** Which kind of model is being scored, and so which artifacts `predictions` are. */
  task: "detect" | "track";
  goldLabelsKey: string;
  /** One artifact per gold member: a `detections` artifact for `detect`, a `tracks` artifact for `track`. */
  predictions: { videoAssetId: string; key: string }[];
  /** Every key the worker may read, bucket by bucket. The control plane checks each input-url against it. */
  readKeys: { bucket: "derived" | "models"; key: string }[];
  /** IoU at which a prediction counts as matching a box. */
  iou: number;
  classes: readonly DetectionClass[];
};

/** `"<metric>:<class>"`, with `all` for every class together. */
export const BENCHMARK_METRIC_NAMES = ["precision", "recall", "f1", "ap", "boxes"] as const;
export type BenchmarkMetricName = (typeof BENCHMARK_METRIC_NAMES)[number];

/** Tracking metrics, per class and `all`: CLEAR's MOTA, identity F1, switches, fragmentations, and the gold-track count. */
export const TRACKING_METRIC_NAMES = ["mota", "idf1", "idsw", "frag", "tracks"] as const;
export type TrackingMetricName = (typeof TRACKING_METRIC_NAMES)[number];

/**
 * Identity metrics, for an `identify` version, over tracks whose identity two people
 * accepted: team accuracy among the sided, coverage of the sided, the precision of
 * abstaining (how often the nearest side would have been wrong), and the track count.
 * Scored in the control plane: the evidence is rows, not artifacts.
 */
export const IDENTITY_METRIC_NAMES = ["team_accuracy", "team_coverage", "unknown_precision", "tracks"] as const;
export type IdentityMetricName = (typeof IDENTITY_METRIC_NAMES)[number];

/** The slice every metric is also reported under. Never only this one. */
export const ALL_SLICE = "all";

/**
 * One number the worker measured. `metric` is `"<name>:<class|all>"`; `slice` is
 * `all` or `"<axis>:<value>"` from the gold sample's provenance (quality, competition,
 * vfr). `support` is how many ground-truth boxes the number rests on, because a
 * recall of 1.0 over three boxes is not a finding.
 */
export type BenchmarkMetric = {
  metric: string;
  slice: string;
  value: number | null;
  support: number;
};

/** The summary a `benchmark` completion carries. The full report is the artifact. */
export type BenchmarkSummary = {
  benchmarkRunId: string;
  modelVersionId: string;
  datasetVersionId: string;
  iou: number;
  classes: readonly string[];
  assets: number;
  /**
   * What `framesLabelled` and `framesScored` count: gold frames for a detector or
   * tracker, tracks with an accepted identity (and how many were sided) for an
   * identify version. Absent means frames.
   */
  unit?: "frames" | "tracks";
  /** Labelled frames in the gold set, and how many of them the detect artifacts sampled. */
  framesLabelled: number;
  framesScored: number;
  metrics: BenchmarkMetric[];
};

// ── Tracks ──────────────────────────────────────────────────────────────────

/** Role of the artifact a `track` job writes. */
export const TRACK_ARTIFACT_ROLE = "tracks";

/** Detections sampled below this rate cannot be linked frame to frame; a player moves too far. */
export const MIN_TRACK_SAMPLE_FPS = 10;

/** What a `track` job is given under `inputs.params`, beside the proxy clock. */
export type TrackJobParams = {
  detections: { jobId: string; key: string; modelVersionId: string; sampleFps: number };
  /**
   * Camera cuts in source milliseconds: the start of every camera segment on the
   * asset but the first. Every live track ends at one. Absent or empty when the
   * asset has no segments yet, and then only the clock ends a track.
   */
  cuts?: number[];
  readKeys: { bucket: "derived" | "models"; key: string }[];
};

/**
 * Every frame a tracker was given, as `[frameIndex, sourceTimeMs]`, with or
 * without a track on it. A track artifact carries it as `trackedFrames`; game
 * state measures valid-frame coverage against it.
 */
export type TrackedFrame = [number, number];

/** One observed position of a track. Never interpolated: a gap is a gap. */
export type TrackPosition = {
  frameIndex: number;
  proxyTimeMs: number;
  sourceTimeMs: number;
  box: BoundingBox;
  confidence: number;
};

export type TrackRecord = {
  localTrackId: number;
  class: DetectionClass;
  startFrame: number;
  endFrame: number;
  startMs: number;
  endMs: number;
  detectionCount: number;
  /** Reached the minimum hits. Tentative tracks that never did are not written. */
  confirmed: boolean;
  positions: TrackPosition[];
};

/** The compact per-track index a `track` completion carries; the positions stay in the artifact. */
export type TrackSummaryRow = Omit<TrackRecord, "positions">;

// ── Identity: team assignment ───────────────────────────────────────────────

/** Role of the artifact an `identify` job writes. */
export const IDENTITY_ARTIFACT_ROLE = "identity";

/** The two sides, as clusters. Which is which in football terms is the roster's job, later. */
export const TEAM_LABELS = ["A", "B"] as const;
export type TeamLabel = (typeof TEAM_LABELS)[number];

/** What an `identify` job is given under `inputs.params`, beside the proxy clock. */
export type IdentifyJobParams = {
  tracks: { jobId: string; key: string; trackerVersionId: string };
  readKeys: { bucket: "derived" | "models"; key: string }[];
};

/**
 * One track's team, as the clustering saw it. `team` is null when the margin
 * between the two kits was too small to say -- unknown beats wrong -- and for
 * classes that are never clustered (goalkeepers, referees).
 */
export type TeamAssignmentRow = {
  localTrackId: number;
  class: DetectionClass;
  team: TeamLabel | null;
  /** 0-1: how much nearer the track's kit is to its team than to the other. */
  confidence: number | null;
  /** `kit_outlier`: a third kit, far from both sides, set aside rather than forced onto one. */
  method: "kit_cluster" | "kit_outlier" | "not_clustered";
  /**
   * The side the kit was nearest to, named even when `team` is null because the
   * margin was too small. What unknown precision is measured against.
   */
  nearest?: TeamLabel | null;
  /** Frames the kit was sampled on. */
  samples: number;
};

// ── Calibration ─────────────────────────────────────────────────────────────

/** The pitch in metres. 105 × 68 unless the actual dimensions are known. */
export type PitchDimensions = { lengthM: number; widthM: number };
/** The one default, built from the two numbers in `prediction.ts`; the API and the screens take it from here. */
export const DEFAULT_PITCH_DIMENSIONS: PitchDimensions = { lengthM: DEFAULT_PITCH_LENGTH_M, widthM: DEFAULT_PITCH_WIDTH_M };

/** Row-major 3 × 3, mapping homogeneous proxy pixel [x, y, 1] to homogeneous pitch [X, Y, W] in metres. */
export type Homography = [number, number, number, number, number, number, number, number, number];

export const CALIBRATION_METHODS = ["manual", "model"] as const;
export type CalibrationMethod = (typeof CALIBRATION_METHODS)[number];

/**
 * `good` and `usable` yield coordinates; `failed` yields none. A coordinate-derived
 * metric under a failed calibration is suppressed and labelled, never emitted with
 * a caveat (docs/vision/09 § Calibration).
 */
export const CALIBRATION_QUALITIES = ["good", "usable", "failed"] as const;
export type CalibrationQuality = (typeof CALIBRATION_QUALITIES)[number];

/** One clicked landmark: where it is in the picture, and which pitch landmark it is. */
export type CalibrationPoint = { landmark: string; px: number; py: number; frameIndex?: number };

export type PitchCalibration = {
  cameraSegmentId: string;
  pitch: PitchDimensions;
  method: CalibrationMethod;
  modelVersionId?: string | null;
  points: CalibrationPoint[];
  homography: Homography;
  reprojectionErrorM: number;
  maxPointErrorM: number;
  reprojectionErrorPx: number;
  quality: CalibrationQuality;
  thresholdsVersion: string;
};

// ── Camera cuts ─────────────────────────────────────────────────────────────

/** Role of the artifact a `cuts` job writes. */
export const CUTS_ARTIFACT_ROLE = "cuts";

/**
 * Who declared a camera segment: a person, the scene-change filter, or the shots
 * `camera_motion` found. A person setting a proposal's kind makes it `manual`.
 */
export const CAMERA_SEGMENT_SOURCES = ["manual", "scene_detect", "camera_motion"] as const;
/** The sources that are proposals: replaced by a later run unless a person kept or calibrated them. */
export const PROPOSED_SEGMENT_SOURCES = ["scene_detect", "camera_motion"] as const;
export type CameraSegmentSource = (typeof CAMERA_SEGMENT_SOURCES)[number];

/** Optional knobs under `inputs.params`, beside the proxy clock the clock gives every stage after transcode. */
export type CutsJobParams = {
  /** Scene-change score, 0-1, at or above which a frame is a cut. Default 0.4. */
  threshold?: number;
  /** Segments shorter than this are absorbed into the one before. Default 2000. */
  minSegmentMs?: number;
};

export type CameraCut = { proxyMs: number; sourceMs: number; score: number };

// ── Camera motion ───────────────────────────────────────────────────────────

/** Version of the motion calculation; a change of method is a new version, not an edit. */
export const CAMERA_MOTION_VERSION = "camera-motion/v1";
/** Roles of what a `camera_motion` job writes: one index, and per-minute JSONL chunks of rows. */
export const CAMERA_MOTION_INDEX_ROLE = "camera_motion";
export const CAMERA_MOTION_CHUNK_ROLE = "camera_motion_chunk";

/** What the control plane pins for a `camera_motion` job, beside the proxy clock. */
export type CameraMotionJobParams = {
  /** The proxy the motion is measured on; the worker refuses any other. */
  proxyChecksum: string;
  /** Shots stop at the end of the source, not of the proxy's padded tail. */
  sourceDurationMs: number;
  chunkMs?: number;
  cameraMotionConfig?: { minInliers?: number; minShotMs?: number };
};

/**
 * One row per proxy frame. Row 0 is `start`; row f is the pair f-1 -> f, with the
 * homography mapping a proxy pixel in frame f-1 to frame f. `break` is an edit cut
 * (no homography): nothing is carried across it.
 */
export type CameraMotionRow = {
  f: number;
  status: "start" | "tracked" | "bridged" | "break";
  H: Homography | null;
  inliers: number | null;
  tracked: number | null;
  residualPx: number | null;
};

/** A run of frames joined by tracked or bridged pairs: half-open source ms, inside the source. */
export type CameraShot = { startFrame: number; endFrame: number; startMs: number; endMs: number };

// ── Calibration carried to every frame ──────────────────────────────────────

/** v2 checks every carried frame against its own picture and withholds it `off_paint` when its lines miss the paint (docs/vision/97). */
export const CALIBRATION_PROPAGATION_VERSION = "calibration-propagation/v2";
export const CALIBRATION_FRAMES_INDEX_ROLE = "calibration_frames";
export const CALIBRATION_FRAMES_CHUNK_ROLE = "calibration_frames_chunk";
/** Why a frame has no carried calibration. */
export const CALIBRATION_FRAME_REASONS = ["no_camera_segment", "segment_not_calibrated", "calibration_failed", "no_keyframe_in_shot", "beyond_reach", "keyframe_failed", "motion_unknown", "off_paint"] as const;
export type CalibrationFrameReason = (typeof CALIBRATION_FRAME_REASONS)[number];

/** One calibration as the control plane pins it for `calibrate`: a whole-segment one (frameIndex null) or a keyframe. */
export type PinnedCalibration = {
  calibrationId: string;
  quality: "good" | "usable" | "failed";
  thresholdsVersion: string;
  /** Oriented: positive w for what the camera saw. */
  homography: Homography;
  points: { px: number; py: number }[];
  frameIndex: number | null;
  pitch: { lengthM: number; widthM: number };
};

export type CalibrateJobParams = {
  proxyChecksum: string;
  /** The pinned proxy's object key: the stage checks each carried frame against its own picture. */
  proxyKey: string;
  cameraMotion: { jobId: string; indexKey: string; indexChecksum: string };
  segments: { cameraSegmentId: string; startMs: number; endMs: number; kind: string; calibrations: PinnedCalibration[] }[];
  reachMs?: number;
  chunkMs?: number;
};

/** One row per proxy frame: pixel of that frame -> pitch metres, or why not. */
export type CalibrationFrameRow = {
  f: number;
  ms: number;
  cameraSegmentId: string | null;
  H: Homography | null;
  calibrationId: string | null;
  quality: "good" | "usable" | "failed" | null;
  keyframe: number | null;
  framesFromKeyframe: number | null;
  reason: CalibrationFrameReason | null;
};

/** A proposed camera segment, in source milliseconds, [start, end). */
export type ProposedSegment = { startMs: number; endMs: number; proxyStartMs: number; proxyEndMs: number };

// ── Game state ──────────────────────────────────────────────────────────────

/** Role of the index artifact a `gamestate` job writes, and of each Parquet chunk. */
export const GAMESTATE_INDEX_ROLE = "gamestate";
export const GAMESTATE_CHUNK_ROLE = "gamestate_chunk";

/** Source milliseconds per chunk, unless the job says otherwise. */
export const DEFAULT_GAMESTATE_CHUNK_MS = 60_000;

/**
 * A camera segment as the control plane hands it to the stage: every segment on
 * the asset, with its current calibration where a person filed one. A segment
 * without one is still declared, so the stage can say `segment_not_calibrated`
 * rather than `no_camera_segment` for the rows under it.
 *
 * A segment covers `startMs <= t < endMs`. The homography is oriented: `w` is
 * positive for a pixel the camera sees, so the stage can tell the horizon by its
 * sign.
 */
export type DeclaredSegment = {
  cameraSegmentId: string;
  startMs: number;
  endMs: number;
  /** `carried`: calibrated by keyframes; no single homography, each frame's comes from the pinned run. */
  quality: CalibrationQuality | "carried" | null;
  homography: Homography | null;
  pitch: PitchDimensions | null;
  keyframeIds?: string[];
};

/** A calibrate run as the control plane pins it for a stage that reads frames' calibrations. */
export type CarriedCalibrationPin = { jobId: string; indexKey: string; indexChecksum: string; chunkKeys: string[] };

export type DeclaredClockAnchor = { half: number; sourceMs: number; endMs: number | null };

/** What a `gamestate` job is given under `inputs.params`. */
export type GameStateJobParams = {
  tracks: { jobId: string; key: string; trackerVersionId: string | null };
  segments: DeclaredSegment[];
  anchors: DeclaredClockAnchor[];
  /** Present when a segment is `carried`. */
  carried?: CarriedCalibrationPin;
  chunkMs?: number;
  readKeys: { bucket: "derived" | "models"; key: string }[];
};

/** Why a row was not placed. */
export const GAMESTATE_SUPPRESSION_REASONS = ["no_camera_segment", "segment_not_calibrated", "calibration_failed", "calibration_not_carried", "beyond_horizon", "off_pitch"] as const;

/** How far outside the lines, in metres, a placed point may be and still be a position. */
export const OFF_PITCH_MARGIN_M = 5;

/**
 * What `validFrameCoverage` is a share of: the frames the tracker was given, or,
 * for a track artifact that does not carry them, only the frames with a track.
 */
export const GAMESTATE_COVERAGE_BASES = ["frames_tracked", "frames_with_tracks"] as const;
export type GameStateCoverageBasis = (typeof GAMESTATE_COVERAGE_BASES)[number];

export type GameStateCoverage = {
  rows: number;
  frames: number;
  placed: number;
  suppressed: number;
  reasons: Partial<Record<(typeof GAMESTATE_SUPPRESSION_REASONS)[number], number>>;
  /** Share of frames at least one row was placed on through a passing calibration; null with no frames. */
  validFrameCoverage: number | null;
  /** Frames the tracker was given over the same stretch, when the track artifact says. */
  framesTracked?: number | null;
  coverageBasis?: GameStateCoverageBasis;
};

export type GameStateChunk = GameStateCoverage & { index: number; file: string; key: string; fromMs: number; toMs: number; bytes: number };

/**
 * The index artifact. Each chunk's rows are flat: frame_index, source_ms, half,
 * match_minute, local_track_id, class, x_m, y_m, camera_segment_id, quality,
 * reason -- `x_m`/`y_m` null with a `reason` when suppressed.
 */
export type GameStateIndex = GameStateCoverage & {
  chunkMs: number;
  chunks: GameStateChunk[];
  tracks: number;
  trackJobId: string | null;
  trackerVersionId: string | null;
};
