/**
 * Turning the shirt number a recorder typed into the player who wore it.
 *
 * The recorder console captures a number, not a name: at pitchside `7` is quick and
 * `Ogundeji Elijah` is not. Everything downstream — the timeline label, the link to a
 * player record, the goal on a profile — depends on resolving that number afterwards.
 *
 * **The bug this replaces.** Three places did this lookup, each against
 * `SbMatchSquadPlayer` alone — the matchday squad, entered per fixture. Most fixtures
 * have no matchday squad, so the number resolved to nothing, the label fell back to
 * `No. 7`, and `playerId` was left null. The names were in `SbTeamSquad` all along, a
 * table nothing consulted. A goal recorded correctly against number 7 reached no
 * profile and no scoring chart, and the timeline showed a number where a person should
 * be.
 *
 * **Precedence is the team squad, then the matchday squad.** That is a deliberate
 * choice and worth naming, because the other order is defensible: a matchday lineup is
 * specific to one fixture, so a guest wearing 7 for a single game is described by it
 * and not by the standing squad. Resolving from the team squad first overrules that.
 * Conflicts are therefore collected rather than swallowed — `conflicts` lists every
 * number the two sources disagree about, so a fixture where it mattered can be found.
 *
 * **One module, both ends.** This lives in `@dtp/engines` so the recorder console and
 * the API run the same function. The console used to carry its own copy that let the
 * last row win, so it showed `No. 9 Oghidi Kelvin` for a number the API -- seeing two
 * players on 9 -- published as `No. 9`. The auto-approval held that sheet back for a
 * missing name the recorder could not see was missing.
 *
 * **An ambiguous number resolves to nobody.** Two squad rows sharing number 7 make the
 * number meaningless, and picking whichever row the database returned first would
 * attribute a goal by accident and look deliberate. The next source is tried instead,
 * and if that cannot resolve it either the number is reported and left alone.
 */

import { playerLookupKey } from "./normalize-player-name";

export type SquadRow = {
  teamId: string;
  number: number | null;
  playerName: string;
  playerId: string | null;
};

export type NumberConflict = {
  teamId: string;
  number: number;
  /** What the team squad says, which wins. */
  fromTeamSquad: string;
  /** What the matchday squad says, which is recorded and not used. */
  fromMatchSquad: string;
};

export type AmbiguousNumber = {
  teamId: string;
  number: number;
  source: "team" | "matchday";
  /** Every name holding it, so the duplicate can be found and fixed. */
  names: string[];
};

/**
 * What a number resolves to, with the reason when it resolves to nobody: nobody in the
 * squad wears it, or more than one person does and the lookup will not guess.
 */
export type NumberResolution =
  | { kind: "named"; player: SquadRow }
  | { kind: "shared"; names: string[] }
  | { kind: "unknown" };

export type NumberLookup = {
  /** The player wearing this number, or undefined when nothing can say. */
  find: (teamId: string, number: number | null | undefined) => SquadRow | undefined;
  /** `find`, with the reason when it finds nobody. */
  resolve: (teamId: string, number: number | null | undefined) => NumberResolution;
  conflicts: NumberConflict[];
  ambiguous: AmbiguousNumber[];
};

const key = (teamId: string, number: number) => `${teamId}:${number}`;

/**
 * Two squad rows are the same person when their names hold the same words, in any
 * order and any case.
 *
 * Order matters because squads are typed by different people from different sheets:
 * `YUSUF OLASUNKANMI` from a registration list and `Olasunkanmi Yusuf` from a team
 * sheet are one boy, and on live they both held HIGHKLASS SA's 7 -- which made 7 read
 * as two players and left his goals unnamed. Two different players on one team, on one
 * shirt number, whose names are the same words reordered, is not a case worth guarding.
 *
 * Spelling is not forgiven: `Sulainon Taiye` and `Taiye Sulaimon` stay two people,
 * because a one-letter guess is how a goal gets attributed by accident.
 */
export function samePersonKey(name: string): string {
  const k = playerLookupKey(name);
  return (k || name.trim().toLowerCase()).split(" ").filter(Boolean).sort().join(" ");
}

/**
 * Index one source, keeping only the numbers exactly one player holds.
 *
 * A number held twice is deliberately dropped rather than resolved to the first row:
 * see the module note. Both the index and the rejects are returned, because a
 * duplicate shirt number is a squad worth fixing and silence would hide it.
 */
function indexOne(rows: SquadRow[], source: "team" | "matchday") {
  const byNumber = new Map<string, SquadRow[]>();
  for (const row of rows) {
    if (row.number == null || row.number <= 0) continue;
    const k = key(row.teamId, row.number);
    const held = byNumber.get(k);
    if (held) held.push(row);
    else byNumber.set(k, [row]);
  }

  const resolved = new Map<string, SquadRow>();
  const ambiguous: AmbiguousNumber[] = [];
  for (const [k, held] of byNumber) {
    const first = held[0]!;
    /* Two rows for the same person are not an ambiguity. The squad can legitimately
       hold a player twice — that is what `db:dedupe:squad-members` exists for — and
       refusing to resolve the number would punish the recorder for it.

       Compared on the **name key** and not on `playerId ?? name`. That earlier
       expression mixed two key spaces: a linked row keyed by uuid and an unlinked row
       for the same person keyed by name could never match, so every number held by
       one linked and one unlinked row read as two different people. On live that was
       nine numbers in one fixture -- `SAMUEL OSBERT / Samuel Osbert`,
       `Adeyemo Samson / ADEYEMO SAMSON` -- each a single player in two spellings, and
       the comment above already said they should not count. */
    /* By `samePersonKey`, so a name typed surname-first is the same person too. */
    const people = new Map<string, string>();
    for (const r of held) {
      const k = samePersonKey(r.playerName);
      if (!people.has(k)) people.set(k, r.playerName);
    }
    if (people.size > 1) {
      ambiguous.push({
        teamId: first.teamId,
        number: first.number!,
        source,
        /* One spelling per person, so the console can say "two players" and mean it. */
        names: [...people.values()],
      });
      continue;
    }
    /* Among rows for one person, the linked one wins. Both names are equally correct,
       but only a row with a `playerId` gets the goal onto a profile -- and the linked
       row is also the one whose name the display-name tools have been tidying, so
       `Samuel Osbert` beats `SAMUEL OSBERT` for free. */
    resolved.set(k, held.find((r) => r.playerId) ?? first);
  }

  return { resolved, ambiguous };
}

export function buildNumberLookup(args: {
  teamSquad: SquadRow[];
  matchSquad: SquadRow[];
}): NumberLookup {
  const team = indexOne(args.teamSquad, "team");
  const matchday = indexOne(args.matchSquad, "matchday");

  const conflicts: NumberConflict[] = [];
  for (const [k, teamRow] of team.resolved) {
    const matchRow = matchday.resolved.get(k);
    if (!matchRow) continue;
    const same =
      teamRow.playerId && matchRow.playerId
        ? teamRow.playerId === matchRow.playerId
        : teamRow.playerName.trim().toLowerCase() === matchRow.playerName.trim().toLowerCase();
    if (!same) {
      conflicts.push({
        teamId: teamRow.teamId,
        number: teamRow.number!,
        fromTeamSquad: teamRow.playerName,
        fromMatchSquad: matchRow.playerName,
      });
    }
  }

  const find: NumberLookup["find"] = (teamId, number) => {
    if (number == null || number <= 0) return undefined;
    const k = key(teamId, number);
    /* Team squad first, matchday second. When the preferred source cannot resolve
       the number -- it has no row, or two players hold it -- the other is tried
       rather than giving up, because a name from either beats `No. 7`. */
    return team.resolved.get(k) ?? matchday.resolved.get(k);
  };

  const ambiguous = [...team.ambiguous, ...matchday.ambiguous];
  return {
    find,
    resolve: (teamId, number) => {
      const player = find(teamId, number);
      if (player) return { kind: "named", player };
      if (number == null || number <= 0) return { kind: "unknown" };
      /* Unresolved, so any source that holds the number holds it twice. The team
         squad's names first, as that is the source the lookup prefers. */
      const shared = ambiguous.find((a) => a.teamId === teamId && a.number === number);
      return shared ? { kind: "shared", names: shared.names } : { kind: "unknown" };
    },
    conflicts,
    ambiguous,
  };
}

/**
 * The timeline label for a number, unchanged from what the three call sites built.
 *
 * `No. 7 Ogundeji Elijah` rather than either alone: the number is what the recorder
 * entered and what a match report is checked against, and the front end strips the
 * prefix for display. A bare `No. 7` remains the honest answer when nothing resolved
 * it — it says what was known, which is the number and not a person.
 */
export function squadNumberLabel(
  player: { playerName: string } | undefined,
  number: number | null | undefined
): string | null {
  if (player?.playerName && number) return `No. ${number} ${player.playerName}`;
  if (player?.playerName) return player.playerName;
  return number ? `No. ${number}` : null;
}
