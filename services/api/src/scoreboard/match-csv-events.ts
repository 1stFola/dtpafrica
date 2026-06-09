/** CSV `event_type` values accepted by match timeline ingest. */
export const CSV_EVENT_TYPES = [
  "kick_off",
  "match_flow",
  "freekick",
  "pressure",
  "corner_kick",
  "save",
  "yellow_card",
  "goal_penalty",
  "chance",
  "half_time",
  "substitution",
  "second_half_kickoff",
  "blocked_shot",
  "goal",
  "throw_in",
  "offside",
  "added_time",
  "possession",
  "foul",
  "clearance",
  "close_chance",
  "shot_off_target",
  "score_update",
  "own_goal",
  "red_card",
  "injury",
] as const;

export type CsvEventType = (typeof CSV_EVENT_TYPES)[number];

export const CSV_SPECIAL_TYPES = ["full_time", "penalty_shootout"] as const;

export type ParsedCsvEvent = {
  csvType: CsvEventType;
  type: string;
  minute: number;
  teamSide?: "home" | "away";
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

const FLOW_CSV_TYPES = new Set<CsvEventType>([
  "kick_off",
  "match_flow",
  "pressure",
  "half_time",
  "second_half_kickoff",
  "added_time",
  "score_update",
]);

const TEAM_OPTIONAL_TYPES = new Set<CsvEventType>([
  "kick_off",
  "match_flow",
  "pressure",
  "half_time",
  "second_half_kickoff",
  "added_time",
  "score_update",
  "possession",
  "throw_in",
  "offside",
]);

const PLAYER_OPTIONAL_TYPES = new Set<CsvEventType>([
  ...TEAM_OPTIONAL_TYPES,
  "corner_kick",
  "foul",
  "clearance",
]);

const SHOT_CSV_TYPES = new Set<CsvEventType>([
  "goal",
  "own_goal",
  "goal_penalty",
  "chance",
  "close_chance",
  "shot_off_target",
  "blocked_shot",
]);

const SOT_CSV_TYPES = new Set<CsvEventType>([
  "goal",
  "own_goal",
  "goal_penalty",
  "close_chance",
  "blocked_shot",
]);

const XG_WEIGHT: Partial<Record<CsvEventType, number>> = {
  goal: 1,
  goal_penalty: 0.76,
  own_goal: 1,
  close_chance: 0.35,
  chance: 0.15,
  shot_off_target: 0.05,
  blocked_shot: 0.1,
  save: 0.25,
};

export function isFlowCsvType(csvType: string): boolean {
  return FLOW_CSV_TYPES.has(csvType as CsvEventType);
}

export function csvTypeRequiresTeam(csvType: CsvEventType): boolean {
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
    case "score_update":
      return undefined;
    default:
      return undefined;
  }
}

function bump(counts: HomeAwayCount, side: "home" | "away", n = 1) {
  counts[side] += n;
}

/**
 * Possession % is derived from CSV `team_side` (column C), not from `possession` rows alone.
 * Each ingested timeline row with team_side=home|away counts as one tick for that side.
 *
 * Counted: every parsed match event that carries team_side (goals, fouls, subs, flow rows
 * with a side, etc.).
 *
 * Not counted: full_time and penalty_shootout (never enter the events list), and any row
 * without team_side (kick_off, half_time, match_flow/pressure/score_update when side is blank).
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

    if (csvType === "save" && side) {
      const attackingSide = side === "home" ? "away" : "home";
      bump(shots, attackingSide);
      bump(shotsOnTarget, attackingSide);
      const weight = XG_WEIGHT.save;
      if (weight != null) xg[attackingSide] += weight;
      bump(saves, side);
    } else if (SHOT_CSV_TYPES.has(csvType) && side) {
      bump(shots, side);
      if (SOT_CSV_TYPES.has(csvType)) bump(shotsOnTarget, side);
      const weight = XG_WEIGHT[csvType];
      if (weight != null) xg[side] += weight;
    }

    if (csvType === "corner_kick" && side) bump(corners, side);
    if ((csvType === "foul" || csvType === "freekick") && side) bump(fouls, side);

    if (side) bump(possessionTicks, side);

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
      ? (() => {
          const homePct = Math.round((possessionTicks.home / possTotal) * 100);
          return { home: homePct, away: 100 - homePct };
        })()
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
