/**
 * Rewrites Player.normalizedName to the canonical `playerLookupKey` form.
 *
 * Some seeds historically wrote a different normalisation into this column —
 * a hyphenated slug (Scout To Pro) or a casing-preserving form
 * (seed-legacy-players, seed-dsl-league-players before the fix). The admin
 * directory and `admin-scoreboard.service.createSquadRow` both look players up
 * by `playerLookupKey(displayName)`, so those rows are unreachable from the
 * admin UI and a re-seed tries to insert them again, colliding on Player.slug.
 *
 * Dry run by default; pass --apply to write.
 *
 *   npx tsx scripts/backfill-player-normalized-name.ts
 *   npx tsx scripts/backfill-player-normalized-name.ts --apply
 *
 * Safe to re-run: rows already in canonical form are skipped.
 */
import { PrismaClient } from "@prisma/client";
import { playerLookupKey } from "@dtp/engines";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

type PlayerRow = {
  id: string;
  displayName: string;
  normalizedName: string | null;
  slug: string;
};

async function main() {
  const players: PlayerRow[] = await prisma.player.findMany({
    select: { id: true, displayName: true, normalizedName: true, slug: true },
  });

  console.log(`Scanned ${players.length} players`);

  // Where each canonical key currently lives, so we can spot collisions.
  const holders = new Map<string, PlayerRow[]>();
  for (const p of players) {
    const target = playerLookupKey(p.displayName);
    if (!target) continue;
    if (!holders.has(target)) holders.set(target, []);
    holders.get(target)!.push(p);
  }

  const toUpdate: Array<{ player: PlayerRow; target: string }> = [];
  const collisions: Array<{ target: string; rows: PlayerRow[] }> = [];

  for (const [target, rows] of holders) {
    if (rows.length > 1) {
      // Two or more distinct player records normalise to the same key. Writing
      // both would violate the unique index, and merging player records touches
      // squad/event/stat foreign keys — that is a judgement call, not a backfill.
      collisions.push({ target, rows });
      continue;
    }
    const [player] = rows;
    if (player.normalizedName !== target) toUpdate.push({ player, target });
  }

  console.log(`Already canonical: ${players.length - toUpdate.length - collisions.reduce((n, c) => n + c.rows.length, 0)}`);
  console.log(`Need rewrite:      ${toUpdate.length}`);
  console.log(`Collisions:        ${collisions.length} (skipped)`);

  if (toUpdate.length) {
    console.log("\nExamples (up to 15):");
    for (const { player, target } of toUpdate.slice(0, 15)) {
      console.log(`  "${player.displayName}": ${JSON.stringify(player.normalizedName)} -> ${JSON.stringify(target)}`);
    }
  }

  if (collisions.length) {
    console.log("\nCollisions — resolve these by hand (merge or rename):");
    for (const { target, rows } of collisions.slice(0, 20)) {
      console.log(`  ${JSON.stringify(target)}:`);
      for (const r of rows) {
        console.log(`    id=${r.id} slug=${r.slug} normalizedName=${JSON.stringify(r.normalizedName)}`);
      }
    }
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to commit.");
    return;
  }

  let updated = 0;
  let failed = 0;
  for (const { player, target } of toUpdate) {
    try {
      await prisma.player.update({
        where: { id: player.id },
        data: { normalizedName: target },
      });
      updated++;
    } catch (err) {
      failed++;
      console.error(`  failed id=${player.id} "${player.displayName}" -> ${JSON.stringify(target)}:`, err);
    }
  }

  console.log(`\nUpdated ${updated} players (${failed} failed, ${collisions.length} collisions skipped)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
