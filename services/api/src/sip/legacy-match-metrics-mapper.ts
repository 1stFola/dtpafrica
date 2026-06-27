import type { RawMatchMetrics } from "@dtp/engines";
import type { PlayerMatchMetrics } from "@prisma/client";
import type { LegacyMatchMetricsDto } from "../admin/dto/calibration-player-info.dto";

const SYNTHETIC_TOTAL = 10_000;

function pctToCount(pct: number, total = SYNTHETIC_TOTAL): number {
  return Math.round((pct / 100) * total);
}

function countsToPct(numerator: number, denominator: number): number | undefined {
  if (denominator <= 0) return undefined;
  return (numerator / denominator) * 100;
}

/** Map legacy CSV metrics into Prisma `player_match_metrics` columns. */
export function legacyMatchMetricsToPlayerMatchRecord(
  m: LegacyMatchMetricsDto
): Omit<PlayerMatchMetrics, "id" | "playerId" | "matchId" | "createdAt" | "updatedAt"> {
  const oneTouchPct = m.one_touch_possessions_percentage;
  const multiTouchPct = m.multi_touch_possessions__percentage;
  let oneTouchPossessions = 0;
  let multiTouchPossessions = 0;
  if (oneTouchPct != null) {
    oneTouchPossessions = pctToCount(oneTouchPct);
    multiTouchPossessions =
      multiTouchPct != null ? pctToCount(multiTouchPct) : SYNTHETIC_TOTAL - oneTouchPossessions;
  } else if (multiTouchPct != null) {
    multiTouchPossessions = pctToCount(multiTouchPct);
    oneTouchPossessions = SYNTHETIC_TOTAL - multiTouchPossessions;
  }

  const leftReleasePct = m.left_foot_release_percentage;
  const rightReleasePct = m.right_foot_release_percentage;
  let leftFootReleaseCount = 0;
  let rightFootReleaseCount = 0;
  if (leftReleasePct != null) {
    leftFootReleaseCount = pctToCount(leftReleasePct);
    rightFootReleaseCount =
      rightReleasePct != null ? pctToCount(rightReleasePct) : SYNTHETIC_TOTAL - leftFootReleaseCount;
  } else if (rightReleasePct != null) {
    rightFootReleaseCount = pctToCount(rightReleasePct);
    leftFootReleaseCount = SYNTHETIC_TOTAL - rightFootReleaseCount;
  }

  const leftTouchPct = m.left_foot_touch_percentage;
  const rightTouchPct = m.right_foot_touch_percentage;
  let leftFootTouchCount = 0;
  let rightFootTouchCount = 0;
  if (leftTouchPct != null) {
    leftFootTouchCount = pctToCount(leftTouchPct);
    rightFootTouchCount =
      rightTouchPct != null ? pctToCount(rightTouchPct) : SYNTHETIC_TOTAL - leftFootTouchCount;
  } else if (rightTouchPct != null) {
    rightFootTouchCount = pctToCount(rightTouchPct);
    leftFootTouchCount = SYNTHETIC_TOTAL - rightFootTouchCount;
  }

  const leftReceivePct = m.left_foot_receive_percentage;
  const rightReceivePct = m.right_foot_receive_percentage;
  let leftFootReceiveCount = 0;
  let rightFootReceiveCount = 0;
  if (leftReceivePct != null) {
    leftFootReceiveCount = pctToCount(leftReceivePct);
    rightFootReceiveCount =
      rightReceivePct != null
        ? pctToCount(rightReceivePct)
        : SYNTHETIC_TOTAL - leftFootReceiveCount;
  } else if (rightReceivePct != null) {
    rightFootReceiveCount = pctToCount(rightReceivePct);
    leftFootReceiveCount = SYNTHETIC_TOTAL - rightFootReceiveCount;
  }

  const releaseLacesPct = m.release_laces_percentage;
  const releaseInsidePct = m.release_inside_foot_percentage;
  const releaseOtherPct = m.release_other_footzone_percentage;
  let releaseLacesCount = 0;
  let releaseInsideFootCount = 0;
  let releaseOtherFootzoneCount = 0;
  if (releaseLacesPct != null || releaseInsidePct != null || releaseOtherPct != null) {
    releaseLacesCount = releaseLacesPct != null ? pctToCount(releaseLacesPct) : 0;
    releaseInsideFootCount = releaseInsidePct != null ? pctToCount(releaseInsidePct) : 0;
    releaseOtherFootzoneCount = releaseOtherPct != null ? pctToCount(releaseOtherPct) : 0;
    const releaseTotal =
      releaseLacesCount + releaseInsideFootCount + releaseOtherFootzoneCount;
    if (releaseTotal > 0 && releaseTotal !== SYNTHETIC_TOTAL) {
      const scale = SYNTHETIC_TOTAL / releaseTotal;
      releaseLacesCount = Math.round(releaseLacesCount * scale);
      releaseInsideFootCount = Math.round(releaseInsideFootCount * scale);
      releaseOtherFootzoneCount =
        SYNTHETIC_TOTAL - releaseLacesCount - releaseInsideFootCount;
    }
  }

  return {
    minutesPlayed: m.duration ?? 0,
    ballTouches: m.ball_touches ?? 0,
    oneTouchPossessions,
    multiTouchPossessions,
    possessionDurationSeconds: m.possession_duration_seconds ?? 0,
    releaseLacesCount,
    releaseInsideFootCount,
    releaseOtherFootzoneCount,
    leftFootTouchCount,
    rightFootTouchCount,
    leftFootReleaseCount,
    rightFootReleaseCount,
    leftFootReceiveCount,
    rightFootReceiveCount,
    leftFootKickingPowerMph: m.left_foot_kicking_power_mph ?? null,
    rightFootKickingPowerMph: m.right_foot_kicking_power_mph ?? null,
    totalDistanceMiles: m.total_distance ?? 0,
    sprintDistanceYards: m.sprint_distance ?? 0,
    firstStepAccelerations: m.first_step_accelerations ?? 0,
    intenseAccelerations: m.intense_accelerations ?? 0,
    kickingPowerMph: m.kicking_power ?? null,
    topSpeedMph: m.top_speed ?? null,
    sprints: m.sprints ?? 0,
    intenseTurns: m.intense_turns ?? 0,
    avgTurnEntrySpeedMph: m.avg_turn_entry ?? null,
    avgTurnExitSpeedMph: m.avg_turn_exit ?? null,
    leftTurns: m.left_turns ?? 0,
    rightTurns: m.right_turns ?? 0,
    backTurns: m.back_turns ?? 0,
    distanceWithBallYards: m.distance_with_ball ?? 0,
    topSpeedWithBallMph: m.top_speed_with_ball ?? null,
    intenseTurnsWithBall: m.intense_turns_with_ball ?? 0,
  };
}

/** Reconstruct legacy CSV fields from stored match metrics. */
export function playerMatchMetricsToLegacyMetrics(
  row: PlayerMatchMetrics
): LegacyMatchMetricsDto {
  const totalPossessions = row.oneTouchPossessions + row.multiTouchPossessions;
  const totalRelease = row.leftFootReleaseCount + row.rightFootReleaseCount;
  const totalTouch = row.leftFootTouchCount + row.rightFootTouchCount;
  const totalReceive = row.leftFootReceiveCount + row.rightFootReceiveCount;
  const totalReleases =
    row.releaseLacesCount + row.releaseInsideFootCount + row.releaseOtherFootzoneCount;

  const oneTouchPct = countsToPct(row.oneTouchPossessions, totalPossessions);
  const multiTouchPct = countsToPct(row.multiTouchPossessions, totalPossessions);
  const quickRelease =
    oneTouchPct ??
  (totalPossessions > 0
    ? countsToPct(row.oneTouchPossessions, totalPossessions)
    : undefined);

  return {
    duration: row.minutesPlayed,
    total_distance: row.totalDistanceMiles,
    sprint_distance: row.sprintDistanceYards,
    sprints: row.sprints,
    top_speed: row.topSpeedMph ?? 0,
    first_step_accelerations: row.firstStepAccelerations,
    intense_accelerations: row.intenseAccelerations,
    intense_turns: row.intenseTurns,
    avg_turn_entry: row.avgTurnEntrySpeedMph ?? 0,
    avg_turn_exit: row.avgTurnExitSpeedMph ?? 0,
    turn_efficiency:
      row.avgTurnEntrySpeedMph && row.avgTurnEntrySpeedMph > 0
        ? (row.avgTurnExitSpeedMph ?? 0) / row.avgTurnEntrySpeedMph
        : 0,
    left_turns: row.leftTurns,
    right_turns: row.rightTurns,
    back_turns: row.backTurns,
    ball_touches: row.ballTouches,
    possession_duration_seconds: row.possessionDurationSeconds,
    one_touch_possessions_percentage: oneTouchPct ?? 0,
    multi_touch_possessions__percentage: multiTouchPct ?? 0,
    quick_release_score: quickRelease ?? 0,
    distance_with_ball: row.distanceWithBallYards,
    top_speed_with_ball: row.topSpeedWithBallMph ?? 0,
    intense_turns_with_ball: row.intenseTurnsWithBall,
    kicking_power: row.kickingPowerMph ?? 0,
    release_inside_foot_percentage:
      countsToPct(row.releaseInsideFootCount, totalReleases) ?? 0,
    release_laces_percentage: countsToPct(row.releaseLacesCount, totalReleases) ?? 0,
    release_other_footzone_percentage:
      countsToPct(row.releaseOtherFootzoneCount, totalReleases) ?? 0,
    left_foot_touch_percentage: countsToPct(row.leftFootTouchCount, totalTouch) ?? 0,
    left_foot_release_percentage: countsToPct(row.leftFootReleaseCount, totalRelease) ?? 0,
    left_foot_receive_percentage: countsToPct(row.leftFootReceiveCount, totalReceive) ?? 0,
    left_foot_kicking_power_mph: row.leftFootKickingPowerMph ?? 0,
    right_foot_touch_percentage: countsToPct(row.rightFootTouchCount, totalTouch) ?? 0,
    right_foot_release_percentage: countsToPct(row.rightFootReleaseCount, totalRelease) ?? 0,
    right_foot_receive_percentage: countsToPct(row.rightFootReceiveCount, totalReceive) ?? 0,
    right_foot_kicking_power_mph: row.rightFootKickingPowerMph ?? 0,
  };
}

export function readCalibrationMetricsFromBenchmark(
  benchmarkMetadata: unknown
): LegacyMatchMetricsDto | null {
  if (!benchmarkMetadata || typeof benchmarkMetadata !== "object") return null;
  const calibrationMetrics = (benchmarkMetadata as Record<string, unknown>)
    .calibrationMetrics;
  if (!calibrationMetrics || typeof calibrationMetrics !== "object") return null;
  return calibrationMetrics as LegacyMatchMetricsDto;
}

/** Merge explicit CSV percentages into rolling raw averages for profile presentation. */
export function mergeCalibrationExtrasIntoRaw(
  raw: RawMatchMetrics,
  derived: Record<string, unknown>,
  legacy?: LegacyMatchMetricsDto | null
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  const totalPossessions = raw.oneTouchPossessions + raw.multiTouchPossessions;
  if (legacy?.one_touch_possessions_percentage != null) {
    out.one_touch_possessions_percentage = legacy.one_touch_possessions_percentage;
  } else if (totalPossessions > 0) {
    out.one_touch_possessions_percentage =
      (raw.oneTouchPossessions / totalPossessions) * 100;
  }

  if (legacy?.multi_touch_possessions__percentage != null) {
    out.multi_touch_possessions_percentage = legacy.multi_touch_possessions__percentage;
  } else if (totalPossessions > 0) {
    out.multi_touch_possessions_percentage =
      (raw.multiTouchPossessions / totalPossessions) * 100;
  }

  if (legacy?.possession_duration_seconds != null && legacy.possession_duration_seconds > 0) {
    out.possession_duration_seconds = legacy.possession_duration_seconds;
  } else if (raw.possessionDurationSeconds > 0) {
    out.possession_duration_seconds = raw.possessionDurationSeconds;
  }

  if (legacy?.quick_release_score != null) {
    out.quick_release_score = legacy.quick_release_score;
  } else if (
    typeof derived.quickReleaseScore === "number" &&
    derived.quickReleaseScore > 0
  ) {
    out.quick_release_score = derived.quickReleaseScore;
  } else if (typeof out.one_touch_possessions_percentage === "number") {
    out.quick_release_score = out.one_touch_possessions_percentage;
  }

  if (legacy?.left_foot_release_percentage != null) {
    out.left_foot_release_percentage = legacy.left_foot_release_percentage;
  } else if (raw.leftFootReleaseCount + raw.rightFootReleaseCount > 0) {
    out.left_foot_release_percentage =
      (raw.leftFootReleaseCount / (raw.leftFootReleaseCount + raw.rightFootReleaseCount)) *
      100;
  }

  if (legacy?.right_foot_release_percentage != null) {
    out.right_foot_release_percentage = legacy.right_foot_release_percentage;
  } else if (raw.leftFootReleaseCount + raw.rightFootReleaseCount > 0) {
    out.right_foot_release_percentage =
      (raw.rightFootReleaseCount / (raw.leftFootReleaseCount + raw.rightFootReleaseCount)) *
      100;
  }

  if (legacy?.turn_efficiency != null) {
    out.turn_efficiency = legacy.turn_efficiency;
  }

  if (legacy?.release_laces_percentage != null) {
    out.release_laces_percentage = legacy.release_laces_percentage;
  }

  if (legacy?.left_foot_touch_percentage != null) {
    out.left_foot_touch_percentage = legacy.left_foot_touch_percentage;
  }
  if (legacy?.right_foot_touch_percentage != null) {
    out.right_foot_touch_percentage = legacy.right_foot_touch_percentage;
  }

  if (legacy?.left_foot_receive_percentage != null) {
    out.left_foot_receive_percentage = legacy.left_foot_receive_percentage;
  }
  if (legacy?.right_foot_receive_percentage != null) {
    out.right_foot_receive_percentage = legacy.right_foot_receive_percentage;
  }

  return out;
}

/** Subset of legacy CSV fields used to backfill public profile metrics. */
export type CalibrationMetricsFallback = Partial<
  Record<
    | "one_touch_possessions_percentage"
    | "multi_touch_possessions_percentage"
    | "possession_duration_seconds"
    | "quick_release_score"
    | "left_foot_release_percentage"
    | "right_foot_release_percentage"
    | "left_foot_touch_percentage"
    | "right_foot_touch_percentage"
    | "left_foot_receive_percentage"
    | "right_foot_receive_percentage"
    | "release_laces_percentage"
    | "turn_efficiency",
    number
  >
>;

/** Map stored calibration CSV snapshot to snake_case public profile metrics. */
export function legacyMatchMetricsToPresentedMetrics(
  legacy: LegacyMatchMetricsDto
): Record<string, number> {
  const metrics: Record<string, number> = {};
  const assign = (key: string, value: number | undefined) => {
    if (value != null && Number.isFinite(value)) metrics[key] = value;
  };

  assign("first_step_accelerations", legacy.first_step_accelerations);
  assign("intense_accelerations", legacy.intense_accelerations);
  assign("sprints", legacy.sprints);
  assign("intense_turns", legacy.intense_turns);
  assign("intense_turns_with_ball", legacy.intense_turns_with_ball);
  assign("total_distance", legacy.total_distance);
  assign("kicking_power", legacy.kicking_power);
  assign("top_speed", legacy.top_speed);
  assign("top_speed_with_ball", legacy.top_speed_with_ball);
  assign("distance_with_ball", legacy.distance_with_ball);
  assign("sprint_distance", legacy.sprint_distance);
  assign("left_foot_kicking_power_mph", legacy.left_foot_kicking_power_mph);
  assign("right_foot_kicking_power_mph", legacy.right_foot_kicking_power_mph);
  assign("one_touch_possessions_percentage", legacy.one_touch_possessions_percentage);
  assign("multi_touch_possessions_percentage", legacy.multi_touch_possessions__percentage);
  assign("possession_duration_seconds", legacy.possession_duration_seconds);
  assign("release_laces_percentage", legacy.release_laces_percentage);
  assign("quick_release_score", legacy.quick_release_score);
  assign("turn_efficiency", legacy.turn_efficiency);
  assign("left_foot_touch_percentage", legacy.left_foot_touch_percentage);
  assign("right_foot_touch_percentage", legacy.right_foot_touch_percentage);
  assign("left_foot_release_percentage", legacy.left_foot_release_percentage);
  assign("right_foot_release_percentage", legacy.right_foot_release_percentage);
  assign("left_foot_receive_percentage", legacy.left_foot_receive_percentage);
  assign("right_foot_receive_percentage", legacy.right_foot_receive_percentage);

  if (
    metrics.multi_touch_possessions_percentage == null &&
    metrics.one_touch_possessions_percentage != null &&
    metrics.one_touch_possessions_percentage > 0 &&
    metrics.one_touch_possessions_percentage <= 100
  ) {
    metrics.multi_touch_possessions_percentage =
      100 - metrics.one_touch_possessions_percentage;
  }

  if (
    (metrics.quick_release_score == null || metrics.quick_release_score <= 0) &&
    metrics.one_touch_possessions_percentage != null &&
    metrics.one_touch_possessions_percentage > 0
  ) {
    metrics.quick_release_score = metrics.one_touch_possessions_percentage;
  }

  for (const key of [
    "quick_release_score",
    "one_touch_possessions_percentage",
    "left_foot_release_percentage",
    "right_foot_release_percentage",
    "left_foot_touch_percentage",
    "right_foot_touch_percentage",
    "left_foot_receive_percentage",
    "right_foot_receive_percentage",
    "release_laces_percentage",
  ] as const) {
    if (metrics[key] === 0) delete metrics[key];
  }

  return metrics;
}

export function toCalibrationMetricsFallback(
  legacy?: LegacyMatchMetricsDto | null
): CalibrationMetricsFallback | null {
  if (!legacy) return null;
  const fallback: CalibrationMetricsFallback = {};
  const assign = (key: keyof CalibrationMetricsFallback) => {
    const value = legacy[key as keyof LegacyMatchMetricsDto];
    if (typeof value === "number" && Number.isFinite(value)) {
      fallback[key] = value;
    }
  };
  const assignLegacy = (
    fallbackKey: keyof CalibrationMetricsFallback,
    legacyKey: keyof LegacyMatchMetricsDto
  ) => {
    const value = legacy[legacyKey];
    if (typeof value === "number" && Number.isFinite(value)) {
      fallback[fallbackKey] = value;
    }
  };
  assign("one_touch_possessions_percentage");
  assignLegacy("multi_touch_possessions_percentage", "multi_touch_possessions__percentage");
  assign("possession_duration_seconds");
  assign("quick_release_score");
  assign("left_foot_release_percentage");
  assign("right_foot_release_percentage");
  assign("left_foot_touch_percentage");
  assign("right_foot_touch_percentage");
  assign("left_foot_receive_percentage");
  assign("right_foot_receive_percentage");
  assign("release_laces_percentage");
  assign("turn_efficiency");
  return Object.keys(fallback).length > 0 ? fallback : null;
}
