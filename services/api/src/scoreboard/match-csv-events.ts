/** CSV `event_type` values accepted by match timeline ingest. */
export const CSV_EVENT_TYPES = [
  "added_time",
  "aerial_duel_won",
  "blocked_shot",
  "chance",
  "close_chance",
  "clearance",
  "corner_kick",
  "counter_attack",
  "dangerous_attack",
  "dangerous_cross",
  "dangerous_run",
  "disallowed_goal",
  "dominance",
  "double_save",
  "foul",
  "freekick",
  "game_management",
  "goal",
  "goal_kick",
  "goal_line_clearance",
  "goal_penalty",
  "goal_scorers_update",
  "goalkeeper_claim",
  "goalkeeper_command",
  "goalkeeper_distribution",
  "goalkeeper_error",
  "goalkeeper_intervention",
  "half_time",
  "header_missed",
  "injury",
  "injury_substitution",
  "interception",
  "kick_off",
  "late_defense",
  "long_throw",
  "match_control",
  "match_flow",
  "medical_timeout",
  "midfield_battle",
  "missed_chance",
  "offside",
  "one_on_one",
  "own_goal",
  "penalty_awarded",
  "penalty_saved",
  "poor_delivery",
  "possession",
  "possession_lost",
  "pressure",
  "recovery_tackle",
  "red_card",
  "restart_play",
  "save",
  "score_update",
  "second_half_kickoff",
  "shot_off_target",
  "substitution",
  "sustained_pressure",
  "tactical_substitution",
  "throw_in",
  "volley_missed",
  "water_break",
  "woodwork",
  "yellow_card",
] as const;

export type CsvEventType = (typeof CSV_EVENT_TYPES)[number];

export const CSV_SPECIAL_TYPES = ["full_time", "penalty_shootout"] as const;

export type ParsedCsvEvent = {
  csvType: CsvEventType;
  type: string;
  minute: number;
  teamSide?: "home" | "away";
  playerLabel2?: string;
  playerLabel?: string;
  assistLabel?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
};

export type HomeAwayCount = { home: number; away: number };

export type DerivedMatchStats = {
  possession?: HomeAwayCount;
  saves?: { home: number | null; away: number | null };
  shots?: HomeAwayCount;
  shotsOnTarget?: HomeAwayCount;
  corners?: HomeAwayCount;
  fouls?: HomeAwayCount;
  xg?: HomeAwayCount;
  narrative?: string | null;
};

/** Neutral / systemic flow rows — team_side may be empty or "Unknown". */
export const NEUTRAL_EVENT_TYPES = new Set<CsvEventType>([
  "kick_off",
  "match_flow",
  "half_time",
  "second_half_kickoff",
  "added_time",
  "water_break",
  "medical_timeout",
]);

export const NEUTRAL_SPECIAL_EVENT_TYPES = ["full_time", "penalty_shootout"] as const;

const FLOW_CSV_TYPES = new Set<CsvEventType>([
  ...NEUTRAL_EVENT_TYPES,
  "pressure",
  "score_update",
  "midfield_battle",
  "match_control",
  "goal_scorers_update",
  "dominance",
  "game_management",
  "sustained_pressure",
]);

const TEAM_OPTIONAL_TYPES = new Set<CsvEventType>([
  ...FLOW_CSV_TYPES,
  "possession",
  "throw_in",
  "offside",
  "goal_kick",
  "restart_play",
]);

const PLAYER_OPTIONAL_TYPES = new Set<CsvEventType>([
  ...TEAM_OPTIONAL_TYPES,
  "aerial_duel_won",
  "dangerous_attack",
  "dangerous_cross",
  "dangerous_run",
  "corner_kick",
  "foul",
  "clearance",
  "game_management",
  "goal_kick",
  "goal_line_clearance",
  "goalkeeper_claim",
  "goalkeeper_command",
  "goalkeeper_distribution",
  "goalkeeper_error",
  "goalkeeper_intervention",
  "long_throw",
  "counter_attack",
  "medical_timeout",
  "one_on_one",
  "poor_delivery",
  "possession_lost",
  "recovery_tackle",
  "restart_play",
  "sustained_pressure",
]);

const SHOT_CSV_TYPES = new Set<CsvEventType>([
  "goal",
  "own_goal",
  "goal_penalty",
  "chance",
  "close_chance",
  "shot_off_target",
  "header_missed",
  "blocked_shot",
  "woodwork",
  "missed_chance",
  "disallowed_goal",
  "volley_missed",
  "one_on_one",
]);

const SOT_CSV_TYPES = new Set<CsvEventType>([
  "goal",
  "own_goal",
  "goal_penalty",
  "close_chance",
  "blocked_shot",
  "woodwork",
  "missed_chance",
  "one_on_one",
]);

const SAVE_CSV_TYPES = new Set<CsvEventType>([
  "save",
  "double_save",
  "penalty_saved",
  "goalkeeper_intervention",
]);

/** Only these event types contribute a possession tick (team_side column). */
export const POSSESSION_EVENT_TYPES = new Set<CsvEventType>([
  "possession",
  "pressure",
  "counter_attack",
  "dangerous_attack",
  "dangerous_cross",
  "dangerous_run",
  "dominance",
  "game_management",
  "midfield_battle",
  "match_control",
  "sustained_pressure",
  "chance",
  "close_chance",
  "one_on_one",
  "missed_chance",
  "header_missed",
  "volley_missed",
  "shot_off_target",
  "blocked_shot",
  "save",
  "double_save",
  "goalkeeper_claim",
  "goalkeeper_command",
  "goalkeeper_distribution",
  "goalkeeper_intervention",
  "goal_line_clearance",
  "woodwork",
  "clearance",
  "interception",
  "aerial_duel_won",
  "recovery_tackle",
  "possession_lost",
  "throw_in",
  "long_throw",
  "corner_kick",
  "freekick",
  "goal_kick",
  "kick_off",
  "second_half_kickoff",
]);

/** Documented exclusions — not counted toward possession %. */
export const POSSESSION_EXCLUDE_EVENT_TYPES = new Set<CsvEventType>([
  "match_flow",
  "added_time",
  "half_time",
  "water_break",
  "medical_timeout",
  "injury",
  "substitution",
  "injury_substitution",
  "tactical_substitution",
  "restart_play",
  "score_update",
  "goal_scorers_update",
  "foul",
  "offside",
  "yellow_card",
  "red_card",
  "penalty_awarded",
  "own_goal",
  "disallowed_goal",
  "goal_penalty",
  "penalty_saved",
  "late_defense",
]);

const XG_WEIGHT: Partial<Record<CsvEventType, number>> = {
  goal: 1,
  goal_penalty: 0.76,
  own_goal: 1,
  close_chance: 0.35,
  chance: 0.15,
  shot_off_target: 0.05,
  header_missed: 0.08,
  volley_missed: 0.08,
  blocked_shot: 0.1,
  save: 0.25,
  double_save: 0.25,
  goalkeeper_intervention: 0.15,
  penalty_saved: 0.76,
  woodwork: 0.2,
  missed_chance: 0.12,
  one_on_one: 0.45,
  disallowed_goal: 0.85,
};

export function isFlowCsvType(csvType: string): boolean {
  return FLOW_CSV_TYPES.has(csvType as CsvEventType);
}

export function isNeutralCsvEventType(eventType: string): boolean {
  return (
    NEUTRAL_EVENT_TYPES.has(eventType as CsvEventType) ||
    (NEUTRAL_SPECIAL_EVENT_TYPES as readonly string[]).includes(eventType)
  );
}

export function isPenaltyShootoutEventType(eventType: string): boolean {
  return eventType === "penalty_shootout" || eventType.startsWith("penalty_shootout_");
}

export function csvTypeRequiresTeam(csvType: CsvEventType): boolean {
  if (NEUTRAL_EVENT_TYPES.has(csvType)) return false;
  return !TEAM_OPTIONAL_TYPES.has(csvType);
}

export function csvTypeRequiresPlayer(csvType: CsvEventType): boolean {
  return !PLAYER_OPTIONAL_TYPES.has(csvType);
}

export function mapCsvEventToStorage(ev: {
  csvType: CsvEventType;
  teamSide?: "home" | "away";
  playerLabel?: string;
  assistLabel?: string;
  detail?: string;
}): Pick<ParsedCsvEvent, "type" | "detail" | "metadata"> {
  const baseMeta: Record<string, unknown> = {
    csvEventType: ev.csvType,
    source: "csv-ingest",
  };

  if (isFlowCsvType(ev.csvType)) {
    return {
      type: "match_flow",
      detail: ev.detail || flowDefaultDetail(ev.csvType),
      metadata: { ...baseMeta, flowKind: ev.csvType },
    };
  }

  if (ev.csvType === "goal_penalty") {
    return {
      type: "goal",
      detail: ev.detail || "penalty",
      metadata: baseMeta,
    };
  }

  return {
    type: ev.csvType,
    detail: ev.detail,
    metadata: baseMeta,
  };
}

function flowDefaultDetail(csvType: CsvEventType): string | undefined {
  switch (csvType) {
    case "kick_off":
      return "Kick-off";
    case "half_time":
      return "Half-time";
    case "second_half_kickoff":
      return "Second half kick-off";
    case "added_time":
      return "Added time";
    case "pressure":
      return "Pressure";
    case "water_break":
      return "Water break";
    case "medical_timeout":
      return "Medical timeout";
    case "midfield_battle":
      return "Midfield battle";
    case "match_control":
      return "Match control";
    case "goal_scorers_update":
      return "Goal scorers update";
    case "dominance":
      return "Dominance";
    case "game_management":
      return "Game management";
    case "sustained_pressure":
      return "Sustained pressure";
    case "score_update":
      return undefined;
    default:
      return undefined;
  }
}

function bump(counts: HomeAwayCount, side: "home" | "away", n = 1) {
  counts[side] += n;
}

function oppositeSide(side: "home" | "away"): "home" | "away" {
  return side === "home" ? "away" : "home";
}

/** Which side receives a possession tick for this event, or null to skip. */
function possessionTickSide(
  csvType: CsvEventType,
  side: "home" | "away"
): "home" | "away" | null {
  if (!POSSESSION_EVENT_TYPES.has(csvType)) return null;
  return side;
}

function capPossessionPct(homePct: number): HomeAwayCount {
  const home = Math.min(75, Math.max(25, homePct));
  return { home, away: 100 - home };
}

/**
 * Possession % is derived from CSV `team_side` (column C) for whitelisted event types only
 * (`POSSESSION_EVENT_TYPES`). Administrative, feed, disciplinary, and dead-stop rows are
 * excluded. Each side is clamped to 25–75% after calculation.
 */
export function deriveMatchStatsFromCsvEvents(
  events: ParsedCsvEvent[],
  opts?: { narrative?: string | null }
): DerivedMatchStats {
  const shots: HomeAwayCount = { home: 0, away: 0 };
  const shotsOnTarget: HomeAwayCount = { home: 0, away: 0 };
  const corners: HomeAwayCount = { home: 0, away: 0 };
  const fouls: HomeAwayCount = { home: 0, away: 0 };
  const saves: HomeAwayCount = { home: 0, away: 0 };
  const possessionTicks: HomeAwayCount = { home: 0, away: 0 };
  const xg: HomeAwayCount = { home: 0, away: 0 };

  const narrativeParts: string[] = [];

  for (const ev of events) {
    const csvType = ev.csvType;
    const side = ev.teamSide;
    if (!side && csvType !== "match_flow") continue;

    if (SAVE_CSV_TYPES.has(csvType) && side) {
      const attackingSide = oppositeSide(side);
      bump(shots, attackingSide);
      bump(shotsOnTarget, attackingSide);
      const weight = XG_WEIGHT[csvType];
      if (weight != null) xg[attackingSide] += weight;
      bump(saves, side);
    } else if (SHOT_CSV_TYPES.has(csvType) && side) {
      bump(shots, side);
      if (SOT_CSV_TYPES.has(csvType)) bump(shotsOnTarget, side);
      const weight = XG_WEIGHT[csvType];
      if (weight != null) xg[side] += weight;
    }

    if (csvType === "corner_kick" && side) bump(corners, side);
    if ((csvType === "foul" || csvType === "freekick" || csvType === "penalty_awarded") && side) {
      bump(fouls, side);
    }

    if (side) {
      const possSide = possessionTickSide(csvType, side);
      if (possSide) bump(possessionTicks, possSide);
    }

    if (
      (csvType === "score_update" || csvType === "match_flow") &&
      ev.detail?.trim()
    ) {
      narrativeParts.push(ev.detail.trim());
    }
  }

  const possTotal = possessionTicks.home + possessionTicks.away;
  const possession =
    possTotal > 0
      ? capPossessionPct(Math.round((possessionTicks.home / possTotal) * 100))
      : undefined;

  const hasShots = shots.home + shots.away > 0;
  const hasSot = shotsOnTarget.home + shotsOnTarget.away > 0;
  const hasCorners = corners.home + corners.away > 0;
  const hasFouls = fouls.home + fouls.away > 0;
  const hasSaves = saves.home + saves.away > 0;
  const hasXg = xg.home + xg.away > 0;

  const narrative =
    opts?.narrative?.trim() ||
    (narrativeParts.length ? narrativeParts.join(" ") : null);

  const stats: DerivedMatchStats = {};
  if (possession) stats.possession = possession;
  if (hasSaves) {
    stats.saves = {
      home: saves.home || null,
      away: saves.away || null,
    };
  }
  if (hasShots) stats.shots = shots;
  if (hasSot) stats.shotsOnTarget = shotsOnTarget;
  if (hasCorners) stats.corners = corners;
  if (hasFouls) stats.fouls = fouls;
  if (hasXg) {
    stats.xg = {
      home: Math.round(xg.home * 10) / 10,
      away: Math.round(xg.away * 10) / 10,
    };
  }
  if (narrative) stats.narrative = narrative;

  return stats;
}
