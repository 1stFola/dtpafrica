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
        posMatch:
          positionMatchesSlot(p.positionPrimary, slot) ||
          (p.positionSecondary != null &&
            positionMatchesSlot(p.positionSecondary, slot)),
      }))
      .sort((a, b) => {
        const posBoost = (b.posMatch ? 8 : 0) - (a.posMatch ? 8 : 0);
        return posBoost + (b.fit.philosophyFitScore - a.fit.philosophyFitScore);
      });
    const eligibleCount = fits.filter((f) => f.posMatch).length;
    return { slot, fits, eligibleCount };
  });

  rankedBySlot.sort((a, b) => a.eligibleCount - b.eligibleCount);

  for (const { slot, fits } of rankedBySlot) {
    const pick = fits.find((f) => !used.has(f.player.id)) ?? fits[0];
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
    const alternates = fits.filter((f) => f.player.id !== pick.player.id).slice(0, 2);
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
      : `Only ${xi.length}/${slots.length} slots filled — add more players with tactical scores.`,
  ];

  if (avgFit >= 70) {
    insights.push("Squad shows strong alignment with this system.");
  } else if (avgFit < 55) {
    insights.push("Consider recruitment or development in key tactical profiles.");
  }

  return { formation, philosophy, xi, bench, insights };
}
