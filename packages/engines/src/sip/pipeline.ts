import { averageRawMetrics, computeDerivedMetrics } from "./metrics-engine";
import { clampPercent } from "../clamp-percent";
import { computePositionFit } from "./position-fit-engine";
import { computeTacticalScores } from "./tactical-style-engine";
import type { RawMatchMetrics, TacticalScores } from "./types";

export type SipPipelineResult = {
  raw: RawMatchMetrics;
  derived: ReturnType<typeof computeDerivedMetrics>;
  tactical: TacticalScores;
  positionFit: ReturnType<typeof computePositionFit>;
  overallRating: number;
  offensiveRating: number;
  defensiveRating: number;
};

export function runSipPipeline(matchRows: RawMatchMetrics[]): SipPipelineResult {
  const raw = matchRows.length === 1 ? matchRows[0] : averageRawMetrics(matchRows);
  const derived = computeDerivedMetrics(raw);
  const tactical = computeTacticalScores(raw, derived);
  const positionFit = computePositionFit(tactical);

  const styleAvg =
    (tactical.gegenpressScore +
      tactical.tikiTakaScore +
      tactical.counterAttackScore +
      tactical.totalFootballScore) /
    4;

  const overallRating = clampPercent(
    styleAvg * 0.6 + tactical.technicalCleanlinessScore * 0.25 + tactical.twoFootednessScore * 0.15
  );

  const offensiveRating = clampPercent(
    (tactical.wingerScore + tactical.counterAttackScore + tactical.isolationThreatScore) / 3
  );

  const defensiveRating = clampPercent(
    (tactical.lowBlockScore + tactical.pressResistanceScore + tactical.gegenpressScore) / 3
  );

  return {
    raw,
    derived,
    tactical,
    positionFit,
    overallRating,
    offensiveRating,
    defensiveRating,
  };
}
