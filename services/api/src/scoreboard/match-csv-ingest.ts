import { BadRequestException } from "@nestjs/common";

const EVENT_TYPES = new Set([
  "goal",
  "own_goal",
  "yellow_card",
  "red_card",
  "substitution",
  "injury",
]);

const SPECIAL_TYPES = new Set(["full_time", "penalty_shootout"]);

export type ParsedMatchTimelineCsv = {
  homeScore: number;
  awayScore: number;
  events: Array<{
    type: string;
    minute: number;
    teamSide: "home" | "away";
    playerLabel?: string;
    assistLabel?: string;
    detail?: string;
  }>;
  penaltyShootout?: {
    home: number;
    away: number;
    winner: "home" | "away";
  };
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

function parseTeamSide(value: string | undefined, rowNum: number): "home" | "away" {
  const side = (value ?? "").trim().toLowerCase();
  if (side === "home" || side === "h") return "home";
  if (side === "away" || side === "a") return "away";
  throw new BadRequestException(
    `Row ${rowNum}: team_side must be "home" or "away" (got "${value ?? ""}")`
  );
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
  const playerIdx = headerIndex(headers, "player_name", "player");
  const assistIdx = headerIndex(headers, "assist_name", "assist");
  const detailIdx = headerIndex(headers, "detail");
  const homeScoreIdx = headerIndex(headers, "home_score");
  const awayScoreIdx = headerIndex(headers, "away_score");
  const penHomeIdx = headerIndex(headers, "pen_home", "penalty_home");
  const penAwayIdx = headerIndex(headers, "pen_away", "penalty_away");
  const penWinnerIdx = headerIndex(headers, "pen_winner", "penalty_winner");

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
  const events: ParsedMatchTimelineCsv["events"] = [];
  let fullTimeCount = 0;
  let penaltyCount = 0;

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const rowNum = r + 1;
    const eventType = (row[typeIdx] ?? "").trim().toLowerCase();
    if (!eventType) {
      errors.push(`Row ${rowNum}: event_type is empty`);
      continue;
    }

    if (eventType === "full_time") {
      fullTimeCount++;
      try {
        homeScore = parseIntCell(row[homeScoreIdx], "home_score", rowNum);
        awayScore = parseIntCell(row[awayScoreIdx], "away_score", rowNum);
      } catch (e) {
        if (e instanceof BadRequestException) errors.push(e.message);
      }
      continue;
    }

    if (eventType === "penalty_shootout") {
      penaltyCount++;
      try {
        const home = parseIntCell(row[penHomeIdx], "pen_home", rowNum);
        const away = parseIntCell(row[penAwayIdx], "pen_away", rowNum);
        const winnerRaw = (row[penWinnerIdx] ?? "").trim().toLowerCase();
        if (winnerRaw !== "home" && winnerRaw !== "away") {
          errors.push(`Row ${rowNum}: pen_winner must be "home" or "away"`);
        } else {
          penaltyShootout = { home, away, winner: winnerRaw };
        }
      } catch (e) {
        if (e instanceof BadRequestException) errors.push(e.message);
      }
      continue;
    }

    if (!EVENT_TYPES.has(eventType)) {
      errors.push(
        `Row ${rowNum}: unknown event_type "${eventType}" (allowed: ${[...EVENT_TYPES, ...SPECIAL_TYPES].join(", ")})`
      );
      continue;
    }

    try {
      const minute = parseMinute(row[minuteIdx], rowNum);
      const teamSide = parseTeamSide(row[teamIdx], rowNum);
      const playerLabel = (row[playerIdx] ?? "").trim();
      const assistLabel = (row[assistIdx] ?? "").trim();
      const detail = (row[detailIdx] ?? "").trim();

      if (!playerLabel) {
        errors.push(`Row ${rowNum}: player_name is required for ${eventType} events`);
        continue;
      }
      if (eventType === "substitution" && !assistLabel) {
        errors.push(
          `Row ${rowNum}: assist_name (player coming on) is required for substitution events`
        );
        continue;
      }

      events.push({
        type: eventType,
        minute,
        teamSide,
        playerLabel,
        assistLabel: assistLabel || undefined,
        detail: detail || undefined,
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
  };
}

export const MATCH_TIMELINE_CSV_TEMPLATE = `event_type,minute,team_side,player_name,assist_name,detail,home_score,away_score,pen_home,pen_away,pen_winner
full_time,,,,,,2,1,,,
goal,25,home,Charles Obani,,penalty,,,,
yellow_card,40,away,Amos Akinsipe,,,,,,
substitution,60,home,Player Off,Player On,,,,,
penalty_shootout,,,,,,,,4,2,home`;
