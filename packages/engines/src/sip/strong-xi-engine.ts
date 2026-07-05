import type { FormationId } from "./formations";
import { FORMATIONS, positionMatchesSlot } from "./formations";
import type { PhilosophyId } from "./philosophies";
import {
  computePhilosophyFit,
  type PhilosophyFitPlayer,
  type PhilosophyFitResult,
} from "./philosophy-fit-engine";

export type XiSlotPick = {
  slotId: string;
  slotLabel: string;
  x: number;
  y: number;
  player: PhilosophyFitPlayer;
  fit: PhilosophyFitResult;
};

type SlotCandidate = {
  player: PhilosophyFitPlayer;
  fit: PhilosophyFitResult;
  matchTier: 0 | 1 | 2;
};

export type StrongXiResult = {
  formation: FormationId;
  philosophy: PhilosophyId;
  xi: XiSlotPick[];
  bench: {
    slotId: string;
    slotLabel: string;
    player: PhilosophyFitPlayer;
    fit: PhilosophyFitResult;
  }[];
  insights: string[];
};

function slotMatchTier(
  player: PhilosophyFitPlayer,
  slot: (typeof FORMATIONS)[FormationId][number]
): 0 | 1 | 2 {
  if (positionMatchesSlot(player.positionPrimary, slot)) return 2;
  if (player.positionSecondary && positionMatchesSlot(player.positionSecondary, slot)) {
    return 1;
  }
  return 0;
}

function sortCandidates(a: SlotCandidate, b: SlotCandidate) {
  if (a.matchTier !== b.matchTier) return b.matchTier - a.matchTier;
  if (a.fit.positionFitScore !== b.fit.positionFitScore) {
    return b.fit.positionFitScore - a.fit.positionFitScore;
  }
  if (a.fit.philosophyFitScore !== b.fit.philosophyFitScore) {
    return b.fit.philosophyFitScore - a.fit.philosophyFitScore;
  }
  return b.player.overallRating - a.player.overallRating;
}

export function generateStrongXi(
  players: PhilosophyFitPlayer[],
  formation: FormationId,
  philosophy: PhilosophyId
): StrongXiResult {
  const slots = FORMATIONS[formation];
  const used = new Set<string>();
  const xi: XiSlotPick[] = [];
  const bench: StrongXiResult["bench"] = [];

  const rankedBySlot = slots.map((slot) => {
    const fits = players
      .map((p) => ({
        player: p,
        fit: computePhilosophyFit(p, philosophy, formation, slot),
        matchTier: slotMatchTier(p, slot),
      }))
      .filter((candidate) => candidate.matchTier > 0)
      .sort(sortCandidates);
    const eligibleCount = fits.length;
    return { slot, fits, eligibleCount };
  });

  rankedBySlot.sort((a, b) => a.eligibleCount - b.eligibleCount);

  for (const { slot, fits } of rankedBySlot) {
    const pick = fits.find((f) => !used.has(f.player.id));
    if (!pick) continue;
    used.add(pick.player.id);
    xi.push({
      slotId: slot.id,
      slotLabel: slot.label,
      x: slot.x,
      y: slot.y,
      player: pick.player,
      fit: pick.fit,
    });
    const alternates = fits
      .filter((f) => f.player.id !== pick.player.id && !used.has(f.player.id))
      .slice(0, 2);
    for (const alt of alternates) {
      bench.push({
        slotId: slot.id,
        slotLabel: slot.label,
        player: alt.player,
        fit: alt.fit,
      });
    }
  }

  const avgFit =
    xi.length > 0
      ? xi.reduce((s, x) => s + x.fit.philosophyFitScore, 0) / xi.length
      : 0;

  const insights: string[] = [
    `${formation} · ${philosophy} — average philosophy fit ${avgFit.toFixed(1)}`,
    xi.length === slots.length
      ? "Full XI selected from eligible squad."
      : `Only ${xi.length}/${slots.length} slots filled — add more players with matching primary or secondary roles.`,
  ];

  if (avgFit >= 70) {
    insights.push("Squad shows strong alignment with this system.");
  } else if (avgFit < 55) {
    insights.push("Consider recruitment or development in key tactical profiles.");
  }

  return { formation, philosophy, xi, bench, insights };
}
