/**
 * The prediction envelope.
 *
 * Every machine-produced fact, in every stage, in every artifact, uses this
 * wrapper. One shape means one review UI, one provenance drawer and one
 * supersede mechanism. See docs/vision/07-API-CONTRACTS.md.
 */

export const REVIEW_STATES = ["unreviewed", "accepted", "corrected", "rejected"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/**
 * Conditions attached at prediction time, because reconstructing them later is
 * guesswork. These become the benchmark slices.
 */
export const QUALITY_FLAGS = [
  "wide_shot",
  "zoomed",
  "night",
  "floodlit",
  "low_light",
  "motion_blur",
  "compression",
  "platform_copy",
  "crowded_box",
  "occluded",
  "kit_similarity",
  "partial_pitch",
  "camera_cut",
  "overlay_present",
  "ball_unknown",
  "calibration_invalid",
] as const;
export type QualityFlag = (typeof QUALITY_FLAGS)[number];

export type PredictionEnvelope<TPrediction> = {
  id: string;
  videoAssetId: string;
  sbMatchId: string | null;

  /**
   * Authoritative timestamp, in the SOURCE timeline.
   *
   * Both source and proxy times are carried because they diverge whenever the
   * source is variable-frame-rate or the proxy was trimmed. Storing only one is
   * how annotations end up pointing at the wrong moment after a re-transcode.
   */
  sourceTimeMs: number;
  /** What the player seeks to, in the normalised constant-FPS proxy. */
  proxyTimeMs: number;
  /** Frame index in the constant-FPS proxy. */
  frameIndex: number | null;

  modelVersionId: string;
  datasetVersionId: string | null;

  prediction: TPrediction;
  /** 0-1. Null when the producer genuinely has no calibrated confidence. */
  confidence: number | null;
  qualityFlags: QualityFlag[];

  reviewState: ReviewState;
  /** Set when a correction supersedes this row. Rows are never edited in place. */
  supersededBy: string | null;

  createdAt: string;
};

/**
 * Absent values are null, never a plausible default.
 *
 * A missing ball position is null with a `ball_unknown` flag — never the last
 * known coordinate carried forward, which would read as an observation.
 */
export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const DETECTION_CLASSES = ["player", "goalkeeper", "referee", "ball"] as const;
export type DetectionClass = (typeof DETECTION_CLASSES)[number];

/** One box in one frame. Pixels in the proxy's own coordinate space. */
export type DetectionPrediction = {
  class: DetectionClass;
  /** 0-1, the detector's own score. Never null here: a detector that cannot score a box did not detect it. */
  confidence: number;
  box: BoundingBox;
  /** The detector's native label before it was mapped onto `class`, kept so a mapping can be audited later. */
  rawLabel?: string;
};

/**
 * One sampled frame of the detection artifact.
 *
 * Carries both clocks, like the envelope, for the same reason: a prediction that
 * knows only proxy time cannot be placed in the source after a re-transcode.
 * `qualityFlags` holds `ball_unknown` when no ball was found -- an absence stated,
 * never a coordinate carried forward.
 */
export type DetectionFrame = {
  /** 1-based index among the frames the stage sampled. */
  sampleIndex: number;
  /** Frame index in the constant-FPS proxy (0-based), floored from `proxyTimeMs`. */
  frameIndex: number;
  proxyTimeMs: number;
  sourceTimeMs: number;
  qualityFlags: QualityFlag[];
  detections: DetectionPrediction[];
};

/** Artifact role under which a `detect` job writes its predictions. */
export const DETECTION_ARTIFACT_ROLE = "detections";

/**
 * What `detect` writes to object storage, whole.
 *
 * The bulk stays here rather than in Postgres (docs/vision/04-DATA-MODEL.md § CV
 * outputs); the control plane indexes only the summary. Everything a reader needs
 * to interpret a box -- which model, which dataset, which clock, which label map --
 * travels inside the file, so the artifact is meaningful without the database.
 */
export type DetectionArtifact = {
  contractVersion: string;
  role: typeof DETECTION_ARTIFACT_ROLE;
  videoAssetId: string | null;
  modelVersionId: string;
  datasetVersionId: string | null;
  proxy: { fps: number; sourceOffsetMs: number };
  sampleFps: number;
  minScore: number;
  /** Native label -> contract class, as applied. */
  classes: Record<string, DetectionClass>;
  detector: { weightsSha256: string | null; device: string | null };
  frames: DetectionFrame[];
};

export type PitchPoint = {
  /** Metres along the touchline, origin at one corner. */
  x: number;
  /** Metres along the goal line. */
  y: number;
};

/** Default normalised pitch. Actual dimensions are stored when known, because
 * grassroots pitches are frequently non-standard and assuming 105x68 on a short
 * pitch silently corrupts every distance derived from it. */
export const DEFAULT_PITCH_LENGTH_M = 105;
export const DEFAULT_PITCH_WIDTH_M = 68;

export const IDENTITY_METHODS = [
  "jersey",
  "roster_constraint",
  "manual",
  "propagated",
] as const;
export type IdentityMethod = (typeof IDENTITY_METHODS)[number];

/**
 * Identity is time-aware: a jersey number is reused across substitutions and
 * across matches in youth tournaments, so an assignment is valid for a window
 * rather than forever.
 *
 * `playerId: null` means unknown, and unknown is a correct answer. Nothing in
 * the schema or the UI may pressure it toward a guess.
 */
export type IdentityPrediction = {
  playerId: string | null;
  sbTeamSquadId: string | null;
  method: IdentityMethod;
  validFromMs: number;
  validToMs: number | null;
  jerseyCandidates: { number: number; confidence: number }[];
};
