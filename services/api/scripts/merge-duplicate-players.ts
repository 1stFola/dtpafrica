/**
 * Fold the duplicate player records into one another.
 *
 *   pnpm --filter @dtp/api db:merge:duplicate-players          # report only
 *   pnpm --filter @dtp/api db:merge:duplicate-players --apply  # merge
 *
 * These are the fourteen names `db:repair:player-lookup-keys` reports as blocked:
 * one person holding two records that normalise to the same key, so the unique
 * index will not let both have it. `JIMOH RASHEED` and `Jimoh Rasheed`,
 * `DONALD OBIAJULU` twice. Every other repair in this sequence has stopped short
 * of them, because folding two records together is the one step that cannot be
 * undone by running something again.
 *
 * **It does not invent a merge.** The work is done by `mergePlayerRecords`, the
 * same function behind the admin's Merge Players button, extracted so the two
 * cannot drift — a second implementation of this would eventually put somebody's
 * goals on the wrong profile.
 *
 * **Only exact duplicates.** Two records whose names normalise identically, which
 * is what the unique index is already refusing. It will not touch a reversed pair
 * like `Clems Henry` / `Henry Clems`: those have different canonical keys, both
 * are valid, and deciding they are one person is a judgement this should not make
 * on its own. `db:report:duplicate-players` lists them for a human.
 *
 * After each merge the survivor takes the canonical key, which is what the blocked
 * list was waiting for. Career totals are deliberately left alone — see
 * `merge-player-records.ts` — and `db:repair:player-stats` reconciles the
 * platform's share against the events afterwards.
 */
import { PrismaClient } from "@prisma/client";
import { playerLookupKey } from "@dtp/engines";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { mergePlayerRecords } from "../src/players/merge-player-records";
import { chooseMergeTarget, isSuffixedSlug, type MergeCandidate } from "./merge-target";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(
    `Duplicate player records — ${APPLY ? "APPLYING" : "dry run, pass --apply to merge"}\n`
  );

  const players = await prisma.player.findMany({
    select: {
      id: true,
      displayName: true,
      slug: true,
      createdAt: true,
      playerPhotoUrl: true,
      academyId: true,
      normalizedName: true,
    },
  });

  /* Grouped by the canonical key rather than by the stored one: the stored keys are
     precisely what disagree, which is how these rows came to exist. */
  const byKey = new Map<string, typeof players>();
  for (const p of players) {
    const key = playerLookupKey(p.displayName);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }
  const groups = [...byKey.entries()].filter(([, rows]) => rows.length > 1);

  console.log(`  ${players.length} player records scanned`);
  console.log(`  ${groups.length} name(s) held by more than one record\n`);

  if (!groups.length) {
    console.log("No two records normalise to the same name. Nothing to merge.");
    return;
  }

  const ids = groups.flatMap(([, rows]) => rows.map((r) => r.id));
  const [goals, assists] = await Promise.all([
    prisma.sbMatchEvent.groupBy({
      by: ["playerId"],
      where: { playerId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.sbMatchEvent.groupBy({
      by: ["assistPlayerId"],
      where: { assistPlayerId: { in: ids } },
      _count: { _all: true },
    }),
  ]);
  const eventsBy = new Map<string, number>();
  for (const g of goals) eventsBy.set(g.playerId!, (eventsBy.get(g.playerId!) ?? 0) + g._count._all);
  for (const a of assists) {
    eventsBy.set(a.assistPlayerId!, (eventsBy.get(a.assistPlayerId!) ?? 0) + a._count._all);
  }

  const plans = groups.map(([key, rows]) => {
    const candidates: MergeCandidate[] = rows.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      slug: r.slug,
      hasProfile: Boolean(r.playerPhotoUrl || r.academyId),
      events: eventsBy.get(r.id) ?? 0,
      createdAt: r.createdAt,
    }));
    return { key, ...chooseMergeTarget(candidates) };
  });

  for (const plan of plans) {
    console.log(`  "${plan.key}"`);
    console.log(
      `     keep   ${plan.target.displayName.padEnd(24)} /${plan.target.slug.padEnd(28)} ` +
        `${plan.target.events} event(s)   ${plan.why}`
    );
    for (const s of plan.sources) {
      console.log(
        `     fold   ${s.displayName.padEnd(24)} /${s.slug.padEnd(28)} ` +
          `${s.events} event(s)${isSuffixedSlug(s.slug) ? "   (suffixed copy)" : ""}`
      );
    }
  }

  const folding = plans.reduce((n, p) => n + p.sources.length, 0);
  console.log(`\n  ${folding} record(s) would be folded into ${plans.length} survivor(s).`);

  if (!APPLY) {
    console.log("\n" + "-".repeat(64));
    console.log(
      "Nothing was merged. This is the one step that cannot be undone by running\n" +
        "something again, so read the pairs above before re-running with --apply."
    );
    return;
  }

  let merged = 0;
  let keysFixed = 0;
  for (const plan of plans) {
    for (const source of plan.sources) {
      await prisma.$transaction(
        async (tx) =>
          mergePlayerRecords(tx, {
            sourcePlayerId: source.id,
            targetPlayerId: plan.target.id,
            removeSource: true,
          }),
        { timeout: 30_000 }
      );
      merged += 1;
      console.log(`  merged ${source.displayName} (/${source.slug}) into /${plan.target.slug}`);
    }

    /* The key the blocked list was waiting for. Nothing else holds it now. */
    const held = await prisma.player.findUnique({
      where: { normalizedName: plan.key },
      select: { id: true },
    });
    if (!held) {
      await prisma.player.update({
        where: { id: plan.target.id },
        data: { normalizedName: plan.key },
      });
      keysFixed += 1;
    }
  }

  console.log("\n" + "-".repeat(64));
  console.log(`Merged ${merged} record(s) and set ${keysFixed} canonical key(s).`);
  console.log(
    "\nNow run, in this order:\n" +
      "  db:repair:player-lookup-keys          — should report 0 blocked\n" +
      "  db:repair:player-stats -- --apply     — reconciles the merged totals\n" +
      "  db:report:player-stat-drift           — should read 0 behind, 0 ahead"
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
