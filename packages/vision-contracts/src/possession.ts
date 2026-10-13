import type { BallTrajectoryJobParams } from "./ball-trajectory";

/** Provisional image-proximity candidates. No accepted possession or player identity. */
export const POSSESSION_VERSION = "possession-candidates/v1";
export const CALIBRATED_POSSESSION_VERSION = "possession-candidates/v2";
export const POSSESSION_CALIBRATED_REASONS = ["calibration_unavailable", "projection_invalid", "off_pitch", "metric_distance", "implausible_motion"] as const;
export const POSSESSION_INDEX_ROLE = "possession";
export const POSSESSION_CHUNK_ROLE = "possession_chunk";
export const POSSESSION_UNKNOWN_REASONS = ["ball_lost", "weak_ball", "no_player", "no_near_player", "ambiguous_players", "weak_player", "continuity_pending"] as const;
export type PossessionUnknownReason = (typeof POSSESSION_UNKNOWN_REASONS)[number] | (typeof POSSESSION_CALIBRATED_REASONS)[number];
/**
 * Calibration as a possession or carry run pinned it. A segment is uncalibrated (null),
 * failed, passing with one homography (a still camera), or `carried`: calibrated by
 * keyframes, its frames read from the pinned calibrate run (`carried`, docs/vision/94).
 */
export type PossessionCalibrationSnapshot = {
  proxyWidth: number; proxyHeight: number; proxyVariantId: string; proxyKey: string; proxyChecksum: string;
  segments: { cameraSegmentId: string; startMs: number; endMs: number; calibrationId: string | null;
    quality: "good" | "usable" | "failed" | "carried" | null; thresholdsVersion: string | null;
    homography: number[] | null; pitch: { lengthM: number; widthM: number } | null; keyframeIds?: string[] }[];
  carried?: import("./jobs").CarriedCalibrationPin;
};
export type PossessionFootballConfig = { maxGroundDistanceM?: number; maxBallGroundSpeedMps?: number; maxPlayerSpeedMps?: number };
export type PossessionCandidateSegment = {
  startMs: number; endMs: number; frames: number;
  state: "candidate" | "unknown";
  cameraSegmentId: string | null; trajectoryId: number | null;
  /** Scoped to this run's track artifact. Never a roster/player/team ID. */
  localTrackId: number | null;
  reason: PossessionUnknownReason | null;
  /** Minimum contributing detection confidence, not a possession probability. */
  evidenceConfidence: number | null;
  reviewState: "unreviewed";
};
export type PossessionJobParams = {
  ball: { jobId: string; key: string; indexChecksum: string; chunkKeys: string[] };
  tracks: { jobId: string; key: string; trackerVersionId: string; checksum: string };
  sourceChecksum: string; sourceDurationMs: number; proxyChecksum: string;
  proxyDurationMs: number; imageWidth: number; imageHeight: number;
  detectionsChecksum: string; detectorJobId: string; detectorVersionId: string;
  proxy: { fps: number; sourceOffsetMs: number };
  segments: BallTrajectoryJobParams["segments"];
  constraintMode?: "image" | "calibrated";
  calibrationSnapshot?: PossessionCalibrationSnapshot;
  footballConfig?: PossessionFootballConfig;
  possessionConfig?: { minBallConfidence?: number; minPlayerConfidence?: number; maxFootDistanceHeights?: number; minContinuityMs?: number; maxBallGapMs?: number };
  chunkMs?: number;
  readKeys: { bucket: "derived"; key: string }[];
};
