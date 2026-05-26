import type { PositionFitResult, TacticalScores } from "./types";

const POSITION_MAP: { key: keyof TacticalScores; label: string }[] = [
  { key: "wingerScore", label: "RW" },
  { key: "highLineScore", label: "FB" },
  { key: "gegenpressScore", label: "CM" },
  { key: "tikiTakaScore", label: "DM" },
  { key: "counterAttackScore", label: "LW" },
  { key: "isolationThreatScore", label: "ST" },
  { key: "possessionHubScore", label: "AM" },
  { key: "lowBlockScore", label: "CB" },
];

export function computePositionFit(scores: TacticalScores): PositionFitResult {
  const ranked = POSITION_MAP.map(({ key, label }) => ({
    label,
    value: scores[key] as number,
  })).sort((a, b) => b.value - a.value);

  const primary = ranked[0];
  const secondary = ranked[1];
  const hybrid = ranked[2];

  const spread = primary.value - (ranked[ranked.length - 1]?.value ?? 0);
  const confidence = Math.round(Math.min(99, Math.max(40, 50 + spread)));

  return {
    primaryPositionFit: primary.label,
    secondaryPositionFit: secondary.value > 45 ? secondary.label : null,
    hybridFit: hybrid.value > 50 ? hybrid.label : null,
    confidence,
  };
}
