/**
 * `train`: fine-tune a detector on a frozen dataset version (docs/vision/98 step 4, /102).
 *
 * The first trainer is the torchvision Faster R-CNN baseline (BSD-3, already in the
 * image, approved in the OSS register as a baseline only). It starts from the COCO
 * weights, replaces the box head with the contract's classes, and learns from the
 * dataset's train split. The val split is scored with the benchmark's own evaluation,
 * so the numbers a run reports are comparable with a benchmark's.
 *
 * Frames come from the export's label windows, not only from frames with boxes: a
 * labelled frame with no ball box is a real "no ball here", and dropping it would
 * teach the model that every frame has one. A frame with an uncertain box, or under an
 * uncertain window, is left out of both splits: an unsure label is neither a positive
 * nor a negative.
 */
import { DETECTOR_CONFIG_BASE } from "./jobs";
import type { DetectionClass } from "./prediction";

export const TRAIN_VERSION = "train-fasterrcnn/v1";
/** The config key a version registered from a run carries; detect learns to load it next. */
export const TRAINED_DETECTOR_CONFIG = "trained/torchvision/fasterrcnn_resnet50_fpn/v1";
export const TRAIN_ARTIFACT_ROLES = { weights: "weights", config: "train_config", metrics: "train_metrics" } as const;
export const TRAIN_SPLITS = ["train", "val"] as const;
export type TrainSplit = (typeof TRAIN_SPLITS)[number];

export type TrainHyperparameters = {
  epochs: number;
  batchSize: number;
  learningRate: number;
  /** Seeds the data order and the head's initialisation, so a rerun is the same run. */
  seed: number;
  /** torchvision's resize bounds: the proxies are 1280x720, so 720/1280 keeps them native. */
  minSize: number;
  maxSize: number;
};

export const TRAIN_DEFAULTS: TrainHyperparameters = { epochs: 12, batchSize: 4, learningRate: 0.01, seed: 2026, minSize: 720, maxSize: 1280 };
/** Bounds the control plane enforces, so a typo cannot book a week of GPU. */
export const TRAIN_LIMITS = {
  epochs: [1, 60],
  batchSize: [1, 16],
  learningRate: [1e-5, 0.1],
  minSize: [256, 1440],
  maxSize: [512, 2560],
} as const;

export type TrainMember = {
  videoAssetId: string;
  split: TrainSplit;
  /** The proxy the export's `filepath` names, in the derived bucket. */
  proxyKey: string;
};

export type TrainJobParams = {
  version: typeof TRAIN_VERSION;
  base: { configKey: typeof DETECTOR_CONFIG_BASE };
  classes: readonly DetectionClass[];
  /** The export's samples.json, pinned by the checksum it had when the run was asked for. */
  export: { key: string; checksum: string };
  members: TrainMember[];
  hyperparameters: TrainHyperparameters;
  readKeys: { bucket: "derived"; key: string }[];
};

/** What a completed run reports; the full evaluation is in the metrics artifact. */
export type TrainSummary = {
  version: typeof TRAIN_VERSION;
  configKey: typeof TRAINED_DETECTOR_CONFIG;
  datasetVersionId: string;
  exportChecksum: string;
  weightsKey: string;
  weightsSha256: string;
  frames: { train: number; val: number; skippedUncertain: number };
  boxes: { train: Record<string, number>; val: Record<string, number> };
  epochs: number;
  /** Mean training loss of the last epoch. */
  finalLoss: number;
  /** From the val evaluation, under slice `all`: ball recall and AP, and mean AP. */
  val: { ballRecall: number | null; ballAp: number | null; meanAp: number | null };
  torch: string;
  torchvision: string;
};
