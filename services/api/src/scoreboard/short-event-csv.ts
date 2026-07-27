import { BadRequestException } from "@nestjs/common";
import {
  CSV_EVENT_TYPES,
  csvTypeRequiresPlayer,
  csvTypeRequiresTeam,
  mapCsvEventToStorage,
  type CsvEventType,
} from "./match-csv-events";

export type ParsedShortMatchEvent = {
  type: string;
  minute: number;
  teamName?: string;
  playerLabel?: string;
  assistLabel?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
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
  const normalized = headers.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  for (const name of names) {
    const idx = normalized.indexOf(name.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function required(row: string[], idx: number, label: string, rowNum: number): string {
  const value = idx >= 0 ? (row[idx] ?? "").trim() : "";
  if (!value) throw new BadRequestException(`Row ${rowNum}: ${label} is required`);
  return value;
}

function optional(row: string[], idx: number): string {
  return idx >= 0 ? (row[idx] ?? "").trim() : "";
}

function parseMinute(value: string, rowNum: number): number {
  const match = value.trim().match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*(?:'|min\b|m\b)?$/i);
  if (!match) throw new BadRequestException(`Row ${rowNum}: minute must be like 39' or 90+4'`);
  const minute = Number(match[1]) + Number(match[2] ?? 0);
  if (!Number.isFinite(minute) || minute < 0 || minute > 130) {
    throw new BadRequestException(`Row ${rowNum}: minute must be between 0 and 130`);
  }
  return minute;
}

const EVENT_TYPE_ALIASES: Record<string, CsvEventType> = {
  freekick: "freekick",
  free_kick: "freekick",
  kickoff: "kick_off",
  kick_off: "kick_off",
  penalty: "goal_penalty",
  penalty_goal: "goal_penalty",
  penalty_kick_goal: "goal_penalty",
  goal_penalty: "goal_penalty",
  own_goal: "own_goal",
  og: "own_goal",
  yellow: "yellow_card",
  yellow_card: "yellow_card",
  red: "red_card",
  red_card: "red_card",
  shootout_goal: "shootout_goal",
  shootout_scored: "shootout_goal",
  shootout_miss: "shootout_miss",
  shootout_missed: "shootout_miss",
};

function normalizeEventType(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function mapEventType(value: string, rowNum: number): CsvEventType {
  const normalized = normalizeEventType(value);
  const direct = CSV_EVENT_TYPES.find((eventType) => eventType === normalized);
  const alias = EVENT_TYPE_ALIASES[normalized];
  if (direct) return direct;
  if (alias) return alias;

  throw new BadRequestException(
    `Row ${rowNum}: unsupported event_type "${value}" for short timeline upload`
  );
}

export function parseShortMatchEventsCsv(csv: string): ParsedShortMatchEvent[] {
  const table = parseCsv(csv.trim());
  if (table.length < 2) {
    throw new BadRequestException("CSV must include a header row and at least one event row");
  }

  const headers = table[0];
  const minuteIdx = headerIndex(headers, "minute");
  const eventTypeIdx = headerIndex(headers, "event_type", "type");
  const teamIdx = headerIndex(headers, "team", "team_name");
  const playerIdx = headerIndex(headers, "player", "player_name");
  const playerInIdx = headerIndex(headers, "player_in", "player_on");
  const playerOutIdx = headerIndex(headers, "player_out", "player_off");
  const halfIdx = headerIndex(headers, "half");
  const matchIdx = headerIndex(headers, "match");
  const detailIdx = headerIndex(headers, "detail", "description", "comment");

  if (minuteIdx < 0 || eventTypeIdx < 0) {
    throw new BadRequestException("CSV header must include minute and event_type columns");
  }

  const events: ParsedShortMatchEvent[] = [];
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const rowNum = r + 1;
    const typeLabel = required(row, eventTypeIdx, "event_type", rowNum);
    const csvType = mapEventType(typeLabel, rowNum);
    const minute = parseMinute(required(row, minuteIdx, "minute", rowNum), rowNum);
    const teamName = optional(row, teamIdx);
    const player = optional(row, playerIdx);
    const playerIn = optional(row, playerInIdx);
    const playerOut = optional(row, playerOutIdx);
    const half = optional(row, halfIdx);
    const matchLabel = optional(row, matchIdx);
    const detailValue = optional(row, detailIdx);

    if (csvTypeRequiresTeam(csvType) && !teamName) {
      throw new BadRequestException(`Row ${rowNum}: team is required for ${typeLabel}`);
    }

    if (csvType === "substitution" || csvType === "injury_substitution" || csvType === "tactical_substitution") {
      if (!playerIn || !playerOut) {
        throw new BadRequestException(
          `Row ${rowNum}: substitution rows require player_in and player_out`
        );
      }
      const storage = mapCsvEventToStorage({
        csvType,
        playerLabel: playerOut,
        assistLabel: playerIn,
        detail: detailValue || `${playerIn} for ${playerOut}`,
      });
      events.push({
        type: storage.type,
        minute,
        teamName: teamName || undefined,
        playerLabel: playerOut,
        assistLabel: playerIn,
        detail: storage.detail,
        metadata: { ...(storage.metadata ?? {}), source: "quick-score-csv", half, matchLabel },
      });
      continue;
    }

    if (csvTypeRequiresPlayer(csvType) && !player) {
      throw new BadRequestException(`Row ${rowNum}: player is required for ${typeLabel}`);
    }
    const storage = mapCsvEventToStorage({
      csvType,
      playerLabel: player || undefined,
      detail: detailValue || undefined,
    });
    events.push({
      type: storage.type,
      minute,
      teamName: teamName || undefined,
      playerLabel: player || undefined,
      detail: storage.detail,
      metadata: { ...(storage.metadata ?? {}), source: "quick-score-csv", half, matchLabel },
    });
  }

  return events;
}
