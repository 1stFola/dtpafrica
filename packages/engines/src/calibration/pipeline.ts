import {
  resolvePrimaryBenchmarkIndex,
  selectBenchmarkFromPool,
} from "./benchmark-selection";
import { CALIBRATION_ATTRIBUTE_KEYS } from "./attribute-keys";
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
import { applySelectedBenchmarkInfluence } from "./benchmark-influence";

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
  return [...CALIBRATION_ATTRIBUTE_KEYS];
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
  const benchmarkAdjusted = applySelectedBenchmarkInfluence(
    calResult.calibrated,
    selection.nearest,
    rawSummary.overall_rating,
  );
  const calibrated = applyCalibrationRealityControls(raw, benchmarkAdjusted);

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
