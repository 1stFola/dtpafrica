/**
 * Attach this match's goals to the people their labels name, as the sheet is approved.
 *
 * A published event gets its player from the squad row the recorder picked:
 * `playerId: squadFor(event)?.playerId ?? null`. When that row is **not linked to a player
 * record** — which is most rows created by a CSV import, and every row
 * `db:sync:squad-from-timeline` adds before staff fill it in — the label is written as the
 * bare name and the goal reaches nobody.
 *
 * On live that was 88 goals, `Farouk Salami` holding seven of them while his profile showed
 * none. `db:link:unattributed-goals` cleared the backlog; this is the guard that stops it
 * re-forming, in the same place `addSquadMembersFromTimeline` already runs — after the
 * publish transaction, because the people it needs may have been created by that very call.
 *
 * **Same rule as the script**, through the same planner, so the two cannot drift: the label
 * must name a person (`admitSquadName`), exactly one directory record may hold that name,
 * and the link is only ever written where the event has none. Nothing is overwritten and
 * nothing is deleted, so a wrong link is undone by clearing one column.
 */
import { playerLookupKey } from "@dtp/engines";
import { planGoalLinks, type DirectoryPlayer } from "../players/unattributed-goals";

/** The goal types the ScoreBoard counts, mirroring `repair-player-stats`. */
const GOAL_TYPES = ["goal", "goal_penalty", "own_goal"];

type Db = {
  sbMatchEvent: {
    findMany: (args: unknown) => Promise<
      { id: string; matchId: string; teamId: string | null; playerLabel: string | null }[]
    >;
    update: (args: unknown) => Promise<unknown>;
  };
  player: {
    findMany: (args: unknown) => Promise<{ id: string; displayName: string }[]>;
  };
};

/**
 * Link what can be linked for one match. Returns how many were attached.
 *
 * Scoped to the match being published: the backlog across every other fixture is the
 * script's job, and a publish should not quietly rewrite matches nobody asked about.
 */
export async function linkMatchGoals(db: Db, matchId: string): Promise<number> {
  const events = await db.sbMatchEvent.findMany({
    where: {
      matchId,
      type: { in: GOAL_TYPES },
      playerId: null,
      playerLabel: { not: null },
    },
    select: { id: true, matchId: true, teamId: true, playerLabel: true },
  });
  if (!events.length) return 0;

  /* Only the names these labels could be. Reading the whole directory on every approval
     would be a table scan per published sheet. */
  const keys = new Set(events.map((e) => playerLookupKey(e.playerLabel ?? "")).filter(Boolean));
  const people = await db.player.findMany({
    where: { normalizedName: { in: [...keys] } },
    select: { id: true, displayName: true },
  });
  if (!people.length) return 0;

  /* Team ties are not loaded: `planGoalLinks` reports them, and does not require them --
     the directory holds one record per name, which is what the link rests on. Leaving them
     empty costs the report nothing here, because nothing reads it. */
  const directory: DirectoryPlayer[] = people.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    teamIds: [],
    eventTeamIds: [],
  }));

  const plan = planGoalLinks(
    events.map((e) => ({
      eventId: e.id,
      matchId: e.matchId,
      teamId: e.teamId,
      label: e.playerLabel ?? "",
    })),
    directory
  );

  for (const link of plan.links) {
    await db.sbMatchEvent.update({
      where: { id: link.goal.eventId },
      /* The label stays as the recorder wrote it. The link is the new fact. */
      data: { playerId: link.player.id },
    });
  }
  return plan.links.length;
}
