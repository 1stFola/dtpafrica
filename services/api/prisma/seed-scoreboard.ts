import type { PrismaClient } from "@prisma/client";
import type { SeedOptions } from "../src/seed/seed-options";
import { backfillMissingMatchSlugs } from "../src/scoreboard/match-slug";
import { seed1XCup2026 } from "./seed-1xcup-2026";
import { seedExInternationalsCup2026 } from "./seed-ex-internationals-cup-2026";
import { seedGoalkeeperProfiles } from "./seed-goalkeeper-profiles";
import { seedJagabanCup2026 } from "./seed-jagaban-cup-2026";
import { seedLagosQueensCup2026 } from "./seed-lagos-queens-cup-2026";
import { seedDslLeague2026 } from "./seed-dsl-league-2026";
import { seedDslLeaguePlayers } from "./seed-dsl-league-players-2026";
import { seedRakLeague2026 } from "./seed-rak-league-2026";
import { seedTrainingCup } from "./seed-training-cup";
import { syncScoreboardEventPlayerLinks } from "./sync-scoreboard-event-player-links";
import { syncScoreboardTimelinePlayerProfiles } from "./sync-scoreboard-timeline-player-profiles";

/** ScoreBoard seed: Jagaban Cup 2026, Ex Internationals Cup 2026, Lagos Queens Cup 2026, 1XCup 2026, RAK BDFA League, Dynasty Scouting League, DTP Training Cup. */
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
  await seed1XCup2026(prisma, options);
  await seedRakLeague2026(prisma, options);
  await seedDslLeague2026(prisma, options);
  await seedDslLeaguePlayers(prisma, options);
  await seedTrainingCup(prisma, options);
  const goalkeeperProfiles = await seedGoalkeeperProfiles(prisma);
  console.log("Seeded goalkeeper profiles:", goalkeeperProfiles);
  const timelineProfiles = await syncScoreboardTimelinePlayerProfiles(prisma);
  console.log("Synced ScoreBoard timeline player profiles:", timelineProfiles);
  const linkedEvents = await syncScoreboardEventPlayerLinks(prisma);
  console.log("Synced ScoreBoard event player links:", linkedEvents);

  const postBackfill = await backfillMissingMatchSlugs(prisma);
  if (postBackfill > 0) {
    console.log("Backfilled match slugs (post-seed):", postBackfill);
  }
}
