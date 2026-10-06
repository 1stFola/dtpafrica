import type { CameraSegmentKind } from "./media";
import type { TrackJobParams } from "./jobs";

export const BALL_TRAJECTORY_VERSION = "ball-trajectory/v1";
export const BALL_TRAJECTORY_INDEX_ROLE = "ball_trajectory";
export const BALL_TRAJECTORY_CHUNK_ROLE = "ball_trajectory_chunk";
export const BALL_LOST_REASONS = ["missing_frame", "no_detection", "low_confidence", "ambiguous", "invalid_detection", "motion_jump", "camera_unknown", "camera_cut", "non_play"] as const;
export type BallLostReason = (typeof BALL_LOST_REASONS)[number];
export type BallTrajectoryRow = {
  frameIndex: number;
  sourceTimeMs: number;
  cameraSegmentId: string | null;
  trajectoryId: number | null;
  state: "observed" | "lost";
  reason: BallLostReason | null;
  /** Image coordinates only. Never a pitch coordinate, speed or possession claim. */
  point: { x: number; y: number } | null;
  rawPoint: { x: number; y: number } | null;
  confidence: number | null;
};
export type BallTrajectoryJobParams = {
  detections: TrackJobParams["detections"] & { weightsChecksum: string };
  sourceChecksum: string;
  sourceDurationMs: number;
  proxyChecksum: string;
  proxyDurationMs: number;
  imageWidth: number;
  imageHeight: number;
  segments: { cameraSegmentId: string; startMs: number; endMs: number; kind: CameraSegmentKind }[];
  readKeys: { bucket: "derived"; key: string }[];
};
