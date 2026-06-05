/**
 * Run calibration for a player from DB match metrics and persist overall ratings.
 * Usage: pnpm --filter @dtp/api calibrate [playerId]
 */
import { runCalibration, playerToLegacyMeta } from "@dtp/engines";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const playerId = process.argv[2] ?? "00000000-0000-4000-8000-000000000001";

async function main() {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) {
    console.error(`Player not found: ${playerId}`);
    process.exit(1);
  }

  const metrics = await prisma.playerMatchMetrics.findFirst({
    where: { playerId },
    orderBy: { createdAt: "desc" },
  });

  if (!metrics) {
    console.error(`No match metrics for player ${playerId}`);
    process.exit(1);
  }

  const result = runCalibration(metrics, playerToLegacyMeta(player));

  await prisma.player.update({
    where: { id: playerId },
    data: {
      overallRating: result.calibratedSummary.overall_rating,
      offensiveRating: result.calibratedSummary.offensive_score,
      defensiveRating: result.calibratedSummary.defensive_score,
    },
  });

  console.log("\n=== Calibration complete ===\n");
  console.log("Player:", player.displayName, `(${player.positionPrimary})`);
  console.log(
    "Nearest pro benchmark:",
    (result.nearestBenchmark as { full_name?: string }).full_name ?? "—",
    "| similarity:",
    (result.nearestBenchmark as { __similarity?: number }).__similarity,
  );
  console.log("Raw overall:", result.rawSummary.overall_rating);
  console.log("Calibrated overall:", result.calibratedSummary.overall_rating);
  console.log("Saved to players.overall_rating / offensive_rating / defensive_rating");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
