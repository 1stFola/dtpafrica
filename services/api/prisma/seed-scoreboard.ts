import type { PrismaClient } from "@prisma/client";

import { backfillMissingMatchSlugs } from "../src/scoreboard/match-slug";
import { seed1XCup2026 } from "./seed-1xcup-2026";
import { seedCoalCityScoutingTournament2026 } from "./seed-coal-city-scouting-tournament-2026";
import { seedExInternationalsCup2026 } from "./seed-ex-internationals-cup-2026";
import { seedGoalkeeperProfiles } from "./seed-goalkeeper-profiles";
import { seedJagabanCup2026 } from "./seed-jagaban-cup-2026";
import { seedLagosQueensCup2026 } from "./seed-lagos-queens-cup-2026";
import { seedDslLeaguePlayers } from "./seed-dsl-league-players-2026";
import { seedRakLeague2026 } from "./seed-rak-league-2026";
import { seedTrainingCup } from "./seed-training-cup";
import { syncScoreboardEventPlayerLinks } from "./sync-scoreboard-event-player-links";
import { syncScoreboardTimelinePlayerProfiles } from "./sync-scoreboard-timeline-player-profiles";

/** ScoreBoard seed: Jagaban Cup 2026, Ex Internationals Cup 2026, Lagos Queens Cup 2026, 1XCup 2026, RAK BDFA League, Dynasty Scouting League, Coal City Scouting Tournament 2026, DTP Training Cup. */
export async function seedScoreboard(prisma: PrismaClient, _seedPlayerId?: string) {
  const preBackfill = await backfillMissingMatchSlugs(prisma);
  if (preBackfill > 0) {
    console.log("Backfilled match slugs (pre-seed):", preBackfill);
  }

  await seedJagabanCup2026(prisma);
  await seedExInternationalsCup2026(prisma);
  await seedLagosQueensCup2026(prisma);
  await seed1XCup2026(prisma);
  await seedRakLeague2026(prisma);
  // Dynasty Scouting League teams and fixtures are live, so only its player
  // rosters are seeded. seed-dsl-league-2026.ts still holds the canonical team
  // and fixture data for reference but is deliberately not invoked.
  await seedDslLeaguePlayers(prisma);
  // New competition: teams and fixtures are not live yet, so this one still
  // seeds them. Every write is an upsert keyed on fixed ids.
  await seedCoalCityScoutingTournament2026(prisma);
  await seedTrainingCup(prisma);
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
