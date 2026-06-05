import { loadLegacyCalibration } from "./load-legacy";
import {
  matchMetricsToLegacyInput,
  playerToLegacyMeta,
  type MatchMetricsRow,
  type PlayerCalibrationMeta,
} from "./map-metrics";

export type CalibrationResult = {
  meta: Record<string, unknown>;
  raw: Record<string, number>;
  calibrated: Record<string, number>;
  rawSummary: { offensive_score: number; defensive_score: number; overall_rating: number };
  calibratedSummary: { offensive_score: number; defensive_score: number; overall_rating: number };
  nearestBenchmark: Record<string, unknown>;
  alternativeBenchmarks: Record<string, unknown>[];
  filterInfo: { poolSize: number };
};

export function getCalibrationAttributeKeys(): string[] {
  return loadLegacyCalibration().ATTRS;
}

export function runCalibration(
  metrics: MatchMetricsRow,
  playerMeta: PlayerCalibrationMeta,
): CalibrationResult {
  const legacy = loadLegacyCalibration();
  const matchData = legacy.estimateMissingFields(matchMetricsToLegacyInput(metrics));
  const meta = legacy.getPlayerMeta(playerMeta as Record<string, unknown>);
  const raw = legacy.computeRawRatings(matchData);
  const calResult = legacy.calibrate(meta, raw);
  const calibrated = calResult.calibrated;

  return {
    meta,
    raw,
    calibrated,
    rawSummary: legacy.summaryRatings(raw),
    calibratedSummary: legacy.summaryRatings(calibrated),
    nearestBenchmark: calResult.nearest,
    alternativeBenchmarks: calResult.alternatives,
    filterInfo: calResult.filterInfo,
  };
}
