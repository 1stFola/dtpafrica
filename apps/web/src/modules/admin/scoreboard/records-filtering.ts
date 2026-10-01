/**
 * Filtering for the Master records tabs.
 *
 * Kept out of the React tree so it can be tested without a DOM, which is the arrangement
 * `vitest.config.ts` explains. The page had this logic inline and it cost on three counts:
 *
 * **Every filter was a round trip.** A status or type change refetched the competitions, a
 * keystroke refetched the players (debounced, so one request per pause rather than per key).
 * None of those endpoints paginate — competitions, teams, fixtures and the squad directory all
 * come back whole — so the browser already held every row it was asking the server to filter.
 * The tab now fetches once and every filter is answered from what it has.
 *
 * That also fixes a search that quietly lost rows: the directory endpoint caps a *search* at
 * 500 rows while returning everything when asked for nothing, so typing a common surname could
 * show fewer matches than scrolling the unfiltered list.
 *
 * **The search rebuilt its haystacks on every keystroke.** Each fixture's searchable text was
 * assembled, lowercased and joined inside the filter callback, so a seven-field join ran per
 * row per render. Built once per dataset instead, by `indexForSearch`.
 *
 * **Name QA was quadratic.** It grouped players into four maps with
 * `map.set(key, [...(map.get(key) ?? []), player])` — a fresh copy of the growing array for
 * every player. On a directory of a few thousand squad rows that is millions of copies, and it
 * ran again on every render that touched `players`. Same grouping, one pass, `push`.
 */
import type {
  AdminSbCompetition,
  AdminSbPlayerDirectoryRow,
  AdminSbTeam,
} from "./types";
import { positionTag } from "./types";
import type { SbMatchListItem } from "../../../api/scoreboard";

/** A row with its searchable text worked out once. */
export type SearchIndexed<T> = { row: T; haystack: string };

/** What a search box's text means: nothing, or a lowercase needle. */
export function searchNeedle(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Pair each row with its searchable text.
 *
 * Call this on the dataset, not inside the filter: the point is that the strings survive a
 * keystroke. Memoise it on the rows and the filter below is a substring test per row.
 */
export function indexForSearch<T>(
  rows: readonly T[],
  textOf: (row: T) => (string | null | undefined)[]
): SearchIndexed<T>[] {
  return rows.map((row) => ({
    row,
    haystack: textOf(row).filter(Boolean).join(" ").toLowerCase(),
  }));
}

/**
 * The rows that match both the search and the filters, in one pass.
 *
 * The predicate is checked before the substring test because it is the cheaper of the two and
 * usually the more selective -- a team filter cuts a directory to one squad.
 */
export function filterIndexed<T>(
  indexed: readonly SearchIndexed<T>[],
  needle: string,
  keep: (row: T) => boolean
): T[] {
  const out: T[] = [];
  for (const entry of indexed) {
    if (!keep(entry.row)) continue;
    if (needle && !entry.haystack.includes(needle)) continue;
    out.push(entry.row);
  }
  return out;
}

/* ── Competitions ─────────────────────────────────────────────────────────── */

export type CompetitionFilters = {
  status: string;
  type: string;
  /** "" | "published" | "unpublished" */
  published: string;
  /** "" | "featured" | "notFeatured" */
  featured: string;
};

export const competitionSearchText = (c: AdminSbCompetition) => [
  c.name,
  c.slug,
  c.region,
  c.season,
  c.type,
  c.formatType,
];

export function keepCompetition(f: CompetitionFilters) {
  return (c: AdminSbCompetition) => {
    /* Case-insensitively, because the status and type columns are free text on older rows and
       the filter options are a fixed list -- an "Ongoing" row would otherwise vanish when
       somebody picked "ongoing". The server's own filters compare this way too. */
    if (f.status && c.status.toLowerCase() !== f.status.toLowerCase()) return false;
    if (f.type && (c.type ?? "").toLowerCase() !== f.type.toLowerCase()) return false;
    if (f.published === "published" && !c.isPublished) return false;
    if (f.published === "unpublished" && c.isPublished) return false;
    if (f.featured === "featured" && !c.isFeatured) return false;
    if (f.featured === "notFeatured" && c.isFeatured) return false;
    return true;
  };
}

/* ── Teams ────────────────────────────────────────────────────────────────── */

export type TeamFilters = { competitionId: string; groupKey: string };

export const teamSearchText = (t: AdminSbTeam) => [
  t.name,
  t.slug,
  t.shortName,
  t.region,
  t.competition.name,
];

export function keepTeam(f: TeamFilters) {
  return (t: AdminSbTeam) => {
    if (f.competitionId && t.competition.id !== f.competitionId) return false;
    if (f.groupKey && t.groupKey !== f.groupKey) return false;
    return true;
  };
}

export function teamGroupOptionsFor(teams: readonly AdminSbTeam[]): string[] {
  const seen = new Set<string>();
  for (const team of teams) if (team.groupKey) seen.add(team.groupKey);
  return [...seen].sort();
}

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

export type FixtureFilters = { competitionId: string; status: string };

export const fixtureSearchText = (m: SbMatchListItem) => [
  m.homeTeam.name,
  m.awayTeam.name,
  m.competition.name,
  m.slug,
  m.venue,
  m.roundLabel,
  m.stageKey,
];

export function keepFixture(f: FixtureFilters) {
  return (m: SbMatchListItem) => {
    if (f.competitionId && m.competition.id !== f.competitionId) return false;
    if (f.status && m.status !== f.status) return false;
    return true;
  };
}

/* ── Players ──────────────────────────────────────────────────────────────── */

export type PlayerFilters = {
  teamId: string;
  /** A `PositionTag`, or "" for any. */
  position: string;
  /** "" | "linked" | "unlinked" */
  link: string;
};

export const playerSearchText = (p: AdminSbPlayerDirectoryRow) => [
  p.displayName,
  p.slug,
  ...p.teams.flatMap((team) => [team.teamName, team.competitionName]),
];

export function keepPlayer(f: PlayerFilters) {
  return (p: AdminSbPlayerDirectoryRow) => {
    if (f.teamId && !p.teams.some((team) => team.teamId === f.teamId)) return false;
    if (
      f.position &&
      !p.teams.some(
        (team) => positionTag(team.position ?? p.positionPrimary) === f.position
      )
    ) {
      return false;
    }
    if (f.link === "linked" && !p.playerId) return false;
    if (f.link === "unlinked" && p.playerId) return false;
    return true;
  };
}

/* ── Name QA ──────────────────────────────────────────────────────────────── */

export type NameQaRow = { player: AdminSbPlayerDirectoryRow; flags: string[] };

export const NAME_QA_FLAGS = {
  incomplete: "Name completion needed",
  duplicate: "Possible duplicate normalized name",
  sameFirstLast: "Same First Name and Last name",
  sameSurname: "Same Surname",
  swapped: "Swapped First name and last name",
  unusual: "Unusual name appearance",
  tooShort: "Unusual short name",
} as const;

/** Letters and spaces only, for comparing names that differ by punctuation or case. */
export function normalizeNameKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The directory rows whose names need a human to look at them, with why.
 *
 * Two passes: one to group the names four ways, one to read each player against those groups.
 * The grouping was previously rebuilding each bucket per insert, which is the same answer at
 * O(n²) -- unnoticeable on a test fixture and a visible freeze on the live directory.
 */
export function nameQaRowsFor(players: readonly AdminSbPlayerDirectoryRow[]): NameQaRow[] {
  const byName = new Map<string, number>();
  const byFirstLast = new Map<string, number>();
  const bySurname = new Map<string, number>();
  const reversedSeen = new Set<string>();
  /* Counts, not lists: nothing here reads the grouped players, only how many share a key.
     Keeping the lists meant holding a second copy of the directory to answer `> 1`. */
  const bump = (map: Map<string, number>, key: string) =>
    map.set(key, (map.get(key) ?? 0) + 1);

  const keyed = players.map((player) => {
    const key = normalizeNameKey(player.displayName);
    const parts = key ? key.split(" ").filter(Boolean) : [];
    return { player, key, parts };
  });

  for (const { key, parts } of keyed) {
    if (!key) continue;
    bump(byName, key);
    const first = parts[0];
    const surname = parts.at(-1);
    if (!first || !surname) continue;
    bump(byFirstLast, `${first} ${surname}`);
    bump(bySurname, surname);
    if (parts.length === 2 && first !== surname) reversedSeen.add(`${surname} ${first}`);
  }

  const rows: NameQaRow[] = [];
  for (const { player, key, parts } of keyed) {
    const first = parts[0];
    const surname = parts.at(-1);
    const flags: string[] = [];
    if (parts.length < 2) flags.push(NAME_QA_FLAGS.incomplete);
    if ((byName.get(key) ?? 0) > 1) flags.push(NAME_QA_FLAGS.duplicate);
    if (first && surname && (byFirstLast.get(`${first} ${surname}`) ?? 0) > 1) {
      flags.push(NAME_QA_FLAGS.sameFirstLast);
    }
    if (surname && (bySurname.get(surname) ?? 0) > 1) flags.push(NAME_QA_FLAGS.sameSurname);
    if (reversedSeen.has(key)) flags.push(NAME_QA_FLAGS.swapped);
    if (/[^a-zA-Z\s.'-]/.test(player.displayName)) flags.push(NAME_QA_FLAGS.unusual);
    if (player.displayName.length <= 3 || parts.some((part) => part.length <= 1)) {
      flags.push(NAME_QA_FLAGS.tooShort);
    }
    if (flags.length) rows.push({ player, flags });
  }
  return rows;
}

export type NameQaFilters = { flag: string; teamId: string };

export const nameQaSearchText = (row: NameQaRow) => playerSearchText(row.player);

export function keepNameQaRow(f: NameQaFilters) {
  return (row: NameQaRow) => {
    if (f.flag && !row.flags.includes(f.flag)) return false;
    if (f.teamId && !row.player.teams.some((team) => team.teamId === f.teamId)) return false;
    return true;
  };
}

export function nameQaFlagOptionsFor(rows: readonly NameQaRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const flag of row.flags) seen.add(flag);
  return [...seen].sort();
}

/* ── Row identity ─────────────────────────────────────────────────────────── */

/**
 * The id a directory row is selected and deleted by.
 *
 * A squad row is the record this page edits and deletes -- the player profile behind it may be
 * shared by several clubs -- so the squad id is the identity, and a row with no squad row
 * behind it cannot be acted on at all.
 */
export function squadIdOf(player: AdminSbPlayerDirectoryRow): string | null {
  return player.teams[0]?.squadId ?? null;
}
