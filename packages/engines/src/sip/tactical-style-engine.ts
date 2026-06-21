import { clampPercent } from "../clamp-percent";
import type { DerivedMetrics, RawMatchMetrics, TacticalScores } from "./types";
import { normalize } from "./metrics-engine";

/**
 * Weighted blends per SIP spec — outputs clamped 0–100.
 */
export function computeTacticalScores(
  raw: RawMatchMetrics,
  derived: DerivedMetrics
): TacticalScores {
  const minutes = Math.max(raw.minutesPlayed, 1);

  const gegenpressScore = clampPercent(
    raw.intenseAccelerations * 0.3 +
      raw.sprints * 0.25 +
      raw.intenseTurns * 0.2 +
      normalize(raw.sprintDistanceYards, 800) * 0.15 +
      normalize(derived.workloadIndex, 120) * 0.1
  );

  const tikiTakaScore = clampPercent(
    normalize(raw.ballTouches, 80) * 0.35 +
      derived.turnEfficiency * 25 * 0.25 +
      normalize(raw.distanceWithBallYards, 400) * 0.2 +
      (raw.leftTurns + raw.rightTurns) * 0.2
  );

  const counterAttackScore = clampPercent(
    normalize(raw.topSpeedMph, 22) * 0.3 +
      normalize(raw.sprintDistanceYards, 600) * 0.25 +
      normalize(raw.topSpeedWithBallMph, 18) * 0.2 +
      normalize(raw.distanceWithBallYards, 350) * 0.15 +
      normalize(raw.kickingPowerMph, 70) * 0.1
  );

  const totalFootballScore = clampPercent(
    normalize(raw.totalDistanceMiles, 7) * 0.3 +
      derived.turnDiversity * 3 * 0.25 +
      normalize(raw.distanceWithBallYards, 500) * 0.2 +
      derived.sprintFrequency * 20 * 0.15 +
      derived.accelerationDensity * 15 * 0.1
  );

  const highLineScore = clampPercent(
    normalize(raw.topSpeedMph, 22) * 0.4 +
      derived.sprintFrequency * 25 * 0.3 +
      raw.backTurns * 0.2 +
      raw.intenseAccelerations * 0.1
  );

  const wingerScore = clampPercent(
    normalize(raw.topSpeedWithBallMph, 18) * 0.3 +
      raw.intenseTurnsWithBall * 0.25 +
      normalize(raw.distanceWithBallYards, 400) * 0.25 +
      raw.sprints * 0.2
  );

  const lowBlockScore = clampPercent(
    raw.intenseTurns * 0.35 +
      raw.firstStepAccelerations * 0.25 +
      raw.backTurns * 0.2 +
      (raw.totalDistanceMiles > 0 ? (1 / raw.totalDistanceMiles) * 20 : 0) * 0.2
  );

  const quickReleaseScore = clampPercent(derived.quickReleaseScore, 1);
  const technicalCleanlinessScore = clampPercent(
    normalize(derived.technicalCleanlinessScore, 80),
    1
  );
  const directPlayScore = clampPercent(normalize(derived.directPlayScore, 100), 1);
  const flairScore = clampPercent(normalize(derived.flairScore, 50), 1);
  const twoFootednessScore = clampPercent(derived.twoFootednessScore, 1);

  const ballRetentionScore = clampPercent(
    tikiTakaScore * 0.5 + technicalCleanlinessScore * 0.3 + twoFootednessScore * 0.2
  );

  const pressResistanceScore = clampPercent(
    gegenpressScore * 0.4 + technicalCleanlinessScore * 0.35 + twoFootednessScore * 0.25
  );

  const possessionHubScore = clampPercent(
    tikiTakaScore * 0.45 + ballRetentionScore * 0.35 + derived.ballActivityRate * 10 * 0.2
  );

  const transitionExplosivenessScore = clampPercent(
    counterAttackScore * 0.5 + gegenpressScore * 0.3 + wingerScore * 0.2
  );

  const isolationThreatScore = clampPercent(
    wingerScore * 0.4 + flairScore * 0.35 + directPlayScore * 0.25
  );

  return {
    gegenpressScore,
    tikiTakaScore,
    counterAttackScore,
    totalFootballScore,
    highLineScore,
    wingerScore,
    lowBlockScore,
    quickReleaseScore,
    ballRetentionScore,
    technicalCleanlinessScore,
    directPlayScore,
    flairScore,
    pressResistanceScore,
    possessionHubScore,
    transitionExplosivenessScore,
    isolationThreatScore,
    twoFootednessScore,
  };
}
