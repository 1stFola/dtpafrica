/**
 * Attach the goals whose label names somebody the directory already holds.
 *
 *   pnpm --filter @dtp/api db:link:unattributed-goals          # report only
 *   pnpm --filter @dtp/api db:link:unattributed-goals --apply  # link
 *
 * On live, 88 goals carry a label and no player, so they reach nobody's profile. About
 * sixty of those are unrecoverable — `Unknown` twenty-one times, `Player` ten, bare shirt
 * numbers roughly thirty — and the rest are real names, `Farouk Salami` alone with seven.
 *
 * Those names are already in the directory. They went unlinked because an event's label is
 * resolved against the squad of the team it belongs to, and a boy who was never added to
 * that team sheet resolves to nothing.
 *
 * **The evidence rule is the one that worked for numbered duplicates.** A name match alone
 * is not enough: names repeat, and a wrong goal on a profile is worse than a missing one,
 * because a missing goal is merely absent while a wrong one is invisible. So the named
 * player must also have played for the team the goal was scored for — by a squad row, or by
 * their own events. Two players of that name tied to the same team is refused outright.
 *
 * **Reversible, unlike the merges.** This writes `playerId` on an event and nothing else:
 * no record is deleted, and a wrong link is undone by clearing that column. That is why it
 * can act where the merge tools ask for a human — and it is still report-first, because a
 * goal on the wrong profile is the kind of error nobody reports.
 *
 * The label itself is left exactly as the recorder wrote it. The link is the new fact; the
 * label is the record of what was written, and overwriting it would lose that.
 *
 * Run `db:repair:player-stats` afterwards: a newly linked goal is a goal the competition
 * rows have never counted.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import {
  planGoalLinks,
  type DirectoryPlayer,
  type UnattributedGoal,
  type UnlinkedGoal,
} from "../src/players/unattributed-goals";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** The goal types the ScoreBoard counts. Mirrors `repair-player-stats`. */
const GOAL_TYPES = ["goal", "goal_penalty", "own_goal"];

const REASONS: Record<UnlinkedGoal["reason"], string> = {
  "not-a-name": "the label names nobody — Unknown, Player, or a bare shirt number",
  "nobody-by-that-name": "no directory player holds that name",
  "several-of-that-name": "two records hold that name — merge them first, then re-run",
};

async function main() {
  console.log(
    `Goals whose label names a player — ${APPLY ? "APPLYING" : "dry run, pass --apply to link"}\n`
  );

  const events = await prisma.sbMatchEvent.findMany({
    where: { type: { in: GOAL_TYPES }, playerId: null, playerLabel: { not: null } },
    select: { id: true, matchId: true, teamId: true, playerLabel: true },
  });
  const goals: UnattributedGoal[] = events.map((e) => ({
    eventId: e.id,
    matchId: e.matchId,
    teamId: e.teamId,
    label: e.playerLabel ?? "",
  }));

  const [players, squadRows, eventRows, teams] = await Promise.all([
    prisma.player.findMany({ select: { id: true, displayName: true } }),
    prisma.sbTeamSquad.findMany({
      where: { playerId: { not: null } },
      select: { playerId: true, teamId: true },
    }),
    prisma.sbMatchEvent.findMany({
      where: { teamId: { not: null }, playerId: { not: null } },
      select: { teamId: true, playerId: true },
    }),
    prisma.sbTeam.findMany({ select: { id: true, name: true } }),
  ]);

  const collect = (rows: { playerId: string | null; teamId: string | null }[]) => {
    const map = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.playerId || !row.teamId) continue;
      const held = map.get(row.playerId);
      if (held) {
        if (!held.includes(row.teamId)) held.push(row.teamId);
      } else {
        map.set(row.playerId, [row.teamId]);
      }
    }
    return map;
  };
  const squadTeams = collect(squadRows);
  const eventTeams = collect(eventRows);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  const directory: DirectoryPlayer[] = players.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    teamIds: squadTeams.get(p.id) ?? [],
    eventTeamIds: eventTeams.get(p.id) ?? [],
  }));

  const plan = planGoalLinks(goals, directory);

  console.log(`  ${goals.length} goal(s) with a label and no player`);
  console.log(`  ${plan.links.length} name a player who plays for the team that scored`);
  console.log(`  ${plan.unlinked.length} stay as they are\n`);

  if (plan.links.length) {
    /* Grouped by player, because the interesting fact is "this boy is missing seven goals",
       not "here are seven rows". */
    const byPlayer = new Map<string, { player: DirectoryPlayer; count: number; evidence: Set<string> }>();
    for (const link of plan.links) {
      const held = byPlayer.get(link.player.id) ?? {
        player: link.player,
        count: 0,
        evidence: new Set<string>(),
      };
      held.count += 1;
      held.evidence.add(link.evidence);
      byPlayer.set(link.player.id, held);
    }

    console.log(`To link (${plan.links.length} goal(s), ${byPlayer.size} player(s))`);
    console.log("-".repeat(76));
    console.log(
      "  The label names exactly one player in the directory, and the directory holds one\n" +
        "  record per name — normalizedName is unique, so there is no second Farouk Salami\n" +
        "  to confuse him with.\n\n" +
        "  Where that record is also tied to the club that scored, it says so. A link marked\n" +
        "  name-only rests on the directory being a directory and nothing more, which is the\n" +
        "  same basis db:sync:squad-from-timeline already resolves labels on.\n"
    );
    for (const row of [...byPlayer.values()].sort((a, b) => b.count - a.count)) {
      console.log(
        `  ${row.player.displayName.slice(0, 34).padEnd(36)} +${String(row.count).padStart(2)} goal(s)` +
          `   (tied by ${[...row.evidence].join(" and ")})`
      );
    }
    console.log("");
  }

  const byReason = new Map<UnlinkedGoal["reason"], UnlinkedGoal[]>();
  for (const row of plan.unlinked) {
    const held = byReason.get(row.reason);
    if (held) held.push(row);
    else byReason.set(row.reason, [row]);
  }

  if (byReason.size) {
    console.log(`Staying as they are (${plan.unlinked.length})`);
    console.log("-".repeat(76));
    for (const [reason, rows] of byReason) {
      console.log(`  ${rows.length.toString().padStart(3)}  ${REASONS[reason]}`);
      /* The labels are worth seeing for the reasons a human can act on, and noise for the
         ones nobody can: nothing is gained by printing `Unknown` twenty-one times. */
      if (reason === "several-of-that-name" || reason === "nobody-by-that-name") {
        for (const row of rows.slice(0, 15)) {
          const where = teamName.get(row.goal.teamId ?? "") ?? row.goal.teamId ?? "no team";
          console.log(`         ${row.goal.label.slice(0, 30).padEnd(32)} scored for ${where}`);
        }
        if (rows.length > 15) console.log(`         … and ${rows.length - 15} more`);
      }
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("-".repeat(76));
    console.log("Nothing was written. Re-run with --apply.");
    console.log(
      "A link is reversible — it sets player_id on the event and nothing else — but a goal\n" +
        "on the wrong profile is the kind of error nobody reports, so read the list first.\n" +
        "Run db:repair:player-stats afterwards: a newly linked goal has never been counted."
    );
    return;
  }

  let linked = 0;
  for (const link of plan.links) {
    await prisma.sbMatchEvent.update({
      where: { id: link.goal.eventId },
      /* The label stays as the recorder wrote it. The link is the new fact; the label is the
         record of what was written, and overwriting it would lose that. */
      data: { playerId: link.player.id },
    });
    linked += 1;
  }

  const stillUnattributed = await prisma.sbMatchEvent.count({
    where: { type: { in: GOAL_TYPES }, playerId: null },
  });

  console.log("-".repeat(76));
  console.log(`Linked ${linked} goal(s).`);
  console.log(`  goals still reaching nobody: ${stillUnattributed}`);
  console.log("Run db:repair:player-stats next — these goals have never been counted.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
