import { clampPercent } from "../clamp-percent";
import type { FormationId, FormationSlot, SlotRole } from "./formations";
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

/** Normalized 0–1 offensive/defensive relevance for the slot role. */
function roleRelevance(player: PhilosophyFitPlayer, role: SlotRole): number {
  const offensive = clampPercent(player.offensiveRating ?? 50) / 100;
  const defensive = clampPercent(player.defensiveRating ?? 50) / 100;
  if (role === "gk") return 0.5;
  if (role === "att") return offensive;
  if (role === "def") return defensive;
  return (offensive + defensive) / 2;
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
  const overall = clampPercent(player.overallRating ?? 50);
  const posFit = clampPercent(slot ? computePositionFitScore(player, slot) : 60);
  const role = slot?.role ?? "mid";
  const offDef = clampPercent(roleRelevance(player, role) * 100);

  const philosophyFitScore = clampPercent(
    primary * 0.5 + overall * 0.25 + posFit * 0.15 + offDef * 0.1,
    1
  );

  const confidenceScore = clampPercent(
    50 + (primary - 50) * 0.3 + (posFit - 50) * 0.2,
    0
  );
  const boundedConfidence = Math.min(99, Math.max(40, confidenceScore));

  return {
    playerId: player.id,
    formation,
    philosophy,
    positionSlot: slot?.id,
    philosophyFitScore,
    positionFitScore: posFit,
    primaryStyleScore: primary,
    confidenceScore: boundedConfidence,
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
