/**
 * Fold the records whose name absorbed a shirt number into the record that holds the name.
 *
 *   pnpm --filter @dtp/api db:merge:numbered-duplicates          # report only
 *   pnpm --filter @dtp/api db:merge:numbered-duplicates --apply  # merge
 *
 * `No. 16 Musa Abdul` and `Musa Abdul` are one boy. The first was created from a timeline
 * label before anybody linked it, and the shirt number came along into `displayName`.
 *
 * **These are the 47 that `db:repair:player-display-names` blocks**, and nothing folded
 * them until this existed. Its advice was to run `db:merge:duplicate-players` first, which
 * cannot help: that tool groups on `playerLookupKey`, and `"no 16 musa abdul"` is not
 * `"musa abdul"`. The keys differing is precisely why the unique index tolerates both
 * records, and why the tidy is blocked rather than the write failing.
 *
 * **A shared team is required, and that is the whole safety argument.** Two boys can share
 * a name, so `No. 4 Alfred Isaac` at one club is not necessarily the `Alfred Isaac` at
 * another. Within one squad, a shirt number in front of a squad-mate's name is bookkeeping
 * — the same reasoning that lets `db:merge:squad-duplicates` act where the directory-wide
 * tool refuses a reversed pair. Pairs with no team in common are listed for a human and
 * never merged.
 *
 * **Irreversible, like every merge here.** The whole mergeable list is printed, never a
 * page of it: `db:merge:squad-duplicates` truncated its list at 40 of 48 and nearly had
 * eight deletions approved by somebody who had not seen them.
 *
 * The merge itself is `mergePlayerRecords`, the same function behind the admin's Merge
 * Players button. Career totals: it raises the survivor's to its own competition rows and
 * never copies the folded record's, so run `db:repair:player-stats` afterwards. Then
 * `db:repair:player-display-names` again — the records it blocked will have gone.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { mergePlayerRecords } from "../src/players/merge-player-records";
import {
  planNumberedDuplicates,
  type NumberedCandidate,
  type NumberedPair,
} from "../src/players/numbered-duplicates";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(
    `Records whose name carries a shirt number — ${
      APPLY ? "APPLYING" : "dry run, pass --apply to merge"
    }\n`
  );

  const players = await prisma.player.findMany({
    select: { id: true, displayName: true },
  });
  const squadRows = await prisma.sbTeamSquad.findMany({
    where: { playerId: { not: null } },
    select: { playerId: true, teamId: true },
  });

  const teamsByPlayer = new Map<string, string[]>();
  for (const row of squadRows) {
    if (!row.playerId) continue;
    const held = teamsByPlayer.get(row.playerId);
    if (held) {
      if (!held.includes(row.teamId)) held.push(row.teamId);
    } else {
      teamsByPlayer.set(row.playerId, [row.teamId]);
    }
  }

  const candidates: NumberedCandidate[] = players.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    teamIds: teamsByPlayer.get(p.id) ?? [],
  }));

  const plan = planNumberedDuplicates(candidates);
  const involved = [...plan.mergeable, ...plan.needsAHuman].flatMap((p) => [
    p.numbered.id,
    p.plain.id,
  ]);

  /* Event counts are shown because they are what a merge moves, and because a numbered
     record carrying more events than the plain one is worth a second look before folding. */
  const [scorerCounts, assistCounts, teamNames] = await Promise.all([
    prisma.sbMatchEvent.groupBy({
      by: ["playerId"],
      where: { playerId: { in: involved } },
      _count: { _all: true },
    }),
    prisma.sbMatchEvent.groupBy({
      by: ["assistPlayerId"],
      where: { assistPlayerId: { in: involved } },
      _count: { _all: true },
    }),
    prisma.sbTeam.findMany({ select: { id: true, name: true } }),
  ]);

  const events = new Map<string, number>();
  for (const row of scorerCounts) {
    if (row.playerId) events.set(row.playerId, row._count._all);
  }
  for (const row of assistCounts) {
    if (row.assistPlayerId) {
      events.set(row.assistPlayerId, (events.get(row.assistPlayerId) ?? 0) + row._count._all);
    }
  }
  const teamName = new Map(teamNames.map((t) => [t.id, t.name]));

  const describe = (pair: NumberedPair) => {
    const where = pair.sharedTeamIds.map((id) => teamName.get(id) ?? id).join(", ");
    const numberedEvents = events.get(pair.numbered.id) ?? 0;
    const plainEvents = events.get(pair.plain.id) ?? 0;
    console.log(`  ${where || "no team in common"}`);
    console.log(`      keep   ${pair.plain.displayName}  (${plainEvents} event(s))`);
    console.log(
      `      fold   ${pair.numbered.displayName}  — ${numberedEvents} event(s) move across`
    );
    if (numberedEvents > plainEvents) {
      console.log(
        "      !! the numbered record carries more events than the one being kept — read this one"
      );
    }
  };

  console.log(`  ${candidates.length} player record(s) read`);
  console.log(`  ${plan.mergeable.length} to fold into the record holding the name`);
  console.log(`  ${plan.needsAHuman.length} sharing no team, left for a human\n`);

  if (plan.mergeable.length) {
    console.log(`To fold (${plan.mergeable.length})`);
    console.log("-".repeat(76));
    console.log(
      "  Every one of them, never a page: a merge cannot be undone by re-running.\n" +
        "  The shirt number is not part of the name, and both records are on the team\n" +
        "  named beside them — which is the evidence that they are one person.\n"
    );
    for (const pair of plan.mergeable) describe(pair);
  }

  if (plan.needsAHuman.length) {
    console.log(`\nNo team in common — not merged (${plan.needsAHuman.length})`);
    console.log("-".repeat(76));
    console.log(
      "  The same name on two records that never share a squad. That may be one boy who\n" +
        "  moved club, or two boys who share a name, and nothing here can tell which. Use\n" +
        "  the admin's Merge Players button on the ones you recognise.\n"
    );
    for (const pair of plan.needsAHuman) describe(pair);
  }

  if (!plan.mergeable.length && !plan.needsAHuman.length) {
    console.log("Nothing to fold.");
    return;
  }

  if (!APPLY) {
    console.log("\n" + "-".repeat(76));
    console.log("Nothing was written. Re-run with --apply.");
    console.log(
      "Afterwards: db:repair:player-stats, then db:repair:player-display-names — the\n" +
        "records it was blocking will have gone."
    );
    return;
  }

  let folded = 0;
  let rowsRemoved = 0;
  for (const pair of plan.mergeable) {
    /* One transaction per pair, matching db:merge:squad-duplicates: a fold that half
       happens leaves a squad row pointing at a record that has already been deleted. */
    await prisma.$transaction(async (tx) => {
      /* The numbered record's row on a shared team, removed first and inside the same
         transaction. A shared team means the surviving record already has a row there, so
         after the fold both rows would point at one player and the squad would list him
         twice -- manufacturing exactly the defect db:merge:squad-duplicates exists to
         remove. Rows on teams the survivor is not in are kept: those are real squad
         memberships, and db:repair:player-display-names realigns their spelling. */
      const removed = await tx.sbTeamSquad.deleteMany({
        where: { playerId: pair.numbered.id, teamId: { in: pair.sharedTeamIds } },
      });
      rowsRemoved += removed.count;

      await mergePlayerRecords(tx, {
        sourcePlayerId: pair.numbered.id,
        targetPlayerId: pair.plain.id,
        removeSource: true,
      });
    });
    folded += 1;
  }

  /* The script's own check, run against the database rather than against its own plan: a
     numbered record still holding a name somebody else holds means a merge did not land. */
  const after = await prisma.player.findMany({ select: { id: true, displayName: true } });
  const afterSquads = await prisma.sbTeamSquad.findMany({
    where: { playerId: { not: null } },
    select: { playerId: true, teamId: true },
  });
  const afterTeams = new Map<string, string[]>();
  for (const row of afterSquads) {
    if (!row.playerId) continue;
    const held = afterTeams.get(row.playerId);
    if (held) {
      if (!held.includes(row.teamId)) held.push(row.teamId);
    } else {
      afterTeams.set(row.playerId, [row.teamId]);
    }
  }
  const remaining = planNumberedDuplicates(
    after.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      teamIds: afterTeams.get(p.id) ?? [],
    }))
  );

  console.log("\n" + "-".repeat(76));
  console.log(
    `Folded ${folded} numbered record(s) and removed ${rowsRemoved} squad row(s) that would`
  );
  console.log("  otherwise have listed the surviving player twice.");
  console.log(`  still foldable: ${remaining.mergeable.length}`);
  console.log(`  still sharing no team, for a human: ${remaining.needsAHuman.length}`);
  console.log(
    "Run db:repair:player-stats next, then db:repair:player-display-names — the records\n" +
      "it was blocking will have gone."
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
