import type { LegacyMatchMetricsDto } from "../admin/dto/calibration-player-info.dto";
import {
  legacyMatchMetricsToPresentedMetrics,
  toCalibrationMetricsFallback,
  type CalibrationMetricsFallback,
} from "../sip/legacy-match-metrics-mapper";

/** Snake_case scouting metrics exposed on public player profiles. */
export type PublicPlayerMetrics = Record<string, number>;

export type { CalibrationMetricsFallback };

const RATING_ATTRIBUTE_MARKER_KEYS = new Set([
  "pace",
  "acceleration",
  "sprint_speed",
  "stamina",
  "strength",
  "agility",
  "dribbling",
  "ball_control",
  "passing",
  "finishing",
  "technique",
  "first_touch",
  "vision",
  "composure",
  "decision_making",
  "work_rate",
  "positioning",
  "team_play",
]);

const SCOUTING_METRIC_MARKER_KEYS = [
  "first_step_accelerations",
  "firstStepAccelerations",
  "intense_accelerations",
  "intenseAccelerations",
  "kicking_power",
  "kickingPowerMph",
  "top_speed",
  "topSpeedMph",
  "top_speed_with_ball",
  "topSpeedWithBallMph",
  "distance_with_ball",
  "distanceWithBallYards",
  "sprint_distance",
  "sprintDistanceYards",
  "sprints",
  "intense_turns",
  "intenseTurns",
  "intense_turns_with_ball",
  "intenseTurnsWithBall",
  "one_touch_possessions",
  "oneTouchPossessions",
  "ball_touches",
  "ballTouches",
  "accelerations",
  "total_distance",
  "totalDistanceMiles",
] as const;

/** FM-style rating attributes stored on legacy imports — not SIP tracking metrics. */
export function isRatingAttributesPayload(
  raw: Record<string, unknown> | null | undefined
): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const keys = Object.keys(raw);
  if (keys.length === 0) return false;
  if (keys.some((key) => SCOUTING_METRIC_MARKER_KEYS.includes(key as (typeof SCOUTING_METRIC_MARKER_KEYS)[number]))) {
    return false;
  }
  return keys.some((key) => RATING_ATTRIBUTE_MARKER_KEYS.has(key));
}

function readNumber(source: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function fillMissingFromLegacyCalibration(
  metrics: PublicPlayerMetrics,
  legacy?: LegacyMatchMetricsDto | null
): void {
  if (!legacy) return;
  for (const [key, value] of Object.entries(legacyMatchMetricsToPresentedMetrics(legacy))) {
    const current = metrics[key];
    if (key === "turn_efficiency") {
      metrics[key] = value;
      continue;
    }
    if (key === "possession_duration_seconds") {
      if (current == null || current < 1) metrics[key] = value;
      continue;
    }
    if (current == null || current <= 0) {
      metrics[key] = value;
    }
  }
}

function applyCalibrationFallback(
  metrics: PublicPlayerMetrics,
  fallback?: CalibrationMetricsFallback | null
): void {
  if (!fallback) return;
  const assign = (key: keyof CalibrationMetricsFallback) => {
    const fallbackValue = fallback[key];
    if (fallbackValue == null || fallbackValue <= 0) return;
    const current = metrics[key];
    if (key === "turn_efficiency") {
      metrics[key] = fallbackValue;
      return;
    }
    if (key === "possession_duration_seconds") {
      if (current == null || current < 1) {
        metrics[key] = fallbackValue;
      }
      return;
    }
    if (current == null || current <= 0) {
      metrics[key] = fallbackValue;
    }
  };
  assign("one_touch_possessions_percentage");
  assign("multi_touch_possessions_percentage");
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
}

/** True when tracking metrics exist but key calibration CSV fields are still missing. */
export function isCalibrationMetricsIncomplete(
  metrics: PublicPlayerMetrics | null
): boolean {
  if (!metrics) return true;
  const hasTracking =
    metrics.kicking_power != null ||
    metrics.top_speed != null ||
    metrics.intense_turns_with_ball != null ||
    metrics.turn_efficiency != null;
  if (!hasTracking) return false;

  const missingPossession =
    (metrics.quick_release_score ?? 0) <= 0 &&
    (metrics.one_touch_possessions_percentage ?? 0) <= 0;
  const missingFootRelease =
    (metrics.left_foot_release_percentage ?? 0) <= 0 &&
    (metrics.right_foot_release_percentage ?? 0) <= 0;

  return missingPossession || missingFootRelease;
}

export function presentPlayerMetrics(
  raw: Record<string, unknown> | null | undefined,
  derived: Record<string, unknown> | null | undefined,
  calibrationLegacy?: LegacyMatchMetricsDto | null
): PublicPlayerMetrics | null {
  const calibrationFallback = toCalibrationMetricsFallback(calibrationLegacy);
  const rawSource =
    raw && typeof raw === "object" && !Array.isArray(raw) && !isRatingAttributesPayload(raw)
      ? raw
      : {};

  const metrics: PublicPlayerMetrics = {};
  const assign = (snakeKey: string, ...sourceKeys: string[]) => {
    const value = readNumber(rawSource, ...sourceKeys);
    if (value != null) metrics[snakeKey] = value;
  };

  assign("first_step_accelerations", "first_step_accelerations", "firstStepAccelerations");
  assign("intense_accelerations", "intense_accelerations", "intenseAccelerations");
  assign("sprints", "sprints");
  assign("intense_turns", "intense_turns", "intenseTurns");
  assign("intense_turns_with_ball", "intense_turns_with_ball", "intenseTurnsWithBall");
  assign("total_distance", "total_distance", "totalDistanceMiles");
  assign("kicking_power", "kicking_power", "kickingPowerMph");
  assign("top_speed", "top_speed", "topSpeedMph");
  assign("top_speed_with_ball", "top_speed_with_ball", "topSpeedWithBallMph");
  assign("distance_with_ball", "distance_with_ball", "distanceWithBallYards");
  assign("sprint_distance", "sprint_distance", "sprintDistanceYards");
  assign("left_foot_kicking_power_mph", "left_foot_kicking_power_mph", "leftFootKickingPowerMph");
  assign("right_foot_kicking_power_mph", "right_foot_kicking_power_mph", "rightFootKickingPowerMph");
  assign("one_touch_possessions_percentage");
  assign(
    "multi_touch_possessions_percentage",
    "multi_touch_possessions__percentage",
    "multi_touch_possessions_percentage"
  );
  assign("possession_duration_seconds", "possession_duration_seconds", "possessionDurationSeconds");
  assign("release_laces_percentage", "release_laces_percentage");
  assign("quick_release_score", "quick_release_score", "quickReleaseScore");
  assign("turn_efficiency", "turn_efficiency");
  assign("left_foot_touch_percentage", "left_foot_touch_percentage");
  assign("right_foot_touch_percentage", "right_foot_touch_percentage");
  assign("left_foot_release_percentage", "left_foot_release_percentage");
  assign("right_foot_release_percentage", "right_foot_release_percentage");
  assign("left_foot_receive_percentage", "left_foot_receive_percentage");
  assign("right_foot_receive_percentage", "right_foot_receive_percentage");

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

  const legacyAccelerations = readNumber(rawSource, "accelerations");
  if (metrics.first_step_accelerations == null && legacyAccelerations != null) {
    metrics.first_step_accelerations = legacyAccelerations;
  }

  const oneTouch = readNumber(rawSource, "oneTouchPossessions", "one_touch_possessions");
  const multiTouch = readNumber(rawSource, "multiTouchPossessions", "multi_touch_possessions");
  if (
    metrics.one_touch_possessions_percentage == null &&
    oneTouch != null &&
    multiTouch != null &&
    oneTouch + multiTouch > 0
  ) {
    metrics.one_touch_possessions_percentage =
      (oneTouch / (oneTouch + multiTouch)) * 100;
  }

  if (
    metrics.multi_touch_possessions_percentage == null &&
    oneTouch != null &&
    multiTouch != null &&
    oneTouch + multiTouch > 0
  ) {
    metrics.multi_touch_possessions_percentage =
      (multiTouch / (oneTouch + multiTouch)) * 100;
  }

  const releaseLaces = readNumber(rawSource, "releaseLacesCount", "release_laces_count");
  const releaseInside = readNumber(rawSource, "releaseInsideFootCount", "release_inside_foot_count");
  const releaseOther = readNumber(rawSource, "releaseOtherFootzoneCount", "release_other_footzone_count");
  if (
    metrics.release_laces_percentage == null &&
    releaseLaces != null &&
    releaseInside != null &&
    releaseOther != null
  ) {
    const total = releaseLaces + releaseInside + releaseOther;
    if (total > 0) metrics.release_laces_percentage = (releaseLaces / total) * 100;
  }

  const leftTouch = readNumber(rawSource, "leftFootTouchCount", "left_foot_touch_count");
  const rightTouch = readNumber(rawSource, "rightFootTouchCount", "right_foot_touch_count");
  if (leftTouch != null && rightTouch != null && leftTouch + rightTouch > 0) {
    if (metrics.left_foot_touch_percentage == null) {
      metrics.left_foot_touch_percentage = (leftTouch / (leftTouch + rightTouch)) * 100;
    }
    if (metrics.right_foot_touch_percentage == null) {
      metrics.right_foot_touch_percentage = (rightTouch / (leftTouch + rightTouch)) * 100;
    }
  }

  const leftRelease = readNumber(rawSource, "leftFootReleaseCount", "left_foot_release_count");
  const rightRelease = readNumber(rawSource, "rightFootReleaseCount", "right_foot_release_count");
  if (leftRelease != null && rightRelease != null && leftRelease + rightRelease > 0) {
    if (metrics.left_foot_release_percentage == null) {
      metrics.left_foot_release_percentage =
        (leftRelease / (leftRelease + rightRelease)) * 100;
    }
    if (metrics.right_foot_release_percentage == null) {
      metrics.right_foot_release_percentage =
        (rightRelease / (leftRelease + rightRelease)) * 100;
    }
  }

  const leftReceive = readNumber(rawSource, "leftFootReceiveCount", "left_foot_receive_count");
  const rightReceive = readNumber(rawSource, "rightFootReceiveCount", "right_foot_receive_count");
  if (leftReceive != null && rightReceive != null && leftReceive + rightReceive > 0) {
    if (metrics.left_foot_receive_percentage == null) {
      metrics.left_foot_receive_percentage =
        (leftReceive / (leftReceive + rightReceive)) * 100;
    }
    if (metrics.right_foot_receive_percentage == null) {
      metrics.right_foot_receive_percentage =
        (rightReceive / (leftReceive + rightReceive)) * 100;
    }
  }

  if (metrics.turn_efficiency == null && derived && typeof derived === "object") {
    const derivedTurn = readNumber(derived as Record<string, unknown>, "turnEfficiency", "turn_efficiency");
    if (derivedTurn != null && derivedTurn > 0) {
      metrics.turn_efficiency = derivedTurn;
    } else {
      const entry = readNumber(rawSource, "avg_turn_entry", "avgTurnEntrySpeedMph");
      const exit = readNumber(rawSource, "avg_turn_exit", "avgTurnExitSpeedMph");
      if (entry != null && exit != null && entry > 0) {
        metrics.turn_efficiency = exit / entry;
      }
    }
  }

  if (metrics.quick_release_score == null && derived && typeof derived === "object") {
    const derivedQuick = readNumber(
      derived as Record<string, unknown>,
      "quickReleaseScore",
      "quick_release_score"
    );
    if (derivedQuick != null && derivedQuick > 0) {
      metrics.quick_release_score = derivedQuick;
    }
  }

  if (
    (metrics.quick_release_score == null || metrics.quick_release_score <= 0) &&
    metrics.one_touch_possessions_percentage != null &&
    metrics.one_touch_possessions_percentage > 0
  ) {
    metrics.quick_release_score = metrics.one_touch_possessions_percentage;
  }

  fillMissingFromLegacyCalibration(metrics, calibrationLegacy);
  applyCalibrationFallback(metrics, calibrationFallback);

  if (
    metrics.multi_touch_possessions_percentage == null &&
    metrics.one_touch_possessions_percentage != null &&
    metrics.one_touch_possessions_percentage > 0 &&
    metrics.one_touch_possessions_percentage <= 100
  ) {
    metrics.multi_touch_possessions_percentage =
      100 - metrics.one_touch_possessions_percentage;
  }

  if (derived && typeof derived === "object") {
    const derivedRecord = derived as Record<string, unknown>;
    const derivedLeftTouch = readNumber(derivedRecord, "leftFootTouchPct", "left_foot_touch_pct");
    const derivedRightTouch = readNumber(derivedRecord, "rightFootTouchPct", "right_foot_touch_pct");
    if (metrics.left_foot_touch_percentage == null && derivedLeftTouch != null) {
      metrics.left_foot_touch_percentage = derivedLeftTouch;
    }
    if (metrics.right_foot_touch_percentage == null && derivedRightTouch != null) {
      metrics.right_foot_touch_percentage = derivedRightTouch;
    }
  }

  return Object.keys(metrics).length > 0 ? metrics : null;
}
