/**
 * `hard_frames`: the frames worth a person's time, picked from a detect run and its ball
 * trajectory, each with the detector's boxes for that frame so labelling starts from a
 * correction rather than an empty picture (docs/vision/98, /99).
 *
 * A CPU stage over stored output: no model runs. The detector that drew the boxes is the
 * detect job's model version, and every box carries it, so a reviewer always sees which
 * boxes a model suggested.
 */
import type { DetectionClass } from "./prediction";
import type { SamplingStrategy } from "./media";

export const HARD_FRAMES_VERSION = "hard-frames/v1";
export const HARD_FRAMES_ARTIFACT_ROLE = "hard_frames";

/** Why a frame was picked, as the stage saw it. */
export const HARD_FRAME_CAUSES = [
  /** The ball was seen just before and just after, but the detector found none here. */
  "ball_missed_between_sightings",
  /** The detector's best ball here was under the trajectory's confidence bar. */
  "ball_low_confidence",
  /** The tiled pass found a ball the full-frame pass did not. */
  "tile_only_ball",
  /** An ordinary live-play frame, so the model also sees routine play. */
  "random_live_play",
] as const;
export type HardFrameCause = (typeof HARD_FRAME_CAUSES)[number];

/** The labelling queue's reason for each cause: the sampling strategy the task records. */
export const HARD_FRAME_REASON: Record<HardFrameCause, SamplingStrategy> = {
  ball_missed_between_sightings: "stage_disagreement",
  ball_low_confidence: "low_confidence",
  tile_only_ball: "stage_disagreement",
  random_live_play: "uniform_random",
};

export const MAX_HARD_FRAMES = 500;
export const MAX_HARD_FRAME_BOXES = 60;
export const MAX_HARD_FRAMES_BYTES = 4 * 1024 * 1024;

export type HardFramesJobParams = {
  /** The detect run whose boxes become pre-labels, pinned to its bytes. */
  detections: { jobId: string; key: string; checksum: string; modelVersionId: string };
  /** The ball trajectory over those detections, pinned (index and chunks). */
  ball: { jobId: string; key: string; indexChecksum: string; chunkKeys: string[] };
  proxy: { fps: number; sourceOffsetMs: number };
  imageWidth: number;
  imageHeight: number;
  sourceChecksum: string;
  /** How many frames to pick, and what share of them ordinary play. */
  maxFrames?: number;
  randomShare?: number;
  /** Picked frames are at least this far apart, so one moment is not labelled ten times. */
  minGapMs?: number;
  readKeys: { bucket: "derived"; key: string }[];
};

export type HardFrameBox = {
  class: DetectionClass;
  /** Normalised to the proxy frame, top-left corner and size: the annotation box's geometry. */
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  /** Set when the tiled ball pass drew it. */
  source?: string;
};

export type HardFrame = {
  frameIndex: number;
  sourceTimeMs: number;
  cause: HardFrameCause;
  reason: SamplingStrategy;
  /** 0-1: how much a person's label here is expected to teach. Random frames rank last. */
  score: number;
  boxes: HardFrameBox[];
};

export type HardFramesArtifact = {
  role: typeof HARD_FRAMES_ARTIFACT_ROLE;
  calculationVersion: typeof HARD_FRAMES_VERSION;
  videoAssetId: string;
  sourceChecksum: string;
  detectJobId: string;
  detectorVersionId: string;
  ballJobId: string;
  frameDurationMs: number;
  frames: HardFrame[];
};
