/**
 * Job and compute contracts.
 *
 * See docs/vision/06-JOBS-AND-COMPUTE.md.
 *
 * Nothing in this file may name a compute or storage provider. A worker receives
 * a job ID, its inputs, an output prefix, budgets and a callback base URL — and
 * nothing that tells it whose hardware it is running on.
 */

import type { BoundingBox, DetectionClass } from "./prediction";

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
 */
export const VISION_CONTRACT_VERSION = "1.8.0";

export const VISION_JOB_TYPES = [
  "probe",
  "fingerprint",
  "transcode",
  "cuts",
  "detect",
  "track",
  "identify",
  "calibrate",
  "gamestate",
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
  clip: "cpu_small",
  detect: "gpu_24gb",
  // Association over stored detections is arithmetic; see `benchmark`.
  track: "cpu_small",
  // Kit colour over a few decoded frames per track is arithmetic; see `benchmark`.
  identify: "cpu_small",
  calibrate: "gpu_24gb",
  gamestate: "cpu_small",
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
  detect: ["transcode"],
  track: ["detect"],
  identify: ["track"],
  calibrate: ["transcode"],
  gamestate: ["track", "calibrate"],
  events: ["gamestate"],
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
  detect: "derived",
  track: "derived",
  identify: "derived",
  calibrate: "derived",
  gamestate: "derived",
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
  readKeys: { bucket: "derived" | "models"; key: string }[];
};

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
export const DEFAULT_PITCH_DIMENSIONS: PitchDimensions = { lengthM: 105, widthM: 68 };

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

/** Who declared a camera segment: a person, or the scene-change filter. */
export const CAMERA_SEGMENT_SOURCES = ["manual", "scene_detect"] as const;
export type CameraSegmentSource = (typeof CAMERA_SEGMENT_SOURCES)[number];

/** Optional knobs under `inputs.params`, beside the proxy clock the clock gives every stage after transcode. */
export type CutsJobParams = {
  /** Scene-change score, 0-1, at or above which a frame is a cut. Default 0.4. */
  threshold?: number;
  /** Segments shorter than this are absorbed into the one before. Default 2000. */
  minSegmentMs?: number;
};

export type CameraCut = { proxyMs: number; sourceMs: number; score: number };

/** A proposed camera segment, in source milliseconds, [start, end). */
export type ProposedSegment = { startMs: number; endMs: number; proxyStartMs: number; proxyEndMs: number };
