import type { PublicPlayerProfile } from "../../../api/client";

export type PositionMetricGroup =
  | "goalkeeper"
  | "striker"
  | "winger"
  | "cm_am"
  | "fullback"
  | "center_back";

export type ScoutingMetricKey =
  | "work_rate"
  | "first_step_accelerations"
  | "foot_kicking_power_mph"
  | "one_touch_possessions_percentage"
  | "top_speed_with_ball"
  | "release_laces_percentage"
  | "kicking_power"
  | "distance_with_ball"
  | "sprints"
  | "foot_touch_percentage"
  | "turn_efficiency"
  | "quick_release_score"
  | "multi_touch_possessions_percentage"
  | "possession_duration_seconds"
  | "intense_turns_with_ball"
  | "foot_release_percentage"
  | "sprint_distance"
  | "intense_accelerations"
  | "top_speed"
  | "foot_receive_percentage"
  | "intense_turns";

export type PositionScoutingMetric = {
  key: ScoutingMetricKey;
  label: string;
  value: string;
  displayValue: string;
  unit?: string;
  description?: string;
  rawValue: number | null;
  barPercent: number;
  barStyle: MetricBarStyle;
  tierClass: string;
};

type MetricFormat = "count" | "mph" | "yards" | "miles" | "percent" | "ratio" | "duration";
type MetricBarStyle = "none" | "subtle" | "tier";

type MetricDefinition = {
  label: string;
  description: string;
  format: MetricFormat;
};

const METRIC_DEFINITIONS: Record<ScoutingMetricKey, MetricDefinition> = {
  work_rate: {
    label: "Work rate",
    description:
      "Composite intensity index (0–100): position-weighted blend of sprints, intense accelerations, sprint distance, and total distance.",
    format: "percent",
  },
  first_step_accelerations: {
    label: "First-step accelerations",
    description: "Explosive first-step acceleration events recorded in tracking.",
    format: "count",
  },
  foot_kicking_power_mph: {
    label: "Foot kicking power",
    description: "Average maximum kicking power across left and right foot (mph).",
    format: "mph",
  },
  one_touch_possessions_percentage: {
    label: "One-touch possessions",
    description: "Share of possessions completed in a single touch.",
    format: "percent",
  },
  top_speed_with_ball: {
    label: "Top speed with ball",
    description: "Peak speed while in possession, measured in mph.",
    format: "mph",
  },
  release_laces_percentage: {
    label: "Laces release",
    description: "Share of releases struck with the laces.",
    format: "percent",
  },
  kicking_power: {
    label: "Shot Power",
    description: "Maximum shot kicking power, measured in mph.",
    format: "mph",
  },
  distance_with_ball: {
    label: "Distance with ball",
    description: "Total distance covered while in possession (yards).",
    format: "yards",
  },
  sprints: {
    label: "Sprints",
    description: "Number of sprint efforts recorded in tracking.",
    format: "count",
  },
  foot_touch_percentage: {
    label: "Foot touch balance",
    description:
      "How evenly the player uses left vs. right foot on touches (100% = perfectly balanced).",
    format: "percent",
  },
  turn_efficiency: {
    label: "Turn efficiency",
    description: "Average turn exit speed divided by average turn entry speed.",
    format: "ratio",
  },
  quick_release_score: {
    label: "Quick release score",
    description: "Share of possessions completed in one touch.",
    format: "percent",
  },
  multi_touch_possessions_percentage: {
    label: "Multi-touch possessions",
    description: "Share of possessions involving more than one touch.",
    format: "percent",
  },
  possession_duration_seconds: {
    label: "Possession duration",
    description: "Average time spent in possession per event.",
    format: "duration",
  },
  intense_turns_with_ball: {
    label: "Intense turns with ball",
    description: "High-intensity turns executed while in possession.",
    format: "count",
  },
  foot_release_percentage: {
    label: "Foot release balance",
    description:
      "How evenly the player releases with left vs. right foot (100% = perfectly balanced).",
    format: "percent",
  },
  sprint_distance: {
    label: "Sprint distance",
    description: "Total distance covered at sprint intensity (yards).",
    format: "yards",
  },
  intense_accelerations: {
    label: "Intense accelerations",
    description: "High-intensity acceleration bursts recorded in tracking.",
    format: "count",
  },
  top_speed: {
    label: "Top speed",
    description: "Peak speed without the ball, measured in mph.",
    format: "mph",
  },
  foot_receive_percentage: {
    label: "Foot receive balance",
    description:
      "How evenly the player receives with left vs. right foot (100% = perfectly balanced).",
    format: "percent",
  },
  intense_turns: {
    label: "Intense turns",
    description: "High-intensity turns without the ball.",
    format: "count",
  },
};

const POSITION_METRIC_KEYS: Record<PositionMetricGroup, readonly ScoutingMetricKey[]> = {
  goalkeeper: [
    "work_rate",
    "kicking_power",
    "foot_kicking_power_mph",
    "foot_release_percentage",
    "foot_receive_percentage",
    "quick_release_score",
  ],
  striker: [
    "work_rate",
    "top_speed",
    "one_touch_possessions_percentage",
    "top_speed_with_ball",
    "release_laces_percentage",
    "kicking_power",
  ],
  winger: [
    "top_speed_with_ball",
    "distance_with_ball",
    "work_rate",
    "sprint_distance",
    "foot_touch_percentage",
    "kicking_power",
  ],
  cm_am: [
    "turn_efficiency",
    "quick_release_score",
    "multi_touch_possessions_percentage",
    "possession_duration_seconds",
    "foot_release_percentage",
    "kicking_power",
  ],
  fullback: [
    "sprint_distance",
    "work_rate",
    "top_speed",
    "distance_with_ball",
    "foot_receive_percentage",
    "kicking_power",
  ],
  center_back: [
    "work_rate",
    "top_speed",
    "intense_turns",
    "foot_release_percentage",
    "foot_kicking_power_mph",
    "kicking_power",
  ],
};

const GOALKEEPER_TOKENS = ["GK", "GOALKEEPER", "GOAL KEEPER", "KEEPER"];

const STRIKER_TOKENS = [
  "ST",
  "CF",
  "SS",
  "FW",
  "STRIKER",
  "CENTER FORWARD",
  "CENTRE FORWARD",
];
const FULLBACK_TOKENS = [
  "RB",
  "LB",
  "RWB",
  "LWB",
  "FB",
  "FULLBACK",
  "FULL BACK",
  "LEFT BACK",
  "RIGHT BACK",
  "LEFT WING BACK",
  "RIGHT WING BACK",
];
const WINGER_TOKENS = [
  "LW",
  "RW",
  "LM",
  "RM",
  "WING",
  "LEFT WING",
  "RIGHT WING",
  "LEFT WINGER",
  "RIGHT WINGER",
  "WINGER",
];
const CENTER_BACK_TOKENS = [
  "CB",
  "DC",
  "DEF",
  "LCB",
  "RCB",
  "CENTRE BACK",
  "CENTER BACK",
  "CENTRAL DEFENDER",
  "CENTRAL BACK",
];
const CM_AM_TOKENS = [
  "CM",
  "AM",
  "CAM",
  "CDM",
  "DM",
  "MID",
  "CENTRAL MID",
  "CENTRE MID",
  "ATTACKING MID",
  "ATTACKING MIDFIELDER",
  "MIDFIELDER",
];

function normalizeHaystack(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesToken(haystack: string, token: string): boolean {
  if (token.length <= 3 && /^[A-Z]+$/.test(token)) {
    return new RegExp(`\\b${token}\\b`).test(haystack);
  }
  return haystack.includes(token);
}

function haystackMatchesAny(haystack: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => matchesToken(haystack, token));
}

/**
 * Resolve outfield metric group from registration position and optional role hint.
 * Fullback is checked before winger so "LEFT WING BACK" does not match wing tokens.
 */
export function resolvePositionGroup(
  positionPrimary?: string | null,
  role?: string | null
): PositionMetricGroup {
  const haystack = normalizeHaystack(positionPrimary, role);
  if (!haystack) return "cm_am";

  if (haystackMatchesAny(haystack, GOALKEEPER_TOKENS)) return "goalkeeper";
  if (haystackMatchesAny(haystack, STRIKER_TOKENS)) return "striker";
  if (haystackMatchesAny(haystack, FULLBACK_TOKENS)) return "fullback";
  if (haystackMatchesAny(haystack, WINGER_TOKENS)) return "winger";
  if (haystackMatchesAny(haystack, CENTER_BACK_TOKENS)) return "center_back";
  if (haystackMatchesAny(haystack, CM_AM_TOKENS)) return "cm_am";

  return "cm_am";
}

/** @deprecated Use `resolvePositionGroup`. */
export const resolvePositionMetricGroup = resolvePositionGroup;

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

const SCOUTING_METRIC_MARKER_KEYS = new Set([
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
]);

function isRatingAttributesPayload(raw: Record<string, unknown> | null | undefined): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const keys = Object.keys(raw);
  if (keys.length === 0) return false;
  if (keys.some((key) => SCOUTING_METRIC_MARKER_KEYS.has(key))) return false;
  return keys.some((key) => RATING_ATTRIBUTE_MARKER_KEYS.has(key));
}

function readNumber(source: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function splitMetricDisplay(
  value: number | null,
  format: MetricFormat
): { displayValue: string; unit?: string } {
  if (value == null) return { displayValue: "—" };

  switch (format) {
    case "mph":
      if (value === 0) return { displayValue: "0", unit: "mph" };
      return { displayValue: value.toFixed(1), unit: "mph" };
    case "yards":
      if (value === 0) return { displayValue: "0", unit: "yd" };
      return { displayValue: Math.round(value).toLocaleString(), unit: "yd" };
    case "miles":
      if (value === 0) return { displayValue: "0", unit: "mi" };
      return { displayValue: value.toFixed(2), unit: "mi" };
    case "percent":
      if (value === 0) return { displayValue: "0", unit: "%" };
      return { displayValue: String(Math.round(value)), unit: "%" };
    case "ratio":
      if (value === 0) return { displayValue: "0" };
      return { displayValue: value.toFixed(2) };
    case "duration": {
      if (value >= 60) {
        const mins = Math.floor(value / 60);
        const secs = Math.round(value % 60);
        if (secs === 0) return { displayValue: String(mins), unit: "min" };
        return { displayValue: `${mins}m ${secs}s` };
      }
      if (value === 0) return { displayValue: "0", unit: "s" };
      return {
        displayValue: value < 10 ? value.toFixed(1) : String(Math.round(value)),
        unit: "s",
      };
    }
    default:
      if (value === 0) return { displayValue: "0" };
      return {
        displayValue: Number.isInteger(value) ? String(value) : value.toFixed(1),
      };
  }
}

function formatMetricValue(value: number | null, format: MetricFormat): string {
  const { displayValue, unit } = splitMetricDisplay(value, format);
  if (!unit) return displayValue;
  return `${displayValue} ${unit}`;
}

type WorkRateComponentKey =
  | "sprints"
  | "intense_accelerations"
  | "sprint_distance"
  | "total_distance";

/**
 * Per-match floors/ceilings from legacy `calibration-engine.js` norm100() bands.
 * Values below min score 0; at max the soft curve reaches ~80 so elite outliers can still separate.
 */
const WORK_RATE_RANGES: Record<WorkRateComponentKey, { min: number; max: number }> = {
  sprints: { min: 0, max: 30 },
  intense_accelerations: { min: 5, max: 45 },
  sprint_distance: { min: 40, max: 320 },
  total_distance: { min: 4.5, max: 7.5 },
};

/** Role-specific emphasis — wide players lean on sprint volume; CBs on total distance. */
const WORK_RATE_WEIGHTS: Record<PositionMetricGroup, Record<WorkRateComponentKey, number>> = {
  striker: {
    sprints: 0.3,
    intense_accelerations: 0.3,
    sprint_distance: 0.25,
    total_distance: 0.15,
  },
  winger: {
    sprints: 0.3,
    intense_accelerations: 0.25,
    sprint_distance: 0.3,
    total_distance: 0.15,
  },
  cm_am: {
    sprints: 0.25,
    intense_accelerations: 0.25,
    sprint_distance: 0.25,
    total_distance: 0.25,
  },
  fullback: {
    sprints: 0.25,
    intense_accelerations: 0.2,
    sprint_distance: 0.3,
    total_distance: 0.25,
  },
  center_back: {
    sprints: 0.2,
    intense_accelerations: 0.25,
    sprint_distance: 0.2,
    total_distance: 0.35,
  },
  goalkeeper: {
    sprints: 0.15,
    intense_accelerations: 0.2,
    sprint_distance: 0.2,
    total_distance: 0.45,
  },
};

/** Soft 0–100 mapping: linear below range midpoint, exponential saturation toward 100 above it. */
function normalizeWorkRateComponent(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0 || max <= min) return 0;
  const ratio = Math.max(0, (value - min) / (max - min));
  return Math.min(100, 100 * (1 - Math.exp(-1.6 * ratio)));
}

/**
 * Work Rate (0–100): position-weighted composite of per-match tracking intensity.
 *
 * Formula:
 *   1. Map each raw input through WORK_RATE_RANGES (calibration CSV bands).
 *   2. Apply soft exponential curve: score = 100 × (1 − e^(−1.6 × ratio)) so typical
 *      calibrated players land ~40–75, elite workers ~75–90, and low movers ~20–40.
 *   3. Blend component scores with WORK_RATE_WEIGHTS for the player's position group.
 *
 * Components: sprints, intense_accelerations, sprint_distance (yd), total_distance (mi).
 */
export function computeWorkRate(
  metrics: Record<string, number>,
  positionGroup: PositionMetricGroup = "cm_am"
): number | null {
  const weights = WORK_RATE_WEIGHTS[positionGroup];
  let weightedSum = 0;
  let weightTotal = 0;

  for (const key of Object.keys(WORK_RATE_RANGES) as WorkRateComponentKey[]) {
    const value = metrics[key];
    const weight = weights[key];
    const { min, max } = WORK_RATE_RANGES[key];
    if (value != null && value > 0 && weight > 0) {
      weightedSum += weight * normalizeWorkRateComponent(value, min, max);
      weightTotal += weight;
    }
  }

  if (weightTotal === 0) return null;
  return Math.round(weightedSum / weightTotal);
}

function buildSnakeCaseMetrics(
  raw: Record<string, unknown> | null | undefined,
  derived: Record<string, unknown> | null | undefined
): Record<string, number> {
  const rawMetrics =
    raw && typeof raw === "object" && !Array.isArray(raw) && !isRatingAttributesPayload(raw)
      ? raw
      : {};
  const derivedMetrics = derived ?? {};
  const metrics: Record<string, number> = {};

  const assign = (snakeKey: string, ...sourceKeys: string[]) => {
    const value = readNumber(rawMetrics, ...sourceKeys);
    if (value != null) metrics[snakeKey] = value;
  };

  assign("first_step_accelerations", "first_step_accelerations", "firstStepAccelerations");
  assign("intense_accelerations", "intense_accelerations", "intenseAccelerations");
  assign("sprints", "sprints");
  assign("intense_turns", "intense_turns", "intenseTurns");
  assign("intense_turns_with_ball", "intense_turns_with_ball", "intenseTurnsWithBall");
  assign("kicking_power", "kicking_power", "kickingPowerMph");
  assign("top_speed", "top_speed", "topSpeedMph");
  assign("top_speed_with_ball", "top_speed_with_ball", "topSpeedWithBallMph");
  assign("distance_with_ball", "distance_with_ball", "distanceWithBallYards");
  assign("sprint_distance", "sprint_distance", "sprintDistanceYards");
  assign("total_distance", "total_distance", "totalDistanceMiles");
  assign("left_foot_kicking_power_mph", "left_foot_kicking_power_mph", "leftFootKickingPowerMph");
  assign("right_foot_kicking_power_mph", "right_foot_kicking_power_mph", "rightFootKickingPowerMph");
  assign("left_foot_touch_percentage", "left_foot_touch_percentage");
  assign("right_foot_touch_percentage", "right_foot_touch_percentage");
  assign("left_foot_release_percentage", "left_foot_release_percentage");
  assign("right_foot_release_percentage", "right_foot_release_percentage");
  assign("left_foot_receive_percentage", "left_foot_receive_percentage");
  assign("right_foot_receive_percentage", "right_foot_receive_percentage");
  assign("one_touch_possessions_percentage", "one_touch_possessions_percentage");
  assign(
    "multi_touch_possessions_percentage",
    "multi_touch_possessions__percentage",
    "multi_touch_possessions_percentage"
  );
  assign("possession_duration_seconds", "possession_duration_seconds", "possessionDurationSeconds");
  assign("release_laces_percentage", "release_laces_percentage");
  assign("quick_release_score", "quick_release_score", "quickReleaseScore");
  assign("turn_efficiency", "turn_efficiency");

  const legacyAccelerations = readNumber(rawMetrics, "accelerations");
  if (metrics.first_step_accelerations == null && legacyAccelerations != null) {
    metrics.first_step_accelerations = legacyAccelerations;
  }

  const oneTouch = readNumber(rawMetrics, "oneTouchPossessions", "one_touch_possessions");
  const multiTouch = readNumber(rawMetrics, "multiTouchPossessions", "multi_touch_possessions");
  const totalPossessions =
    oneTouch != null && multiTouch != null ? oneTouch + multiTouch : null;
  if (
    metrics.one_touch_possessions_percentage == null &&
    oneTouch != null &&
    totalPossessions &&
    totalPossessions > 0
  ) {
    metrics.one_touch_possessions_percentage = (oneTouch / totalPossessions) * 100;
  }

  if (
    metrics.multi_touch_possessions_percentage == null &&
    multiTouch != null &&
    totalPossessions &&
    totalPossessions > 0
  ) {
    metrics.multi_touch_possessions_percentage = (multiTouch / totalPossessions) * 100;
  }

  const releaseLaces = readNumber(rawMetrics, "releaseLacesCount", "release_laces_count");
  const releaseInside = readNumber(rawMetrics, "releaseInsideFootCount", "release_inside_foot_count");
  const releaseOther = readNumber(rawMetrics, "releaseOtherFootzoneCount", "release_other_footzone_count");
  const totalReleases =
    releaseLaces != null && releaseInside != null && releaseOther != null
      ? releaseLaces + releaseInside + releaseOther
      : null;
  if (
    metrics.release_laces_percentage == null &&
    releaseLaces != null &&
    totalReleases &&
    totalReleases > 0
  ) {
    metrics.release_laces_percentage = (releaseLaces / totalReleases) * 100;
  }

  const leftTouch = readNumber(rawMetrics, "leftFootTouchCount", "left_foot_touch_count");
  const rightTouch = readNumber(rawMetrics, "rightFootTouchCount", "right_foot_touch_count");
  const totalTouches =
    leftTouch != null && rightTouch != null ? leftTouch + rightTouch : null;
  if (totalTouches && totalTouches > 0) {
    if (metrics.left_foot_touch_percentage == null && leftTouch != null) {
      metrics.left_foot_touch_percentage = (leftTouch / totalTouches) * 100;
    }
    if (metrics.right_foot_touch_percentage == null && rightTouch != null) {
      metrics.right_foot_touch_percentage = (rightTouch / totalTouches) * 100;
    }
  }

  const leftRelease = readNumber(rawMetrics, "leftFootReleaseCount", "left_foot_release_count");
  const rightRelease = readNumber(rawMetrics, "rightFootReleaseCount", "right_foot_release_count");
  const totalReleaseEvents =
    leftRelease != null && rightRelease != null ? leftRelease + rightRelease : null;
  if (totalReleaseEvents && totalReleaseEvents > 0) {
    if (metrics.left_foot_release_percentage == null && leftRelease != null) {
      metrics.left_foot_release_percentage = (leftRelease / totalReleaseEvents) * 100;
    }
    if (metrics.right_foot_release_percentage == null && rightRelease != null) {
      metrics.right_foot_release_percentage = (rightRelease / totalReleaseEvents) * 100;
    }
  }

  const leftReceive = readNumber(rawMetrics, "leftFootReceiveCount", "left_foot_receive_count");
  const rightReceive = readNumber(rawMetrics, "rightFootReceiveCount", "right_foot_receive_count");
  const totalReceiveEvents =
    leftReceive != null && rightReceive != null ? leftReceive + rightReceive : null;
  if (totalReceiveEvents && totalReceiveEvents > 0) {
    if (metrics.left_foot_receive_percentage == null && leftReceive != null) {
      metrics.left_foot_receive_percentage = (leftReceive / totalReceiveEvents) * 100;
    }
    if (metrics.right_foot_receive_percentage == null && rightReceive != null) {
      metrics.right_foot_receive_percentage = (rightReceive / totalReceiveEvents) * 100;
    }
  }

  if (metrics.turn_efficiency == null) {
    const derivedTurn = readNumber(derivedMetrics, "turnEfficiency", "turn_efficiency");
    if (derivedTurn != null && derivedTurn > 0) {
      metrics.turn_efficiency = derivedTurn;
    } else {
      const entry = readNumber(rawMetrics, "avg_turn_entry", "avgTurnEntrySpeedMph");
      const exit = readNumber(rawMetrics, "avg_turn_exit", "avgTurnExitSpeedMph");
      if (entry != null && exit != null && entry > 0) {
        metrics.turn_efficiency = exit / entry;
      }
    }
  }

  if (metrics.quick_release_score == null) {
    const derivedQuick = readNumber(derivedMetrics, "quickReleaseScore", "quick_release_score");
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

  if (
    metrics.multi_touch_possessions_percentage == null &&
    metrics.one_touch_possessions_percentage != null &&
    metrics.one_touch_possessions_percentage > 0 &&
    metrics.one_touch_possessions_percentage <= 100
  ) {
    metrics.multi_touch_possessions_percentage =
      100 - metrics.one_touch_possessions_percentage;
  }

  const derivedLeftTouch = readNumber(derivedMetrics, "leftFootTouchPct", "left_foot_touch_pct");
  const derivedRightTouch = readNumber(derivedMetrics, "rightFootTouchPct", "right_foot_touch_pct");
  if (metrics.left_foot_touch_percentage == null && derivedLeftTouch != null) {
    metrics.left_foot_touch_percentage = derivedLeftTouch;
  }
  if (metrics.right_foot_touch_percentage == null && derivedRightTouch != null) {
    metrics.right_foot_touch_percentage = derivedRightTouch;
  }

  return metrics;
}

type CalibrationLegacyMetrics = Record<string, number | undefined>;

function readCalibrationMetricsFromBenchmark(
  benchmarkMetadata: PublicPlayerProfile["benchmarkMetadata"]
): CalibrationLegacyMetrics | null {
  if (!benchmarkMetadata || typeof benchmarkMetadata !== "object") return null;
  const calibrationMetrics = (benchmarkMetadata as Record<string, unknown>).calibrationMetrics;
  if (
    !calibrationMetrics ||
    typeof calibrationMetrics !== "object" ||
    Array.isArray(calibrationMetrics)
  ) {
    return null;
  }
  return calibrationMetrics as CalibrationLegacyMetrics;
}

function legacyCalibrationToSnakeCaseMetrics(
  legacy: CalibrationLegacyMetrics
): Record<string, number> {
  const metrics: Record<string, number> = {};
  const assign = (key: string, ...sourceKeys: string[]) => {
    for (const sourceKey of sourceKeys) {
      const value = legacy[sourceKey];
      if (typeof value === "number" && Number.isFinite(value)) {
        metrics[key] = value;
        return;
      }
    }
  };

  assign("first_step_accelerations", "first_step_accelerations");
  assign("intense_accelerations", "intense_accelerations");
  assign("sprints", "sprints");
  assign("intense_turns", "intense_turns");
  assign("intense_turns_with_ball", "intense_turns_with_ball");
  assign("total_distance", "total_distance");
  assign("kicking_power", "kicking_power");
  assign("top_speed", "top_speed");
  assign("top_speed_with_ball", "top_speed_with_ball");
  assign("distance_with_ball", "distance_with_ball");
  assign("sprint_distance", "sprint_distance");
  assign("left_foot_kicking_power_mph", "left_foot_kicking_power_mph");
  assign("right_foot_kicking_power_mph", "right_foot_kicking_power_mph");
  assign("one_touch_possessions_percentage", "one_touch_possessions_percentage");
  assign("multi_touch_possessions_percentage", "multi_touch_possessions__percentage");
  assign("possession_duration_seconds", "possession_duration_seconds");
  assign("release_laces_percentage", "release_laces_percentage");
  assign("quick_release_score", "quick_release_score");
  assign("turn_efficiency", "turn_efficiency");
  assign("left_foot_touch_percentage", "left_foot_touch_percentage");
  assign("right_foot_touch_percentage", "right_foot_touch_percentage");
  assign("left_foot_release_percentage", "left_foot_release_percentage");
  assign("right_foot_release_percentage", "right_foot_release_percentage");
  assign("left_foot_receive_percentage", "left_foot_receive_percentage");
  assign("right_foot_receive_percentage", "right_foot_receive_percentage");

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

  return metrics;
}

function applyCalibrationLegacyFallback(
  metrics: Record<string, number>,
  legacy: CalibrationLegacyMetrics
): void {
  for (const [key, value] of Object.entries(legacyCalibrationToSnakeCaseMetrics(legacy))) {
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

/** Normalize API `player.metrics` or aggregate scouting metrics into snake_case values. */
export function resolvePlayerMetrics(
  player: Pick<
    PublicPlayerProfile,
    "positionPrimary" | "role" | "metrics" | "scoutingIntelligence" | "benchmarkMetadata"
  >
): Record<string, number> {
  const calibrationLegacy = readCalibrationMetricsFromBenchmark(player.benchmarkMetadata);
  const aggregate = player.scoutingIntelligence?.aggregateMetrics;
  const fromAggregate = aggregate
    ? buildSnakeCaseMetrics(
        aggregate.rawAverages as Record<string, unknown>,
        aggregate.derivedMetrics as Record<string, unknown>
      )
    : {};

  const merged =
    !player.metrics || Object.keys(player.metrics).length === 0
      ? { ...fromAggregate }
      : { ...fromAggregate, ...player.metrics };

  if (calibrationLegacy) {
    applyCalibrationLegacyFallback(merged, calibrationLegacy);
  }

  const positionGroup = resolvePositionGroup(player.positionPrimary, player.role);
  const workRate = computeWorkRate(merged, positionGroup);
  if (workRate != null) {
    merged.work_rate = workRate;
  }
  return merged;
}

/** Foot balance score: 100 when left/right usage is even, lower when one foot dominates. */
function readFootBalancePercent(
  metrics: Record<string, number>,
  leftKey: string,
  rightKey: string
): number | null {
  const left = metrics[leftKey];
  const right = metrics[rightKey];
  if (left != null && right != null) {
    return 100 - Math.abs(left - right);
  }
  const known = left ?? right;
  if (known == null) return null;
  return 100 - Math.abs(known - (100 - known));
}

function readCombinedFootMph(metrics: Record<string, number>): number | null {
  const left = metrics.left_foot_kicking_power_mph;
  const right = metrics.right_foot_kicking_power_mph;
  if (left == null && right == null) return null;
  if (left != null && right != null) return (left + right) / 2;
  return left ?? right ?? null;
}

function readMetricValue(
  key: ScoutingMetricKey,
  metrics: Record<string, number>,
  positionGroup: PositionMetricGroup
): number | null {
  switch (key) {
    case "foot_kicking_power_mph":
      return readCombinedFootMph(metrics);
    case "foot_touch_percentage":
      return readFootBalancePercent(
        metrics,
        "left_foot_touch_percentage",
        "right_foot_touch_percentage"
      );
    case "foot_release_percentage":
      return readFootBalancePercent(
        metrics,
        "left_foot_release_percentage",
        "right_foot_release_percentage"
      );
    case "foot_receive_percentage":
      return readFootBalancePercent(
        metrics,
        "left_foot_receive_percentage",
        "right_foot_receive_percentage"
      );
    case "kicking_power":
      return metrics.kicking_power ?? null;
    case "work_rate":
      return metrics.work_rate ?? computeWorkRate(metrics, positionGroup);
    default:
      return metrics[key] ?? null;
  }
}

const WINGER_FOOT_TOUCH_LABEL = "Foot touch balance";

function metricLabel(key: ScoutingMetricKey, group: PositionMetricGroup): string {
  if (group === "winger" && key === "foot_touch_percentage") {
    return WINGER_FOOT_TOUCH_LABEL;
  }
  if (group === "cm_am" && key === "foot_release_percentage") {
    return "Two-footed release";
  }
  return METRIC_DEFINITIONS[key].label;
}

function metricDescription(key: ScoutingMetricKey, group: PositionMetricGroup): string {
  if (group === "winger" && key === "foot_touch_percentage") {
    return METRIC_DEFINITIONS.foot_touch_percentage.description;
  }
  if (group === "cm_am" && key === "foot_release_percentage") {
    return "How evenly the player releases with left vs. right foot — a proxy for two-footed distribution.";
  }
  return METRIC_DEFINITIONS[key].description;
}

const MPH_BAR_CAPS: Partial<Record<ScoutingMetricKey, number>> = {
  kicking_power: 75,
  foot_kicking_power_mph: 70,
  top_speed: 22,
  top_speed_with_ball: 20,
};

/** Exit/entry speed ratio caps for tier bar fill (CSV values ~1.0–1.3). */
const RATIO_BAR_CAPS: Partial<Record<ScoutingMetricKey, number>> = {
  turn_efficiency: 1.5,
};

function shouldGauge(format: MetricFormat): boolean {
  return format === "percent" || format === "ratio";
}

function resolveBarStyle(format: MetricFormat): MetricBarStyle {
  if (shouldGauge(format)) return "tier";
  if (format === "mph") return "subtle";
  return "none";
}

function normalizeMetricBarPercent(
  value: number | null,
  format: MetricFormat,
  key: ScoutingMetricKey
): number {
  if (value == null || value <= 0) return 0;
  if (format === "percent") return Math.max(0, Math.min(100, Math.round(value)));
  if (format === "ratio") {
    const cap = RATIO_BAR_CAPS[key] ?? 1.5;
    return Math.max(0, Math.min(100, Math.round((value / cap) * 100)));
  }
  if (format === "mph") {
    const cap = MPH_BAR_CAPS[key] ?? 75;
    return Math.max(0, Math.min(100, Math.round((value / cap) * 100)));
  }
  return 0;
}

function scoutingMetricTierClass(barPercent: number): string {
  if (barPercent <= 0) return "";
  if (barPercent >= 80) return "position-scouting-metrics__card--elite";
  if (barPercent >= 70) return "position-scouting-metrics__card--strong";
  if (barPercent >= 60) return "position-scouting-metrics__card--developing";
  return "position-scouting-metrics__card--base";
}

export function buildPositionScoutingMetrics(
  player: Pick<
    PublicPlayerProfile,
    "positionPrimary" | "role" | "metrics" | "scoutingIntelligence" | "benchmarkMetadata"
  >
): PositionScoutingMetric[] {
  const group = resolvePositionGroup(player.positionPrimary, player.role);
  const metrics = resolvePlayerMetrics(player);
  const keys = POSITION_METRIC_KEYS[group];

  return keys.map((key) => {
    const definition = METRIC_DEFINITIONS[key];
    const rawValue = readMetricValue(key, metrics, group);
    const barStyle = resolveBarStyle(definition.format);
    const barPercent = normalizeMetricBarPercent(rawValue, definition.format, key);
    const { displayValue, unit } = splitMetricDisplay(rawValue, definition.format);
    return {
      key,
      label: metricLabel(key, group),
      description: metricDescription(key, group),
      value: formatMetricValue(rawValue, definition.format),
      displayValue,
      unit,
      rawValue,
      barPercent,
      barStyle,
      tierClass: barStyle === "tier" ? scoutingMetricTierClass(barPercent) : "",
    };
  });
}
