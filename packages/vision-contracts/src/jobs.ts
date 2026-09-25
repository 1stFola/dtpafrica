/**
 * Job and compute contracts.
 *
 * See docs/vision/06-JOBS-AND-COMPUTE.md.
 *
 * Nothing in this file may name a compute or storage provider. A worker receives
 * a job ID, its inputs, an output prefix, budgets and a callback base URL — and
 * nothing that tells it whose hardware it is running on.
 */

/** Bumped on any change to VisionJobSpec or the prediction envelope. */
export const VISION_CONTRACT_VERSION = "1.0.0";

export const VISION_JOB_TYPES = [
  "probe",
  "fingerprint",
  "transcode",
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
  clip: "cpu_small",
  detect: "gpu_24gb",
  track: "gpu_24gb",
  identify: "gpu_24gb",
  calibrate: "gpu_24gb",
  gamestate: "cpu_small",
  events: "cpu_small",
  vlm: "cpu_small",
  train: "gpu_48gb",
  benchmark: "gpu_24gb",
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

export type VisionJobInputs = {
  videoAssetId?: string;
  /** Objects the worker is permitted to read, as logical refs. */
  readKeys?: { bucket: string; key: string }[];
  datasetVersionId?: string;
  modelVersionIds?: string[];
  /** Stage-specific parameters, validated per job type. */
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
