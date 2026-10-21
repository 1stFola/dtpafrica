import { playerLookupKey } from "@dtp/engines";
import { stripNumberPrefix } from "../players/admissible-squad-name";
import { isPlaceholderName } from "../players/placeholder-names";

/**
 * The name a stat leader goes by.
 *
 * A match sheet publishes each event's player as `No. 8 tajudeen fawaz`: the number the
 * recorder tapped, then the name the squad holds for it. The chart showed that whole, with
 * an `N8` avatar -- `No. 8 tajudeen fawaz` sat top of the 1XCup goals chart. It arrives two
 * ways. Unlinked, the event carries only the label. Linked, it can be worse: a player record
 * was once created from such a label and kept the number in its `displayName` (see
 * `numbered-duplicates.ts`), so the record itself reads `No. 11 EBULU EMMANUEL`.
 *
 * The number is what was tapped, not part of anybody's name, so it comes off either way, as
 * it already does on the timeline and the Top Scorers list. The record's slug is left alone:
 * the link has to reach the record that exists.
 *
 * Null for a label that names nobody once the number is gone: `Unknown`, `Player`, or a
 * bare `No. 8` with no squad row behind it.
 */
export function statLeaderName(
  player: { displayName: string } | null | undefined,
  label: string | null | undefined
): string | null {
  const name = stripNumberPrefix((player?.displayName ?? label)?.trim() ?? "").trim();
  if (!name || isPlaceholderName(name) || !/\p{L}/u.test(name)) return null;
  return name;
}

type LeaderRow = {
  playerId: string | null;
  playerName: string;
  playerSlug: string;
  team: { id: string } | null;
  count: number;
};

/** `no-11-ebulu-emmanuel`: a record whose slug was made from a numbered name. */
const NUMBERED_SLUG = /^(?:no-)?\d{1,3}-/;

/**
 * One row per name per team.
 *
 * With the number gone, one scorer can reach the chart two or three times: as a clean
 * record, as a numbered record created from a label (`No. 16 Musa Abdul`, the pair
 * `db:merge:numbered-duplicates` folds), and as a bare name from matches where the squad
 * row was never linked. Same team and same name is the same person -- the rule that script
 * applies -- so the counts are added together.
 *
 * The row kept is the one worth linking to: a record over a bare name, and a record with a
 * clean slug over a numbered one.
 */
export function mergeSameNameLeaders<T extends LeaderRow>(rows: T[]): T[] {
  const rank = (row: T) => (row.playerId ? (NUMBERED_SLUG.test(row.playerSlug) ? 1 : 2) : 0);
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.team?.id ?? "free"}::${playerLookupKey(row.playerName)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((group) => {
    const owner = group.reduce((best, row) => (rank(row) > rank(best) ? row : best));
    return { ...owner, count: group.reduce((sum, row) => sum + row.count, 0) };
  });
}
