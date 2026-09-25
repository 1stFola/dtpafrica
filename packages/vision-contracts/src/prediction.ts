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
