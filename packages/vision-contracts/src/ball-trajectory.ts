import type { CameraSegmentKind } from "./media";
import type { CalibrateJobParams, TrackJobParams } from "./jobs";

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
  /**
   * The camera motion measured on the same proxy, pinned when the detections hold
   * tiled balls: the stage removes the camera's motion to find a tiled ball that stays
   * on one spot of the ground, and drops it as not in play (docs/vision/95).
   */
  cameraMotion?: CalibrateJobParams["cameraMotion"];
  readKeys: { bucket: "derived"; key: string }[];
};

/** A tiled ball on one ground spot (within BALL_PARKED_RADIUS_PX) for this many frames of its shot is parked. */
export const BALL_PARKED_MIN_FRAMES = 60;
export const BALL_PARKED_RADIUS_PX = 6;
