import { BadRequestException } from "@nestjs/common";
import { normalizePlayerName, playerLookupKey } from "@dtp/engines";
import { reorderKey } from "../players/duplicate-detection";
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

/** The parts of a team's squad row a matchday CSV is matched against. */
export type TeamSquadCandidate = {
  id: string;
  displayName: string;
  shirtNumber: number | null;
  position: string | null;
  playerId: string | null;
  player: { displayName: string } | null;
};

export type MatchedSquadCsvRow<T extends TeamSquadCandidate = TeamSquadCandidate> = {
  rowNumber: number;
  row: ParsedMatchSquadCsvRow;
  squad: T;
  /**
   * The jersey number this upload may write: the CSV's, only where the squad row has
   * none and no other player in the team already wears it. Otherwise the squad row's.
   */
  shirtNumber: number | null;
};

/**
 * Map each CSV row to the player the team's squad already holds.
 *
 * A matchday sheet names people the team registered; it does not register anybody.
 * Every row that created a `Player` here became a person everywhere in the product --
 * goals, charts, a public profile -- and a misspelt name on a team sheet is the most
 * common way a second record of the same boy got started. So a row that matches no one
 * in this team is an error the uploader fixes, never a new record.
 *
 * Matched on the dedupe key, against both the squad row's name and its player's, then
 * on the same words in any order: within one squad no two players share a first or last
 * name even swapped (the rule `squad-duplicates.ts` merges on), so `Nwosu Henry` on the
 * sheet is the `Henry Nwosu` in the squad.
 *
 * The jersey number on the sheet is never used to match and never replaces a number the
 * squad already holds -- a team sheet's numbers drift from match to match, and a wrong
 * number moves future `No. 7` events onto the wrong person. It only fills a blank.
 */
export function matchSquadCsvRows<T extends TeamSquadCandidate>(
  rows: ParsedMatchSquadCsvRow[],
  squad: T[]
) {
  const byKey = new Map<string, Set<T>>();
  const byWords = new Map<string, Set<T>>();
  const index = (map: Map<string, Set<T>>, key: string, member: T) => {
    if (!key) return;
    const held = map.get(key) ?? new Set<T>();
    held.add(member);
    map.set(key, held);
  };
  for (const member of squad) {
    for (const name of [member.displayName, member.player?.displayName]) {
      if (!name) continue;
      const tidy = normalizePlayerName(name);
      index(byKey, playerLookupKey(tidy), member);
      index(byWords, reorderKey(tidy), member);
    }
  }

  const matched: MatchedSquadCsvRow<T>[] = [];
  const errors: string[] = [];
  const rowBySquadId = new Map<string, number>();

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const tidy = normalizePlayerName(row.playerName);
    const hits = byKey.get(playerLookupKey(tidy)) ?? byWords.get(reorderKey(tidy));
    if (!hits?.size) {
      errors.push(`row ${rowNumber}: ${row.playerName} is not in this team's squad`);
      return;
    }
    if (hits.size > 1) {
      const names = [...hits].map((member) => member.displayName).join(", ");
      errors.push(`row ${rowNumber}: ${row.playerName} matches more than one squad player (${names})`);
      return;
    }
    const [member] = hits;
    const earlier = rowBySquadId.get(member.id);
    if (earlier !== undefined) {
      errors.push(`row ${rowNumber}: ${row.playerName} is the same player as row ${earlier}`);
      return;
    }
    rowBySquadId.set(member.id, rowNumber);
    matched.push({ rowNumber, row, squad: member, shirtNumber: member.shirtNumber });
  });

  /* Blanks filled only with a number nobody else in the team holds, and that no
     earlier row of this sheet has just claimed. */
  const warnings: string[] = [];
  const worn = new Set(
    squad.map((member) => member.shirtNumber).filter((n): n is number => n !== null)
  );
  for (const entry of matched) {
    const incoming = entry.row.jerseyNumber;
    if (entry.squad.shirtNumber !== null || incoming === null) continue;
    if (worn.has(incoming)) {
      warnings.push(
        `row ${entry.rowNumber}: #${incoming} is already worn in this squad, so ${entry.squad.displayName} was left without a number`
      );
      continue;
    }
    worn.add(incoming);
    entry.shirtNumber = incoming;
  }

  return { matched, errors, warnings };
}
