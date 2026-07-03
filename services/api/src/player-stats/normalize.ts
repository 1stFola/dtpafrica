import {
  CSV_HEADERS,
  ExtractedPlayerStats,
  FinalPlayerStatsCsvRow,
  MaybeNumber,
} from "./types";

const M_TO_YD = 1.0936133;
const KM_TO_MI = 0.621371;
const KPH_TO_MPH = 0.621371;

function n(value: MaybeNumber | undefined): MaybeNumber {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: MaybeNumber, decimals = 2): MaybeNumber {
  if (value === null) return null;
  const p = 10 ** decimals;
  return Math.round(value * p) / p;
}

function safeDiv(a: MaybeNumber, b: MaybeNumber): MaybeNumber {
  if (a === null || b === null || b === 0) return null;
  return a / b;
}

function pct(part: MaybeNumber, total: MaybeNumber): MaybeNumber {
  const d = safeDiv(part, total);
  return d === null ? null : d * 100;
}

function lowerUnit(unit?: string | null): string {
  return String(unit || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function toMiles(value: MaybeNumber, unit?: string | null): MaybeNumber {
  if (value === null) return null;
  const u = lowerUnit(unit);
  if (u === "km" || u === "kilometer" || u === "kilometers") return value * KM_TO_MI;
  if (u === "m" || u === "meter" || u === "meters") return value / 1609.344;
  return value;
}

export function toYards(value: MaybeNumber, unit?: string | null): MaybeNumber {
  if (value === null) return null;
  const u = lowerUnit(unit);
  if (u === "m" || u === "meter" || u === "meters") return value * M_TO_YD;
  if (u === "km" || u === "kilometer" || u === "kilometers") return value * 1093.6133;
  return value;
}

export function toMph(value: MaybeNumber, unit?: string | null): MaybeNumber {
  if (value === null) return null;
  const u = lowerUnit(unit);
  if (u === "kph" || u === "km/h" || u === "kmh") return value * KPH_TO_MPH;
  return value;
}

function v(raw: { value: MaybeNumber; unit?: string | null } | undefined): MaybeNumber {
  return n(raw?.value);
}

function unit(raw: { unit?: string | null } | undefined): string | null | undefined {
  return raw?.unit;
}

function scale(value: MaybeNumber, factor: number): MaybeNumber {
  return value === null ? null : value * factor;
}

export function normalizePlayerStats(extracted: ExtractedPlayerStats, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Duration must be greater than 0.");
  }

  const factor = 90 / duration;
  const ballPossessionsRaw = v(extracted.ball_possessions);
  const totalDistanceMilesRaw = toMiles(
    v(extracted.total_distance),
    unit(extracted.total_distance)
  );
  const sprintDistanceYardsRaw = toYards(
    v(extracted.sprint_distance),
    unit(extracted.sprint_distance)
  );
  const topSpeedMph = toMph(v(extracted.top_speed), unit(extracted.top_speed));
  const kickingPowerMph = toMph(
    v(extracted.kicking_power),
    unit(extracted.kicking_power)
  );
  const avgEntryMph = toMph(
    v(extracted.avg_turn_entry_speed),
    unit(extracted.avg_turn_entry_speed)
  );
  const avgExitMph = toMph(
    v(extracted.avg_turn_exit_speed),
    unit(extracted.avg_turn_exit_speed)
  );
  const distanceWithBallYards = toYards(
    v(extracted.distance_with_ball),
    unit(extracted.distance_with_ball)
  );
  const topSpeedWithBallMph = toMph(
    v(extracted.top_speed_with_ball),
    unit(extracted.top_speed_with_ball)
  );

  const one = v(extracted.one_touch_possessions_count);
  const multi = v(extracted.multi_touch_possessions_count);
  const totalBallPossessions =
    v(extracted.total_ball_possessions) ??
    (one !== null && multi !== null ? one + multi : null);
  const oneMultiTotal = one !== null && multi !== null ? one + multi : null;

  const laces = v(extracted.release_laces_count);
  const inside = v(extracted.release_inside_foot_count);
  const other = v(extracted.release_other_footzone_count);
  const releaseTotal =
    laces !== null && inside !== null && other !== null
      ? laces + inside + other
      : null;
  const ballTouches = scale(ballPossessionsRaw, factor);
  const quickReleaseDenominator =
    one !== null &&
    multi !== null &&
    totalBallPossessions !== null &&
    (one <= multi || totalBallPossessions <= 15)
      ? totalBallPossessions
      : ballTouches;

  const row: FinalPlayerStatsCsvRow = {
    duration,
    ball_touches: round(ballTouches),
    total_distance: round(totalDistanceMilesRaw),
    sprint_distance: round(sprintDistanceYardsRaw),
    first_step_accelerations: round(scale(v(extracted.first_step_accelerations), factor)),
    intense_accelerations: round(scale(v(extracted.intense_accelerations), factor)),
    top_speed: round(topSpeedMph),
    sprints: round(scale(v(extracted.sprints), factor)),
    intense_turns: round(scale(v(extracted.intense_turns), factor)),
    avg_turn_entry: round(avgEntryMph),
    avg_turn_exit: round(avgExitMph),
    left_turns: round(scale(v(extracted.left_turns), factor)),
    right_turns: round(scale(v(extracted.right_turns), factor)),
    back_turns: round(scale(v(extracted.back_turns), factor)),
    kicking_power: round(kickingPowerMph),
    distance_with_ball: round(distanceWithBallYards),
    top_speed_with_ball: round(topSpeedWithBallMph),
    intense_turns_with_ball: round(v(extracted.intense_turns_with_ball)),
    one_touch_possessions_percentage: round(pct(one, oneMultiTotal)),
    multi_touch_possessions__percentage: round(pct(multi, oneMultiTotal)),
    possession_duration_seconds: round(v(extracted.possession_duration_seconds)),
    release_inside_foot_percentage: round(pct(inside, releaseTotal)),
    release_laces_percentage: round(pct(laces, releaseTotal)),
    release_other_footzone_percentage: round(pct(other, releaseTotal)),
    turn_efficiency: round(safeDiv(avgExitMph, avgEntryMph), 4),
    quick_release_score: round(pct(one, quickReleaseDenominator)),
    left_foot_touch_percentage: round(v(extracted.left_foot_touch_percentage)),
    right_foot_touch_percentage: round(v(extracted.right_foot_touch_percentage)),
    left_foot_release_percentage: round(v(extracted.left_foot_release_percentage)),
    right_foot_release_percentage: round(v(extracted.right_foot_release_percentage)),
    left_foot_receive_percentage: round(v(extracted.left_foot_receive_percentage)),
    right_foot_receive_percentage: round(v(extracted.right_foot_receive_percentage)),
    left_foot_kicking_power_mph: round(
      toMph(v(extracted.left_foot_kicking_power), unit(extracted.left_foot_kicking_power))
    ),
    right_foot_kicking_power_mph: round(
      toMph(v(extracted.right_foot_kicking_power), unit(extracted.right_foot_kicking_power))
    ),
  };

  const warnings = [...(extracted.warnings || [])];
  for (const header of CSV_HEADERS) {
    if (row[header] === null || row[header] === undefined || row[header] === "") {
      warnings.push(`${header} is missing or could not be calculated.`);
    }
  }

  return {
    row,
    warnings: Array.from(new Set(warnings)),
  };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(row: FinalPlayerStatsCsvRow): string {
  return [
    CSV_HEADERS.join(","),
    CSV_HEADERS.map((h) => csvEscape(row[h])).join(","),
  ].join("\n");
}
