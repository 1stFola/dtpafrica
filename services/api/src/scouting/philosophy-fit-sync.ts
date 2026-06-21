import {
  computePhilosophyFit,
  computePositionFitScore,
  FORMATIONS,
  PHILOSOPHY_IDS,
  type FormationId,
  type PhilosophyId,
} from "@dtp/engines";
import type { PrismaClient } from "@prisma/client";
import { toPhilosophyFitPlayer, type PlayerWithSip } from "./scouting.mapper";

export const PROFILE_FORMATION: FormationId = "4-2-3-1";
export const PHILOSOPHY_FIT_LIMIT = 5;

async function persistPhilosophyFit(
  prisma: PrismaClient,
  fit: {
    playerId: string;
    formation: string;
    philosophy: string;
    positionSlot?: string;
    philosophyFitScore: number;
    positionFitScore: number;
    confidenceScore: number;
  }
) {
  const existing = await prisma.philosophyFitProfile.findFirst({
    where: {
      playerId: fit.playerId,
      formation: fit.formation,
      philosophy: fit.philosophy,
      positionSlot: fit.positionSlot ?? null,
    },
  });
  const data = {
    philosophyFitScore: fit.philosophyFitScore,
    positionFitScore: fit.positionFitScore,
    confidenceScore: fit.confidenceScore,
  };
  if (existing) {
    await prisma.philosophyFitProfile.update({
      where: { id: existing.id },
      data,
    });
  } else {
    await prisma.philosophyFitProfile.create({
      data: {
        playerId: fit.playerId,
        formation: fit.formation,
        philosophy: fit.philosophy,
        positionSlot: fit.positionSlot ?? null,
        ...data,
      },
    });
  }
}

/** Recompute and persist top philosophy-fit rows for a player from current SIP data. */
export async function syncPhilosophyFitsForPlayer(
  prisma: PrismaClient,
  playerId: string
): Promise<boolean> {
  const row = await prisma.player.findUnique({
    where: { id: playerId },
    include: { tacticalScores: true, positionFit: true },
  });
  if (!row?.tacticalScores) return false;

  const player = toPhilosophyFitPlayer(row as PlayerWithSip);
  if (!player) return false;

  const slots = FORMATIONS[PROFILE_FORMATION];
  const bestSlot =
    slots
      .map((slot) => ({ slot, score: computePositionFitScore(player, slot) }))
      .sort((a, b) => b.score - a.score)[0]?.slot ?? slots.find((s) => s.id === "cam");

  const fits = PHILOSOPHY_IDS.map((philosophy: PhilosophyId) =>
    computePhilosophyFit(player, philosophy, PROFILE_FORMATION, bestSlot)
  )
    .sort((a, b) => b.philosophyFitScore - a.philosophyFitScore)
    .slice(0, PHILOSOPHY_FIT_LIMIT);

  for (const fit of fits) {
    await persistPhilosophyFit(prisma, fit);
  }

  return true;
}
