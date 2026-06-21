import { clampPercent } from "../clamp-percent";
import type { DerivedMetrics, RawMatchMetrics } from "./types";

function safeDiv(n: number, d: number): number {
  if (!d || !Number.isFinite(d)) return 0;
  return n / d;
}

function clamp(n: number, min = 0, max = 100): number {
  return clampPercent(n);
}

/** Normalize a raw value into 0–100 using soft caps (Phase 1 heuristic). */
export function normalize(value: number, cap: number): number {
  if (!Number.isFinite(value) || cap <= 0) return 0;
  return clamp((value / cap) * 100);
}

export function computeDerivedMetrics(raw: RawMatchMetrics): DerivedMetrics {
  const minutes = Math.max(raw.minutesPlayed, 1);
  const totalTouches = raw.leftFootTouchCount + raw.rightFootTouchCount;
  const leftFootTouchPct = safeDiv(raw.leftFootTouchCount, totalTouches) * 100;
  const rightFootTouchPct = safeDiv(raw.rightFootTouchCount, totalTouches) * 100;
  const totalPossessions = raw.oneTouchPossessions + raw.multiTouchPossessions;

  const turnEfficiency =
    raw.avgTurnEntrySpeedMph > 0
      ? raw.avgTurnExitSpeedMph / raw.avgTurnEntrySpeedMph
      : 1;

  const turnDiversity = (raw.leftTurns + raw.rightTurns + raw.backTurns) / 3;

  const workloadIndex =
    (raw.totalDistanceMiles * 1609 + raw.sprintDistanceYards * 0.9144) / minutes;

  const sprintFrequency = safeDiv(raw.sprints, minutes);
  const accelerationDensity =
    safeDiv(raw.firstStepAccelerations + raw.intenseAccelerations, minutes);
  const ballActivityRate = safeDiv(raw.ballTouches, minutes);

  const twoFootednessScore = 100 - Math.abs(leftFootTouchPct - rightFootTouchPct);

  const quickReleaseScore =
    totalPossessions > 0 ? (raw.oneTouchPossessions / totalPossessions) * 100 : 0;

  const controlledReceive = raw.leftFootReceiveCount + raw.rightFootReceiveCount;
  const technicalCleanlinessScore =
    raw.releaseInsideFootCount + controlledReceive + turnEfficiency * 10;

  const directPlayScore =
    raw.releaseLacesCount + raw.kickingPowerMph + raw.sprintDistanceYards * 0.1;

  const flairScore =
    raw.releaseOtherFootzoneCount + raw.intenseTurnsWithBall + turnDiversity;

  return {
    turnEfficiency,
    turnDiversity,
    workloadIndex,
    sprintFrequency,
    accelerationDensity,
    ballActivityRate,
    twoFootednessScore: clamp(twoFootednessScore),
    quickReleaseScore: clamp(quickReleaseScore),
    technicalCleanlinessScore,
    directPlayScore,
    flairScore,
    leftFootTouchPct,
    rightFootTouchPct,
  };
}

export function averageRawMetrics(rows: RawMatchMetrics[]): RawMatchMetrics {
  if (rows.length === 0) {
    throw new Error("averageRawMetrics: no rows");
  }
  const keys = Object.keys(rows[0]) as (keyof RawMatchMetrics)[];
  const out = { ...rows[0] };
  for (const key of keys) {
    const sum = rows.reduce((acc, r) => acc + (r[key] as number), 0);
    (out[key] as number) = sum / rows.length;
  }
  return out;
}
