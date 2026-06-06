import { PrismaClient } from "@prisma/client";
import { runDatabaseSeed } from "../src/seed/run-seed";

const prisma = new PrismaClient();

async function main() {
  const result = await runDatabaseSeed(prisma);

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.error(`[${err.phase}] ${err.message}`);
    }
    process.exit(1);
  }

  console.log("Seed complete in", result.durationMs, "ms");
  console.log("Player id:", result.seedPlayerId);
  console.log("Players:", result.counts.players);
  console.log("Academies:", result.counts.academies);
  console.log("Competitions:", result.counts.competitions);
  console.log("Legacy players:", result.counts.legacyPlayers);
  console.log("Public profile: /player/alli-o-sanni");
  console.log("ScoreBoard: /scoreboard/competition/jagaban-cup-2026");
  console.log("ScoreBoard: /scoreboard/competition/ex-internationals-cup-2026");
  console.log("MVCE: /valuation/player/" + result.seedPlayerId);
  console.log("Run: POST /api/v1/sip/players/" + result.seedPlayerId + "/recalculate");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
