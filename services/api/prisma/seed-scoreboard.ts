import type { PrismaClient } from "@prisma/client";

import { backfillMissingMatchSlugs } from "../src/scoreboard/match-slug";
import { seed1XCup2026 } from "./seed-1xcup-2026";
import { seed1XCupGroupStage2026 } from "./seed-1xcup-group-stage-2026";
import { seedCoalCityScoutingTournament2026 } from "./seed-coal-city-scouting-tournament-2026";
import { seedExInternationalsCup2026 } from "./seed-ex-internationals-cup-2026";
import { seedGoalkeeperProfiles } from "./seed-goalkeeper-profiles";
import { seedJagabanCup2026 } from "./seed-jagaban-cup-2026";
import { seedJoemarkOtoAworiSuperLeague2026 } from "./seed-joemark-oto-awori-super-league-2026";
import { seedLagosQueensCup2026 } from "./seed-lagos-queens-cup-2026";
import { seedDslLeaguePlayers } from "./seed-dsl-league-players-2026";
import { seedRakLeague2026 } from "./seed-rak-league-2026";
import { seedTrainingCup } from "./seed-training-cup";
import { syncScoreboardEventPlayerLinks } from "./sync-scoreboard-event-player-links";
import { syncScoreboardTimelinePlayerProfiles } from "./sync-scoreboard-timeline-player-profiles";

/** ScoreBoard seed: Jagaban Cup 2026, Ex Internationals Cup 2026, Lagos Queens Cup 2026, 1XCup 2026 (incl. its group stage), RAK BDFA League, Dynasty Scouting League, Coal City Scouting Tournament 2026, JOEMARK Oto-Awori Super League 2026, DTP Training Cup. */
export async function seedScoreboard(prisma: PrismaClient, _seedPlayerId?: string) {
  const preBackfill = await backfillMissingMatchSlugs(prisma);
  if (preBackfill > 0) {
    console.log("Backfilled match slugs (pre-seed):", preBackfill);
  }

  /* One competition failing must not take the rest down with it.

     These ran as a bare sequence, so an exception anywhere stopped every seed
     after it — a bad row in the RAK league would have silently cost Coal City,
     JOEMARK and the training cup, and the run-seed phase that calls this reports
     a single "scoreboard" failure either way. Each one is now isolated and the
     failures are listed at the end, so the log says which competition broke
     rather than which phase. */
  const failures: string[] = [];
  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${name}: ${message}`);
      console.error(`Seed failed for ${name}: ${message}`);
    }
  };

  await step("Jagaban Cup 2026", () => seedJagabanCup2026(prisma));
  await step("Ex Internationals Cup 2026", () => seedExInternationalsCup2026(prisma));
  await step("Lagos Queens Cup 2026", () => seedLagosQueensCup2026(prisma));
  await step("1XCup 2026", () => seed1XCup2026(prisma));
  // Strictly after seed1XCup2026: the group stage attaches to that competition's
  // existing teams and its already-seeded group_stage row, and skips itself if
  // either is missing rather than creating a second 1XCup. That ordering also
  // repairs the condition this seed would otherwise throw on, since seed1XCup2026
  // upserts all 100 teams by slug first.
  await step("1XCup 2026 group stage", () => seed1XCupGroupStage2026(prisma));
  await step("RAK BDFA League", () => seedRakLeague2026(prisma));
  // Dynasty Scouting League teams and fixtures are live, so only its player
  // rosters are seeded. seed-dsl-league-2026.ts still holds the canonical team
  // and fixture data for reference but is deliberately not invoked.
  await step("Dynasty Scouting League players", () => seedDslLeaguePlayers(prisma));
  // New competition: teams and fixtures are not live yet, so this one still
  // seeds them. Every write is an upsert keyed on fixed ids.
  await step("Coal City Scouting Tournament 2026", () =>
    seedCoalCityScoutingTournament2026(prisma)
  );
  // New league: teams, squads and fixtures are not live yet, so this one seeds
  // them. Every write is an upsert on a fixed id, and a match that has kicked off
  // or had events recorded is left alone.
  await step("JOEMARK Oto-Awori Super League 2026", () =>
    seedJoemarkOtoAworiSuperLeague2026(prisma)
  );
  await step("DTP Training Cup", () => seedTrainingCup(prisma));
  const goalkeeperProfiles = await seedGoalkeeperProfiles(prisma);
  console.log("Seeded goalkeeper profiles:", goalkeeperProfiles);
  const timelineProfiles = await syncScoreboardTimelinePlayerProfiles(prisma);
  console.log("Synced ScoreBoard timeline player profiles:", timelineProfiles);
  const eventLinks = await syncScoreboardEventPlayerLinks(prisma);
  console.log("Synced ScoreBoard event player links:", eventLinks.updated);
  /* Said out loud rather than returned and dropped: an unlinked scorer never reaches
     the player's profile or the stat leaders, so nothing else would mention it.
     `db:sync:event-player-links` lists them in full. */
  if (eventLinks.unresolved.length) {
    console.log(
      `  ${eventLinks.unresolved.length} label(s) could not be matched to a player ` +
        "— run db:sync:event-player-links to see which"
    );
  }

  if (failures.length) {
    console.error(`ScoreBoard seed: ${failures.length} competition(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
  }

  const postBackfill = await backfillMissingMatchSlugs(prisma);
  if (postBackfill > 0) {
    console.log("Backfilled match slugs (post-seed):", postBackfill);
  }
}
