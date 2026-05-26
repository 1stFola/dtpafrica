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

function roleRelevance(player: PhilosophyFitPlayer, role: SlotRole): number {
  if (role === "gk") return 50;
  if (role === "att") return player.offensiveRating / 100;
  if (role === "def") return player.defensiveRating / 100;
  return (player.offensiveRating + player.defensiveRating) / 200;
}

export function computePositionFitScore(
  player: PhilosophyFitPlayer,
  slot: FormationSlot
): number {
  if (positionMatchesSlot(player.positionPrimary, slot)) return 95;
  if (
    player.positionSecondary &&
    positionMatchesSlot(player.positionSecondary, slot)
  ) {
    return 82;
  }
  const snap = player.positionFit;
  if (snap) {
    const labels = [snap.primaryPositionFit, snap.secondaryPositionFit, snap.hybridFit].filter(
      Boolean
    ) as string[];
    if (labels.some((l) => slot.positions.includes(l))) return 78;
  }
  if (positionMatchesSlot(player.positionPrimary, slot)) return 70;
  return 45;
}

export function computePhilosophyFit(
  player: PhilosophyFitPlayer,
  philosophy: PhilosophyId,
  formation: FormationId,
  slot?: FormationSlot
): PhilosophyFitResult {
  const primary = primaryStyleScore(player.tactical, philosophy);
  const overall = player.overallRating ?? 50;
  const posFit = slot ? computePositionFitScore(player, slot) : 60;
  const role = slot?.role ?? "mid";
  const offDef = roleRelevance(player, role) * 100;

  const philosophyFitScore =
    primary * 0.5 + overall * 0.25 + posFit * 0.15 + offDef * 0.1;

  const confidenceScore = Math.min(
    99,
    Math.max(
      40,
      Math.round(50 + (primary - 50) * 0.3 + (posFit - 50) * 0.2)
    )
  );

  return {
    playerId: player.id,
    formation,
    philosophy,
    positionSlot: slot?.id,
    philosophyFitScore: Math.round(philosophyFitScore * 10) / 10,
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
