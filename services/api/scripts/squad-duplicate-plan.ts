/**
 * Deciding which of two duplicate records should hold a place in a squad.
 *
 * `db:sync:event-player-links` refuses to attribute a goal when more than one
 * player in the team answers to the name on it. On live that is 106 goal and assist
 * labels reaching nobody — they show on the fixture and never appear on a profile
 * or in the stat leaders.
 *
 * The cause is a squad holding the same person twice under two spellings, and the
 * cure is cheaper than a merge. The sync already registers a reversed alias for
 * every squad name, so `Abubakar Abdullah` covers `Abdullah Abubakar` on its own.
 * Remove the second record from that squad and the name resolves to one player
 * again, with nothing deleted but a membership row.
 *
 * **This is not a merge, and does not pretend to be.** Goals already linked to the
 * losing record stay linked to it, so a player whose history is split across two
 * profiles still has it split afterwards. What changes is that the *unattributed*
 * goals find a home. Consolidating the two records is a separate decision, and
 * `db:report:duplicate-players` is its worklist.
 */

export type SquadMember = {
  /** The `SbTeamSquad` row, which is the only thing that gets removed. */
  squadRowId: string;
  teamId: string;
  teamName: string;
  playerId: string;
  /** The name on the squad row, which is what the sync indexes. */
  displayName: string;
  /** Goals and assists already attributed to this record. */
  events: number;
  hasProfile: boolean;
  playerCreatedAt: Date;
};

export type SquadDedupe = {
  teamId: string;
  teamName: string;
  keeper: SquadMember;
  drop: SquadMember[];
  why: string;
};

/**
 * Which record keeps the place.
 *
 * In order: the one carrying more history, then the one with a real profile, then
 * the older record. Every step is a tie-break rather than a judgement about which
 * person is real — they are the same person — so the last resort is the id, which
 * makes the choice deterministic rather than dependent on row order.
 */
function pickKeeper(members: SquadMember[]): { keeper: SquadMember; why: string } {
  const sorted = [...members].sort(
    (a, b) =>
      b.events - a.events ||
      Number(b.hasProfile) - Number(a.hasProfile) ||
      a.playerCreatedAt.getTime() - b.playerCreatedAt.getTime() ||
      a.playerId.localeCompare(b.playerId)
  );
  const keeper = sorted[0]!;
  const rest = sorted.slice(1);
  const why =
    keeper.events > (rest[0]?.events ?? -1)
      ? `carries ${keeper.events} event(s), the others ${rest.map((r) => r.events).join("/")}`
      : keeper.hasProfile && !rest.some((r) => r.hasProfile)
        ? "the only one with a real profile"
        : "nothing to choose between them, so the older record keeps the place";
  return { keeper, why };
}

/**
 * Squads holding one person under more than one record.
 *
 * `sameperson` decides which members are the same human; it is passed in rather
 * than reimplemented so this and `db:report:duplicate-players` can never disagree
 * about what a duplicate is.
 */
export function planSquadDedupe(
  members: SquadMember[],
  samePerson: (a: string, b: string) => boolean
): SquadDedupe[] {
  const byTeam = new Map<string, SquadMember[]>();
  for (const m of members) byTeam.set(m.teamId, [...(byTeam.get(m.teamId) ?? []), m]);

  const plans: SquadDedupe[] = [];
  for (const [teamId, roster] of byTeam) {
    const grouped: SquadMember[][] = [];
    for (const member of roster) {
      const group = grouped.find((g) => samePerson(g[0]!.displayName, member.displayName));
      if (group) group.push(member);
      else grouped.push([member]);
    }

    for (const group of grouped) {
      /* Distinct *players*, not distinct rows. One player listed twice in a squad is
         a different fault, and `db:repair:squad-duplicates` already handles it. */
      const players = new Set(group.map((m) => m.playerId));
      if (players.size < 2) continue;

      const { keeper, why } = pickKeeper(group);
      plans.push({
        teamId,
        teamName: keeper.teamName,
        keeper,
        drop: group.filter((m) => m.playerId !== keeper.playerId),
        why,
      });
    }
  }

  return plans.sort(
    (a, b) =>
      b.drop.length - a.drop.length || a.teamName.localeCompare(b.teamName)
  );
}
