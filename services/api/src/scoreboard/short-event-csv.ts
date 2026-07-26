import { BadRequestException } from "@nestjs/common";

export type ParsedShortMatchEvent = {
  type: "goal" | "yellow_card" | "red_card" | "substitution";
  minute: number;
  teamName: string;
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

function mapEventType(value: string, rowNum: number): ParsedShortMatchEvent["type"] {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  switch (normalized) {
    case "goal":
      return "goal";
    case "penalty_goal":
    case "goal_penalty":
      return "goal";
    case "yellow_card":
      return "yellow_card";
    case "red_card":
      return "red_card";
    case "substitution":
      return "substitution";
    default:
      throw new BadRequestException(
        `Row ${rowNum}: unsupported event_type "${value}" for short timeline upload`
      );
  }
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

  if (minuteIdx < 0 || eventTypeIdx < 0 || teamIdx < 0) {
    throw new BadRequestException("CSV header must include minute, event_type, and team columns");
  }

  const events: ParsedShortMatchEvent[] = [];
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const rowNum = r + 1;
    const typeLabel = required(row, eventTypeIdx, "event_type", rowNum);
    const type = mapEventType(typeLabel, rowNum);
    const minute = parseMinute(required(row, minuteIdx, "minute", rowNum), rowNum);
    const teamName = required(row, teamIdx, "team", rowNum);
    const player = optional(row, playerIdx);
    const playerIn = optional(row, playerInIdx);
    const playerOut = optional(row, playerOutIdx);
    const half = optional(row, halfIdx);
    const matchLabel = optional(row, matchIdx);
    const isPenaltyGoal = /penalty/i.test(typeLabel);

    if (type === "substitution") {
      if (!playerIn || !playerOut) {
        throw new BadRequestException(
          `Row ${rowNum}: substitution rows require player_in and player_out`
        );
      }
      events.push({
        type,
        minute,
        teamName,
        playerLabel: playerOut,
        assistLabel: playerIn,
        detail: `${playerIn} for ${playerOut}`,
        metadata: { source: "quick-score-csv", half, matchLabel },
      });
      continue;
    }

    if (!player) {
      throw new BadRequestException(`Row ${rowNum}: player is required for ${typeLabel}`);
    }
    events.push({
      type,
      minute,
      teamName,
      playerLabel: player,
      detail: isPenaltyGoal ? "penalty" : undefined,
      metadata: { source: "quick-score-csv", half, matchLabel, isPenaltyGoal },
    });
  }

  return events;
}
