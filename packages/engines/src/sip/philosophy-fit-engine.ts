import { clampPercent } from "../clamp-percent";
import type { FormationId, FormationSlot } from "./formations";
import { FORMATIONS, positionMatchesSlot } from "./formations";
import { PHILOSOPHY_IDS, type PhilosophyId, primaryStyleScore } from "./philosophies";
import type { PositionFitResult, TacticalScores } from "./types";

export type PhilosophyFitPlayer = {
  id: string;
  displayName: string;
  positionPrimary: string;
  positionSecondary?: string | null;
  overallRating: number;
  offensiveRating: number;
  defensiveRating: number;
  playerPhotoUrl?: string | null;
  tactical: TacticalScores;
  positionFit?: PositionFitResult | null;
};

export type PhilosophyFitResult = {
  playerId: string;
  formation: FormationId;
  philosophy: PhilosophyId;
  positionSlot?: string;
  philosophyFitScore: number;
  positionFitScore: number;
  primaryStyleScore: number;
  confidenceScore: number;
};

/** Weights for the composite system-fit score exposed in the UI. */
export const PHILOSOPHY_FIT_WEIGHTS = {
  tacticalTrait: 0.5,
  positionFit: 0.3,
  confidence: 0.2,
} as const;

export function computePhilosophyConfidence(
  tacticalTraitScore: number,
  positionFitScore: number
): number {
  const raw = clampPercent(
    50 + (tacticalTraitScore - 50) * 0.3 + (positionFitScore - 50) * 0.2,
    0
  );
  return Math.min(99, Math.max(40, raw));
}

export function computePhilosophyFitScore(
  tacticalTraitScore: number,
  positionFitScore: number,
  confidenceScore: number
): number {
  const { tacticalTrait, positionFit, confidence } = PHILOSOPHY_FIT_WEIGHTS;
  return clampPercent(
    tacticalTraitScore * tacticalTrait +
      positionFitScore * positionFit +
      confidenceScore * confidence,
    1
  );
}

export function computePositionFitScore(
  player: PhilosophyFitPlayer,
  slot: FormationSlot
): number {
  if (positionMatchesSlot(player.positionPrimary, slot)) return clampPercent(95);
  if (
    player.positionSecondary &&
    positionMatchesSlot(player.positionSecondary, slot)
  ) {
    return clampPercent(82);
  }
  const snap = player.positionFit;
  if (snap) {
    const labels = [snap.primaryPositionFit, snap.secondaryPositionFit, snap.hybridFit].filter(
      Boolean
    ) as string[];
    if (labels.some((l) => slot.positions.includes(l))) return clampPercent(78);
  }
  if (positionMatchesSlot(player.positionPrimary, slot)) return clampPercent(70);
  return clampPercent(45);
}

export function computePhilosophyFit(
  player: PhilosophyFitPlayer,
  philosophy: PhilosophyId,
  formation: FormationId,
  slot?: FormationSlot
): PhilosophyFitResult {
  const primary = clampPercent(primaryStyleScore(player.tactical, philosophy), 1);
  const posFit = clampPercent(slot ? computePositionFitScore(player, slot) : 60);
  const confidenceScore = computePhilosophyConfidence(primary, posFit);
  const philosophyFitScore = computePhilosophyFitScore(primary, posFit, confidenceScore);

  return {
    playerId: player.id,
    formation,
    philosophy,
    positionSlot: slot?.id,
    philosophyFitScore,
    positionFitScore: posFit,
    primaryStyleScore: primary,
    confidenceScore,
  };
}

export function rankPlayersForPhilosophy(
  players: PhilosophyFitPlayer[],
  formation: FormationId,
  philosophy: PhilosophyId,
  slotId?: string
): PhilosophyFitResult[] {
  const slots = FORMATIONS[formation];
  const slot = slotId ? slots.find((s) => s.id === slotId) : undefined;

  return players
    .map((p) => computePhilosophyFit(p, philosophy, formation, slot))
    .sort((a, b) => b.philosophyFitScore - a.philosophyFitScore);
}

export { PHILOSOPHY_IDS, FORMATIONS };
