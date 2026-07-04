import { BadRequestException } from "@nestjs/common";
import { isAllowedImageMediaUrl } from "../shared/media-url";

export type ParsedMatchSquadCsvRow = {
  jerseyNumber: number | null;
  playerName: string;
  position: string | null;
  isStarter: boolean;
  dateOfBirth: Date | null;
  imageUrl: string | null;
};

const REQUIRED_HEADERS = ["jersey_number", "player_name", "position", "is_starter"] as const;

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (quoted) {
    throw new BadRequestException("CSV contains an unterminated quoted value.");
  }
  cells.push(current.trim());
  return cells;
}

function parseStarter(value: string, rowNumber: number) {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "starter", "start", "xi"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "bench", "sub", "substitute"].includes(normalized)) {
    return false;
  }
  throw new BadRequestException(
    `Row ${rowNumber}: is_starter must be TRUE/FALSE, 1/0, yes/no, XI, or bench.`
  );
}

function parseJerseyNumber(value: string, rowNumber: number) {
  if (!value.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999) {
    throw new BadRequestException(`Row ${rowNumber}: jersey_number must be a number from 0 to 999.`);
  }
  return parsed;
}

function parseOptionalDateOfBirth(value: string, rowNumber: number) {
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/\bSept\.\b/i, "Sep")
    .replace(/\bSept\b/i, "Sep")
    .replace(/\./g, "");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(
      `Row ${rowNumber}: date_of_birth must be a valid date, for example 2009-01-31 or 31-January-2009.`
    );
  }
  return parsed;
}

function parseOptionalImageUrl(value: string, rowNumber: number) {
  const raw = value.trim();
  if (!raw) return null;
  if (!isAllowedImageMediaUrl(raw)) {
    throw new BadRequestException(
      `Row ${rowNumber}: image_url must be a valid image URL from an allowed media source.`
    );
  }
  return raw;
}

export function parseMatchSquadCsv(csv: string): ParsedMatchSquadCsvRow[] {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new BadRequestException("CSV must include a header row and at least one player row.");
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const missing = REQUIRED_HEADERS.filter((header) => !headerIndex.has(header));
  if (missing.length) {
    throw new BadRequestException(`CSV missing required column(s): ${missing.join(", ")}.`);
  }

  return lines.slice(1).map((line, index) => {
    const rowNumber = index + 2;
    const cells = parseCsvLine(line);
    const read = (header: (typeof REQUIRED_HEADERS)[number]) =>
      cells[headerIndex.get(header) ?? -1]?.trim() ?? "";
    const readOptional = (header: string) =>
      headerIndex.has(header) ? cells[headerIndex.get(header) ?? -1]?.trim() ?? "" : "";
    const playerName = read("player_name");
    const position = read("position");
    if (!playerName) {
      throw new BadRequestException(`Row ${rowNumber}: player_name is required.`);
    }
    if (position.length > 40) {
      throw new BadRequestException(`Row ${rowNumber}: position must be 40 characters or fewer.`);
    }

    return {
      jerseyNumber: parseJerseyNumber(read("jersey_number"), rowNumber),
      playerName,
      position: position || null,
      isStarter: parseStarter(read("is_starter"), rowNumber),
      dateOfBirth: parseOptionalDateOfBirth(
        readOptional("date_of_birth") || readOptional("dob"),
        rowNumber
      ),
      imageUrl: parseOptionalImageUrl(
        readOptional("image_url") || readOptional("imageurl") || readOptional("photo_url"),
        rowNumber
      ),
    };
  });
}
