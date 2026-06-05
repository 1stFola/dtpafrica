import { computeValuation } from "@dtp/engines";
import type { PrismaClient } from "@prisma/client";

export async function seedMvce(prisma: PrismaClient, playerId: string) {
  const existing = await prisma.mvceValuationRun.findFirst({
    where: { playerId },
  });
  if (existing) return;

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { tacticalScores: true, aggregatedMetrics: true },
  });
  if (!player) return;

  const tactical = player.tacticalScores;
  const athleticScore = tactical
    ? (tactical.transitionExplosivenessScore +
        tactical.pressResistanceScore +
        (player.overallRating ?? 50)) /
      2
    : player.overallRating ?? 50;

  const input = {
    age: player.age ?? 17,
    positionPrimary: player.positionPrimary,
    nationality: player.nationality ?? "Nigerian",
    competitionTier: 3,
    matchesPlayed: player.aggregatedMetrics[0]?.matchesPlayed ?? 1,
    performanceScore: player.overallRating ?? 72,
    athleticScore,
    verifiedFootage: Boolean(player.videoUrl),
    scoutReports: true,
    tournamentExposure: true,
    socialVisibility: player.isPublic,
    youthNationalTeam: false,
    clubInterestRumors: true,
    marketDemand: "npfl" as const,
    verificationLevel: "video_match_sheets" as const,
  };

  const result = computeValuation(input);

  await prisma.mvceValuationRun.create({
    data: {
      playerId,
      inputs: input,
      baseScore: result.baseScore,
      adjustedScore: result.adjustedScore,
      confidenceLabel: result.confidenceLabel,
      marketValueLabel: result.marketValueLabel,
      marketValueMinEur: result.marketValueMinEur,
      marketValueMaxEur: result.marketValueMaxEur,
      factors: result.factors as object,
      multipliers: result.multipliers as object,
      strengths: result.strengths,
      weaknesses: result.weaknesses,
      scoutNotes: result.scoutNotes,
    },
  });

  console.log(
    "MVCE seed:",
    player.displayName,
    result.confidenceLabel,
    result.marketValueLabel
  );
}
