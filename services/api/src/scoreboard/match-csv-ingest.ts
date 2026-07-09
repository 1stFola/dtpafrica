import { BadRequestException } from "@nestjs/common";
import {
  CSV_EVENT_TYPES,
  CSV_SPECIAL_TYPES,
  type CsvEventType,
  type ParsedCsvEvent,
  csvTypeRequiresPlayer,
  csvTypeRequiresTeam,
  isNeutralCsvEventType,
  isPenaltyShootoutEventType,
  mapCsvEventToStorage,
} from "./match-csv-events";

const EVENT_TYPES = new Set<string>(CSV_EVENT_TYPES);
const SPECIAL_TYPES = new Set<string>(CSV_SPECIAL_TYPES);

export type ParsedMatchTimelineCsv = {
  homeScore: number;
  awayScore: number;
  events: ParsedCsvEvent[];
  penaltyShootout?: {
    home: number;
    away: number;
    winner: "home" | "away";
  };
  narrative?: string | null;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c.length)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((c) => c.length)) rows.push(row);
  return rows;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const lower = headers.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  for (const name of names) {
    const idx = lower.indexOf(name.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseIntCell(value: string | undefined, label: string, rowNum: number): number {
  const raw = (value ?? "").trim();
  if (!raw) {
    throw new BadRequestException(`Row ${rowNum}: ${label} is required`);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException(`Row ${rowNum}: ${label} must be a non-negative integer`);
  }
  return n;
}

const NEUTRAL_TEAM_SIDE_VALUES = new Set(["", "unknown", "n/a", "na", "-", "none"]);

function parseTeamSide(
  value: string | undefined,
  rowNum: number,
  optional: boolean
): "home" | "away" | undefined {
  const side = (value ?? "").trim().toLowerCase();
  if (NEUTRAL_TEAM_SIDE_VALUES.has(side)) {
    if (optional) return undefined;
    throw new BadRequestException(
      `Row ${rowNum}: team_side must be "home" or "away" (got empty)`
    );
  }
  if (side === "home" || side === "h") return "home";
  if (side === "away" || side === "a") return "away";
  throw new BadRequestException(
    `Row ${rowNum}: team_side must be "home" or "away" (got "${value ?? ""}")`
  );
}

function penaltyShootoutFieldsRequired(
  eventType: string,
  inShootoutPhase: boolean
): boolean {
  if (!isPenaltyShootoutEventType(eventType)) return false;
  if (eventType === "penalty_shootout") return true;
  return inShootoutPhase;
}

function hasPenaltyShootoutHeader(
  penHomeIdx: number,
  penAwayIdx: number,
  penWinnerIdx: number
): boolean {
  return penHomeIdx >= 0 || penAwayIdx >= 0 || penWinnerIdx >= 0;
}

function parseMinute(value: string | undefined, rowNum: number): number {
  const raw = (value ?? "").trim();
  if (!raw) {
    throw new BadRequestException(`Row ${rowNum}: minute is required for match events`);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 130) {
    throw new BadRequestException(`Row ${rowNum}: minute must be between 0 and 130`);
  }
  return n;
}

export function parseMatchTimelineCsv(csv: string): ParsedMatchTimelineCsv {
  const table = parseCsv(csv.trim());
  if (table.length < 2) {
    throw new BadRequestException(
      "CSV must include a header row and at least one data row (full_time score required)"
    );
  }

  const headers = table[0];
  const typeIdx = headerIndex(headers, "event_type", "type");
  const minuteIdx = headerIndex(headers, "minute");
  const teamIdx = headerIndex(headers, "team_side", "team");
  const player2Idx = headerIndex(headers, "player_name2", "player2");
  const playerIdx = headerIndex(headers, "player_name", "player");
  const assistIdx = headerIndex(headers, "assist_name", "assist");
  const detailIdx = headerIndex(headers, "detail");
  const homeScoreIdx = headerIndex(headers, "home_score");
  const awayScoreIdx = headerIndex(headers, "away_score");
  const penHomeIdx = headerIndex(headers, "pen_home", "penalty_home");
  const penAwayIdx = headerIndex(headers, "pen_away", "penalty_away");
  const penWinnerIdx = headerIndex(headers, "pen_winner", "penalty_winner");
  const narrativeIdx = headerIndex(headers, "narrative");

  if (typeIdx < 0) {
    throw new BadRequestException('CSV header must include an "event_type" (or "type") column');
  }
  if (homeScoreIdx < 0 || awayScoreIdx < 0) {
    throw new BadRequestException(
      'CSV header must include "home_score" and "away_score" columns'
    );
  }

  const errors: string[] = [];
  let homeScore: number | null = null;
  let awayScore: number | null = null;
  let penaltyShootout: ParsedMatchTimelineCsv["penaltyShootout"];
  let narrative: string | null = null;
  const events: ParsedCsvEvent[] = [];
  let fullTimeCount = 0;
  let penaltyCount = 0;
  let inShootoutPhase = false;

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const rowNum = r + 1;
    const eventType = (row[typeIdx] ?? "").trim().toLowerCase();
    if (!eventType || eventType.startsWith("#")) {
      if (eventType.startsWith("#")) continue;
      errors.push(`Row ${rowNum}: event_type is empty`);
      continue;
    }

    if (eventType === "full_time") {
      fullTimeCount++;
      try {
        homeScore = parseIntCell(row[homeScoreIdx], "home_score", rowNum);
        awayScore = parseIntCell(row[awayScoreIdx], "away_score", rowNum);
        const narrativeCell = narrativeIdx >= 0 ? (row[narrativeIdx] ?? "").trim() : "";
        if (narrativeCell) narrative = narrativeCell;
      } catch (e) {
        if (e instanceof BadRequestException) errors.push(e.message);
      }
      continue;
    }

    if (eventType === "penalty_shootout") {
      penaltyCount++;
      inShootoutPhase = true;
      if (hasPenaltyShootoutHeader(penHomeIdx, penAwayIdx, penWinnerIdx)) {
        try {
          const home = parseIntCell(
            penHomeIdx >= 0 ? row[penHomeIdx] : undefined,
            "pen_home",
            rowNum
          );
          const away = parseIntCell(
            penAwayIdx >= 0 ? row[penAwayIdx] : undefined,
            "pen_away",
            rowNum
          );
          const winnerRaw = ((penWinnerIdx >= 0 ? row[penWinnerIdx] : undefined) ?? "")
            .trim()
            .toLowerCase();
          if (winnerRaw !== "home" && winnerRaw !== "away") {
            errors.push(`Row ${rowNum}: pen_winner must be "home" or "away"`);
          } else {
            penaltyShootout = { home, away, winner: winnerRaw };
          }
        } catch (e) {
          if (e instanceof BadRequestException) errors.push(e.message);
        }
      }
      continue;
    }

    if (!EVENT_TYPES.has(eventType)) {
      errors.push(
        `Row ${rowNum}: unknown event_type "${eventType}" (allowed: ${[...EVENT_TYPES, ...SPECIAL_TYPES].sort().join(", ")})`
      );
      continue;
    }

    const csvType = eventType as CsvEventType;

    if (eventType !== "penalty_shootout") {
      inShootoutPhase = inShootoutPhase || isPenaltyShootoutEventType(eventType);
    }

    try {
      const minute = parseMinute(row[minuteIdx], rowNum);
      const teamOptional = isNeutralCsvEventType(eventType) || !csvTypeRequiresTeam(csvType);
      const teamSide = parseTeamSide(row[teamIdx], rowNum, teamOptional);
      const playerLabel2 = player2Idx >= 0 ? (row[player2Idx] ?? "").trim() : "";
      const playerLabel = (row[playerIdx] ?? "").trim();
      const assistLabel = (row[assistIdx] ?? "").trim();
      const detail = (row[detailIdx] ?? "").trim();

      if (csvTypeRequiresTeam(csvType) && !teamSide) {
        errors.push(`Row ${rowNum}: team_side is required for ${eventType} events`);
        continue;
      }
      if (csvTypeRequiresPlayer(csvType) && !playerLabel) {
        errors.push(`Row ${rowNum}: player_name is required for ${eventType} events`);
        continue;
      }
      if (
        (csvType === "substitution" ||
          csvType === "injury_substitution" ||
          csvType === "tactical_substitution") &&
        !assistLabel
      ) {
        errors.push(
          `Row ${rowNum}: assist_name (player coming on) is required for ${eventType} events`
        );
        continue;
      }

      if (
        penaltyShootoutFieldsRequired(eventType, inShootoutPhase) &&
        hasPenaltyShootoutHeader(penHomeIdx, penAwayIdx, penWinnerIdx)
      ) {
        const penHome = (penHomeIdx >= 0 ? row[penHomeIdx] : undefined) ?? "";
        const penAway = (penAwayIdx >= 0 ? row[penAwayIdx] : undefined) ?? "";
        const penWinner = (penWinnerIdx >= 0 ? row[penWinnerIdx] : undefined) ?? "";
        const anyPenCell = penHome.trim() || penAway.trim() || penWinner.trim();
        if (anyPenCell) {
          try {
            parseIntCell(penHome || undefined, "pen_home", rowNum);
            parseIntCell(penAway || undefined, "pen_away", rowNum);
            const winnerRaw = penWinner.trim().toLowerCase();
            if (winnerRaw !== "home" && winnerRaw !== "away") {
              errors.push(`Row ${rowNum}: pen_winner must be "home" or "away"`);
              continue;
            }
          } catch (e) {
            if (e instanceof BadRequestException) {
              errors.push(e.message);
              continue;
            }
          }
        }
      }

      const mapped = mapCsvEventToStorage({
        csvType,
        teamSide,
        playerLabel: playerLabel || undefined,
        assistLabel: assistLabel || undefined,
        detail: detail || undefined,
      });

      events.push({
        csvType,
        type: mapped.type,
        minute,
        teamSide,
        playerLabel2: playerLabel2 || undefined,
        playerLabel: playerLabel || undefined,
        assistLabel: assistLabel || undefined,
        detail: mapped.detail,
        metadata: mapped.metadata,
      });
    } catch (e) {
      if (e instanceof BadRequestException) errors.push(e.message);
    }
  }

  if (fullTimeCount === 0) {
    errors.push('CSV must include exactly one "full_time" row with home_score and away_score');
  } else if (fullTimeCount > 1) {
    errors.push('CSV must include exactly one "full_time" row');
  }
  if (penaltyCount > 1) {
    errors.push('CSV must include at most one "penalty_shootout" row');
  }
  if (homeScore == null || awayScore == null) {
    errors.push("full_time row must provide valid home_score and away_score");
  }

  if (errors.length > 0) {
    throw new BadRequestException({
      message: "CSV validation failed",
      errors,
    });
  }

  return {
    homeScore: homeScore!,
    awayScore: awayScore!,
    events,
    penaltyShootout,
    narrative,
  };
}

export const MATCH_TIMELINE_CSV_TEMPLATE = `event_type,minute,team_side,player_name2,player_name,assist_name,detail,home_score,away_score,narrative,pen_home,pen_away,pen_winner
# Required: one full_time row with final score. Optional narrative on full_time row.
full_time,,,,,,,0,1,FC OMORUYI 1-0 FC OGUNTUASE — Destiny Nosa 84',,,
# Flow / narrative (stored as match_flow with flowKind)
kick_off,0,Unknown,,,,First half begins,,,,,
half_time,45,,,,,Half-time,,,,,
second_half_kickoff,46,,,,,Second half begins,,,,,
added_time,90,,,,,+3 minutes,,,,,
water_break,30,,,,,Drinks break,,,,,
midfield_battle,38,,,,,Midfield battle intensifies,,,,,
match_control,55,home,,,,Home side controlling tempo,,,,,
goal_scorers_update,84,,,,,Scorers updated,,,,,
pressure,22,away,,,,Heavy pressure in final third,,,,,
score_update,84,away,,,,OMORUYI take the lead 1-0,,,,,
match_flow,60,,,,,Key phase of play,,,,,
# Team actions — player_name optional for throw_in/offside/corner_kick/long_throw
possession,12,home,,,,Sustained spell,,,,,
foul,18,home,,Shodakin Sodiq,,,,,,,
freekick,19,away,,,,Dangerous free kick,,,,,
corner_kick,33,away,,,,,,,,,
throw_in,28,home,,,,,,,,,
long_throw,29,home,,,,,,,,,
offside,31,away,,,,,,,,,
counter_attack,44,away,,,,,,,,,
interception,36,home,,Jide Oluseye,,,,,,,
clearance,35,home,,Jide Oluseye,Goalkeeper,,,,,,
late_defense,70,away,,Defender,,,,,,,
# Shots & chances — player_name2 = opposing player (e.g. GK on close_chance/save)
chance,40,away,,David Adesanya,,Header wide,,,,,
close_chance,72,away,Goalkeeper,Destiny Nosa,,Saved,,,,,
missed_chance,58,home,,Tunde Oladejo,,,,,,,
shot_off_target,55,home,,Tunde Oladejo,Goalkeeper,,,,,,
woodwork,63,away,,David Adesanya,,,,,,,
blocked_shot,68,home,,Baare Adeyemi,Defender,,,,,,
save,72,home,Striker,Goalkeeper,,,,,,,
double_save,74,home,,Goalkeeper,,,,,,,
penalty_awarded,80,away,,,,,,,,,
penalty_saved,81,home,,Goalkeeper,,,,,,,
disallowed_goal,85,away,,Striker,,Offside,,,,,
# Goals & cards
goal,84,away,,Destiny Nosa,,,,,,,
goal_penalty,82,home,,No. 5,,,,,,,
own_goal,50,home,,Defender,,,,,,,
yellow_card,40,away,,Ololade Yusuf,,,,,,,
red_card,77,away,,Goalkeeper,,straight red,,,,,
injury,62,home,,Player,,,,,,,
# Substitutions (assist_name = player on)
substitution,46,home,,Anuoluwapo Oluwow,Korede Elejoba,#12 off #17 on,,,,,
substitution,53,away,,Ololade Yusuf,Destiny,#11 off #12 on,,,,,
# Optional penalty shootout row (knockout)
penalty_shootout,,,,,,,,,4,2,home`;
