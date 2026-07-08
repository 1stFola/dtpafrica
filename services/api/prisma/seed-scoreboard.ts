import type { PrismaClient } from "@prisma/client";
import type { SeedOptions } from "../src/seed/seed-options";
import { backfillMissingMatchSlugs } from "../src/scoreboard/match-slug";
import { seedExInternationalsCup2026 } from "./seed-ex-internationals-cup-2026";
import { seedJagabanCup2026 } from "./seed-jagaban-cup-2026";
import { seedLagosQueensCup2026 } from "./seed-lagos-queens-cup-2026";

/** ScoreBoard seed: Jagaban Cup 2026, Ex Internationals Cup 2026, Lagos Queens Cup 2026. */
export async function seedScoreboard(
  prisma: PrismaClient,
  _seedPlayerId?: string,
  options?: SeedOptions
) {
  const preBackfill = await backfillMissingMatchSlugs(prisma);
  if (preBackfill > 0) {
    console.log("Backfilled match slugs (pre-seed):", preBackfill);
  }

  await seedJagabanCup2026(prisma, options);
  await seedExInternationalsCup2026(prisma, options);
  await seedLagosQueensCup2026(prisma, options);

  const postBackfill = await backfillMissingMatchSlugs(prisma);
  if (postBackfill > 0) {
    console.log("Backfilled match slugs (post-seed):", postBackfill);
  }
}
