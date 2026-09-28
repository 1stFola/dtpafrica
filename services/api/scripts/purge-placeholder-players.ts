/**
 * Remove the player records that are not people.
 *
 *   pnpm --filter @dtp/api db:purge:placeholder-players          # report only
 *   pnpm --filter @dtp/api db:purge:placeholder-players --apply  # delete
 *
 * On live, the Ex Internationals Cup goal chart reads:
 *
 *   1. Farouk Salami   7
 *   2. Player          5   <-
 *   3. Alo Deji        4
 *   4. Unknown         4   <-
 *
 * Second place is nobody. `Player` and `Unknown` are what somebody wrote on a team
 * sheet when the scorer's name was not known, and `resolveOrCreatePlayer` turned
 * them into player records, which then collected goals like anyone else.
 *
 * The path that made them is guarded now (`src/players/placeholder-names.ts`), so
 * this is the clean-up rather than the fix.
 *
 * **Deleting is the honest outcome, and the cascades do the work.** A goal scored
 * by `Unknown` was never attributable; removing the record returns it to exactly
 * that state rather than inventing an owner:
 *
 *   - `SbMatchEvent.player` is `SetNull`, so the event survives with its label
 *     intact and no player — the same state as every other unattributed goal.
 *   - `SbPlayerCompetitionStats` cascades, so the phantom leaves the scoring chart.
 *   - `SbTeamSquad.player` is `SetNull`, so the squad row survives unlinked.
 *
 * Nothing is recomputed afterwards: the events lose their link and the stats row
 * goes with the player, so `db:report:player-stat-drift` stays balanced. Worth
 * re-running to confirm rather than taking on trust.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { isPlaceholderName } from "../src/players/placeholder-names";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(
    `Player records that are not people — ${APPLY ? "APPLYING" : "dry run, pass --apply to delete"}\n`
  );

  const players = await prisma.player.findMany({
    select: { id: true, displayName: true, slug: true, isPublic: true, createdAt: true },
  });
  const suspects = players.filter((p) => isPlaceholderName(p.displayName));

  console.log(`  ${players.length} player records scanned`);
  console.log(`  ${suspects.length} whose name is a placeholder\n`);

  if (!suspects.length) {
    console.log("No placeholder player records. Nothing to do.");
    return;
  }

  let totalGoals = 0;
  let totalEvents = 0;
  const detail: { id: string; line: string }[] = [];

  for (const p of suspects) {
    const [goals, assists, stats, squads] = await Promise.all([
      prisma.sbMatchEvent.count({
        where: { playerId: p.id, type: { in: ["goal", "goal_penalty"] } },
      }),
      prisma.sbMatchEvent.count({ where: { assistPlayerId: p.id, type: "goal" } }),
      prisma.sbPlayerCompetitionStats.aggregate({
        where: { playerId: p.id },
        _sum: { goals: true, assists: true },
      }),
      prisma.sbTeamSquad.count({ where: { playerId: p.id } }),
    ]);
    totalGoals += stats._sum.goals ?? 0;
    totalEvents += goals + assists;
    detail.push({
      id: p.id,
      line:
        `  "${p.displayName}" /${p.slug}\n` +
        `      ${goals} goal(s) and ${assists} assist(s) in events, ` +
        `${stats._sum.goals ?? 0}g/${stats._sum.assists ?? 0}a on the scoring charts, ` +
        `in ${squads} squad(s)`,
    });
  }

  for (const d of detail.slice(0, 40)) console.log(d.line);
  if (detail.length > 40) console.log(`  … and ${detail.length - 40} more`);

  console.log(
    `\n  ${totalGoals} phantom goal(s) would leave the scoring charts.\n` +
      `  ${totalEvents} event(s) would keep their label and go back to having no player,\n` +
      `  which is what they always were.`
  );

  if (!APPLY) {
    console.log("\n" + "-".repeat(64));
    console.log("Nothing was deleted. Re-run with --apply.");
    return;
  }

  const removed = await prisma.player.deleteMany({
    where: { id: { in: suspects.map((s) => s.id) } },
  });

  const left = (
    await prisma.player.findMany({ select: { id: true, displayName: true } })
  ).filter((p) => isPlaceholderName(p.displayName));

  console.log("\n" + "-".repeat(64));
  console.log(`Deleted ${removed.count} placeholder player record(s).`);
  console.log(`  placeholder records remaining: ${left.length}`);
  console.log(
    "\nRe-run db:report:player-stat-drift to confirm the totals still balance:\n" +
      "  the events lost their link and the stats rows went with the player, so it\n" +
      "  should still read 0 behind and 0 ahead."
  );
  if (left.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
