import {
  resolvePrimaryBenchmarkIndex,
  selectBenchmarkFromPool,
} from "./benchmark-selection";
import { loadLegacyCalibration } from "./load-legacy";
import {
  matchMetricsToLegacyInput,
  playerToLegacyMeta,
  type MatchMetricsRow,
  type PlayerCalibrationMeta,
} from "./map-metrics";
import {
  summarizeCalibratedRatings,
  type CalibrationRatingSummary,
} from "./rating-summary";
import { applyCalibrationRealityControls } from "./reality-controls";

export type CalibrationResult = {
  meta: Record<string, unknown>;
  raw: Record<string, number>;
  calibrated: Record<string, number>;
  rawSummary: CalibrationRatingSummary;
  calibratedSummary: CalibrationRatingSummary;
  nearestBenchmark: Record<string, unknown>;
  alternativeBenchmarks: Record<string, unknown>[];
  rankedCandidates: Record<string, unknown>[];
  primaryBenchmarkIndex: number;
  filterInfo: { poolSize: number };
};

export type RunCalibrationOptions = {
  /** Override tier-based auto-selection (admin manual swap). */
  primaryBenchmarkIndex?: number;
};

export function getCalibrationAttributeKeys(): string[] {
  return loadLegacyCalibration().ATTRS;
}

export function runCalibration(
  metrics: MatchMetricsRow,
  playerMeta: PlayerCalibrationMeta,
  options: RunCalibrationOptions = {},
): CalibrationResult {
  const legacy = loadLegacyCalibration();
  const matchData = legacy.estimateMissingFields(matchMetricsToLegacyInput(metrics));
  const meta = legacy.getPlayerMeta(playerMeta as Record<string, unknown>);
  const raw = legacy.computeRawRatings(matchData);
  const calResult = legacy.calibrate(meta, raw);
  const calibrated = applyCalibrationRealityControls(raw, calResult.calibrated);

  const rankedCandidates =
    calResult.rankedCandidates?.length > 0
      ? calResult.rankedCandidates
      : [calResult.nearest, ...calResult.alternatives].filter(Boolean);

  const rawSummary = legacy.summaryRatings(raw);
  const autoIndex = resolvePrimaryBenchmarkIndex(rawSummary.overall_rating);
  const selection = selectBenchmarkFromPool(
    rankedCandidates,
    options.primaryBenchmarkIndex ?? autoIndex,
  );

  return {
    meta,
    raw,
    calibrated,
    rawSummary,
    calibratedSummary: summarizeCalibratedRatings(calibrated),
    nearestBenchmark: selection.nearest,
    alternativeBenchmarks: selection.alternativeBenchmarks,
    rankedCandidates,
    primaryBenchmarkIndex: selection.primaryBenchmarkIndex,
    filterInfo: calResult.filterInfo,
  };
}
