/**
 * One person listed twice in the same squad.
 *
 * `Abubakar Abdullah` and `Abdullah Abubakar` in one squad are the same boy. Nigerian
 * records are written surname-first or given-name-first depending on who fills the form,
 * so both spellings end up as separate rows and often as separate `Player` records —
 * splitting his goals across two profiles, neither of which is right.
 *
 * `groupProbableDuplicates` already recognises this: same words, any order, casing and
 * punctuation ignored. What it has not been allowed to do is act, and the reason is
 * recorded in `merge-duplicate-players.ts`:
 *
 * > *"It will not touch a reversed pair like `Clems Henry` / `Henry Clems`: those have
 * > different canonical keys, both are valid, and deciding they are one person is a
 * > judgement this should not make on its own."*
 *
 * **Inside a single squad that judgement is safe, and that scoping is the whole basis
 * for it.** Across the directory, `Clems Henry` and `Henry Clems` could be two people on
 * two teams in two competitions. On one team sheet they are one player written down
 * twice — which is what `dedupe-squad-members.ts` found when it went looking for why 106
 * goals reached nobody.
 *
 * The residual risk is worth naming rather than burying: two genuinely different people
 * in one squad whose names are each other's reverse. Brothers, most plausibly. Nothing
 * here can tell that apart from the common case, so the dry run is where a human looks
 * before this is ever allowed to run unattended.
 */
import { groupProbableDuplicates, reorderKey } from "./duplicate-detection";

export type SquadMemberRow = {
  /** The `SbTeamSquad` row id. */
  rowId: string;
  teamId: string;
  playerId: string | null;
  /** The player's name when linked, otherwise the row's own. */
  name: string;
  /** How many match-squad entries hang off this row, used to pick which row survives. */
  matchSquadCount: number;
  /** Whether the player record looks filled in, for `chooseMergeTarget`. */
  hasProfile: boolean;
  slug: string | null;
  createdAt: Date;
};

export type SquadDuplicate = {
  teamId: string;
  /** The sorted-words key the group shares. */
  key: string;
  /** Every spelling seen, for the report. */
  names: string[];
  /** Distinct player records in the group. Two or more means a merge. */
  playerIds: string[];
  /** Squad rows in the group, the survivor first. */
  rows: SquadMemberRow[];
  /** Rows to delete once the merge is done: every row but the survivor. */
  redundantRowIds: string[];
};

/**
 * Which row survives when one person holds several in a team.
 *
 * The row carrying match-squad entries wins, because those are lineups somebody filed
 * and re-pointing them is work this can avoid. Then the linked row over an unlinked one,
 * then the older, then the lower id — so the answer never depends on the order rows come
 * back in. A tool that picks differently each run is one nobody can check.
 */
function rankRows(rows: SquadMemberRow[]): SquadMemberRow[] {
  return [...rows].sort(
    (a, b) =>
      b.matchSquadCount - a.matchSquadCount ||
      Number(Boolean(b.playerId)) - Number(Boolean(a.playerId)) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.rowId.localeCompare(b.rowId)
  );
}

/**
 * Find every squad holding one person more than once.
 *
 * Grouped per team, never across teams: the same two spellings on two different teams
 * are two people until something else says otherwise.
 */
export function planSquadDuplicates(rows: SquadMemberRow[]): SquadDuplicate[] {
  const byTeam = new Map<string, SquadMemberRow[]>();
  for (const row of rows) {
    if (!row.name.trim()) continue;
    const list = byTeam.get(row.teamId) ?? [];
    list.push(row);
    byTeam.set(row.teamId, list);
  }

  const out: SquadDuplicate[] = [];
  for (const [teamId, teamRows] of byTeam) {
    /* Keyed by row id rather than player id, so two rows for one player — or two
       unlinked rows — group together as readily as two separate records do. */
    const groups = groupProbableDuplicates(
      teamRows.map((row) => ({ id: row.rowId, displayName: row.name }))
    );

    for (const group of groups) {
      const groupRows = group.members
        .map((m) => teamRows.find((row) => row.rowId === m.id))
        .filter((row): row is SquadMemberRow => Boolean(row));
      if (groupRows.length < 2) continue;

      const ranked = rankRows(groupRows);
      out.push({
        teamId,
        key: group.key,
        names: [...new Set(groupRows.map((row) => row.name))],
        playerIds: [...new Set(groupRows.map((row) => row.playerId).filter((id): id is string => Boolean(id)))],
        rows: ranked,
        redundantRowIds: ranked.slice(1).map((row) => row.rowId),
      });
    }
  }

  return out;
}

/** Re-exported so callers do not reach past this module for the rule it is built on. */
export { reorderKey };
