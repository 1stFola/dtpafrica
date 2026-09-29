/**
 * Give a name back to the goals that currently reach nobody.
 *
 *   pnpm --filter @dtp/api db:dedupe:squad-members          # report only
 *   pnpm --filter @dtp/api db:dedupe:squad-members --apply  # write
 *
 * `db:sync:event-player-links` refuses to attribute a goal when more than one
 * player in the team answers to the name on it. On live that is 106 goal and assist
 * labels reaching nobody: they show on the fixture and never appear on the scorer's
 * profile or in the stat leaders.
 *
 * Every one of those squads holds the same person twice, under two spellings of
 * their name. The sync already registers a reversed alias for each squad name, so
 * `Abubakar Abdullah` covers `Abdullah Abubakar` by itself — remove the second
 * record from that squad and the name resolves to one player again.
 *
 * **What it changes, exactly.** For the record that loses the place: its
 * `SbTeamSquad` row for that team is deleted, and its match-squad entries for that
 * team are re-pointed at the record that keeps it. Nothing else. The player row
 * survives, every goal already attributed to it stays attributed to it, and no
 * lineup entry is removed — a match squad still lists the same number of people.
 *
 * Both tables are handled because the sync builds its per-team index from both; a
 * record removed from the squad but still named in a match squad would keep the
 * name ambiguous and the goals unattributed.
 *
 * **It is not a merge.** A player whose history is split across two records still
 * has it split afterwards. What this recovers is the goals attributed to *neither*.
 * Consolidating the records is a separate decision, and
 * `db:report:duplicate-players` is its worklist.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { reorderKey } from "../src/players/duplicate-detection";
import { planSquadDedupe, type SquadMember } from "./squad-duplicate-plan";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** The same rule the duplicate report uses, so the two cannot disagree. */
const samePerson = (a: string, b: string) => reorderKey(a) === reorderKey(b);

async function main() {
  console.log(
    `Squad members that are the same person — ${APPLY ? "APPLYING" : "dry run, pass --apply to write"}\n`
  );

  const rows = await prisma.sbTeamSquad.findMany({
    where: { playerId: { not: null } },
    select: {
      id: true,
      teamId: true,
      displayName: true,
      playerId: true,
      team: { select: { name: true } },
      player: { select: { id: true, createdAt: true, playerPhotoUrl: true, academyId: true } },
    },
  });

  const playerIds = [...new Set(rows.map((r) => r.playerId!))];
  const [goals, assists] = await Promise.all([
    prisma.sbMatchEvent.groupBy({
      by: ["playerId"],
      where: { playerId: { in: playerIds } },
      _count: { _all: true },
    }),
    prisma.sbMatchEvent.groupBy({
      by: ["assistPlayerId"],
      where: { assistPlayerId: { in: playerIds } },
      _count: { _all: true },
    }),
  ]);
  const eventsBy = new Map<string, number>();
  for (const g of goals) eventsBy.set(g.playerId!, (eventsBy.get(g.playerId!) ?? 0) + g._count._all);
  for (const a of assists) {
    eventsBy.set(a.assistPlayerId!, (eventsBy.get(a.assistPlayerId!) ?? 0) + a._count._all);
  }

  const members: SquadMember[] = rows.map((r) => ({
    squadRowId: r.id,
    teamId: r.teamId,
    teamName: r.team.name,
    playerId: r.playerId!,
    displayName: r.displayName,
    events: eventsBy.get(r.playerId!) ?? 0,
    hasProfile: Boolean(r.player?.playerPhotoUrl || r.player?.academyId),
    playerCreatedAt: r.player?.createdAt ?? new Date(0),
  }));

  const plans = planSquadDedupe(members, samePerson);

  console.log(`  ${rows.length} squad memberships across ${new Set(rows.map((r) => r.teamId)).size} teams`);
  console.log(`  ${plans.length} squad(s) holding one person more than once`);
  console.log(`  ${plans.reduce((n, p) => n + p.drop.length, 0)} membership(s) to remove\n`);

  if (!plans.length) {
    console.log("No squad holds the same person twice. Nothing to do.");
    return;
  }

  for (const plan of plans) {
    console.log(`  ${plan.teamName}`);
    console.log(`     keep  ${plan.keeper.displayName.padEnd(26)} ${plan.why}`);
    for (const d of plan.drop) {
      const carries = d.events ? `${d.events} event(s) stay on it` : "nothing attached";
      console.log(`     drop  ${d.displayName.padEnd(26)} ${carries}`);
    }
  }

  if (!APPLY) {
    console.log("\n" + "-".repeat(64));
    console.log(
      "Nothing was written. Re-run with --apply, then run\n" +
        "db:sync:event-player-links -- --apply to attach the goals this frees."
    );
    return;
  }

  let removed = 0;
  let repointed = 0;
  for (const plan of plans) {
    for (const drop of plan.drop) {
      /* The match-squad entries move first. If this failed after the squad row was
         already gone, the name would be ambiguous *and* the lineup would point at a
         record no longer in the squad — worse than either alone. */
      const moved = await prisma.sbMatchSquadPlayer.updateMany({
        where: { teamId: plan.teamId, playerId: drop.playerId },
        data: { playerId: plan.keeper.playerId, squadId: plan.keeper.squadRowId },
      });
      repointed += moved.count;

      await prisma.sbTeamSquad.delete({ where: { id: drop.squadRowId } });
      removed += 1;
    }
  }

  console.log("\n" + "-".repeat(64));
  console.log(
    `Removed ${removed} duplicate membership(s) and moved ${repointed} lineup entr(ies) ` +
      `to the record that kept the place.`
  );
  console.log(
    "\nNow run: db:sync:event-player-links -- --apply\n" +
      "Those names resolve to one player again, so the goals that reached nobody\n" +
      "can be attached."
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
