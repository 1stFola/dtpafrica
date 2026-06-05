import { confidenceLabel, marketValueBand } from "./bands";
import {
  inferMarketDemand,
  inferVerificationLevel,
  MARKET_DEMAND_MULTIPLIERS,
  positionMultiplier,
  VERIFICATION_MULTIPLIERS,
} from "./multipliers";
import type { FactorBreakdown, MvceValuationInput, MvceValuationResult } from "./types";

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function ageUpsideScore(age?: number): number {
  if (age == null) return 50;
  if (age <= 16) return 95;
  if (age <= 18) return 88;
  if (age <= 21) return 75;
  if (age <= 24) return 60;
  if (age <= 28) return 45;
  return 30;
}

function competitionScore(tier?: number): number {
  const t = tier ?? 2;
  return clamp(t * 20);
}

function experienceScore(matches?: number): number {
  const m = matches ?? 0;
  if (m >= 30) return 90;
  if (m >= 15) return 75;
  if (m >= 8) return 60;
  if (m >= 3) return 45;
  return 25;
}

function performanceScore(input: MvceValuationInput): number {
  if (input.performanceScore != null) return clamp(input.performanceScore);
  const g = input.goals ?? 0;
  const a = input.assists ?? 0;
  return clamp(40 + g * 4 + a * 3);
}

function visibilityScore(input: MvceValuationInput): number {
  let s = 20;
  if (input.verifiedFootage) s += 35;
  if (input.scoutReports) s += 25;
  if (input.tournamentExposure) s += 15;
  if (input.socialVisibility) s += 10;
  return clamp(s);
}

function marketSignalsScore(input: MvceValuationInput): number {
  let s = 25;
  if (input.clubInterestRumors) s += 25;
  if (input.youthNationalTeam) s += 35;
  if (input.marketDemand && input.marketDemand !== "none") s += 20;
  return clamp(s);
}

function contractScore(input: MvceValuationInput): number {
  return input.hasProfessionalContract ? 85 : 45;
}

function athleticScore(input: MvceValuationInput): number {
  if (input.athleticScore != null) return clamp(input.athleticScore);
  return 50;
}

function riskPenalty(input: MvceValuationInput): number {
  let risk = 0;
  if (!input.verifiedFootage) risk += 8;
  if ((input.matchesPlayed ?? 0) < 5) risk += 10;
  if ((input.competitionTier ?? 1) < 2) risk += 7;
  return clamp(risk, 0, 40);
}

function buildNarrative(
  input: MvceValuationInput,
  factors: FactorBreakdown[],
  score: number
): { strengths: string[]; weaknesses: string[]; scoutNotes: string } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const top = [...factors]
    .filter((f) => f.key !== "risk")
    .sort((a, b) => b.rawScore - a.rawScore)
    .slice(0, 2);
  const low = [...factors]
    .filter((f) => f.key !== "risk")
    .sort((a, b) => a.rawScore - b.rawScore)
    .slice(0, 2);

  for (const f of top) {
    if (f.rawScore >= 65) strengths.push(`Strong ${f.label.toLowerCase()} (${Math.round(f.rawScore)})`);
  }
  for (const f of low) {
    if (f.rawScore < 50) weaknesses.push(`${f.label} needs improvement (${Math.round(f.rawScore)})`);
  }

  if (input.youthNationalTeam) {
    strengths.push("Youth national team exposure boosts market signal");
  }
  if (!input.verifiedFootage) {
    weaknesses.push("Limited verified video reduces confidence");
  }

  const band = confidenceLabel(score);
  const scoutNotes = `${input.positionPrimary} profile in ${input.nationality ?? "Nigeria"} grassroots context. ` +
    `Confidence band: ${band}. Valuation reflects verification, competition tier, and market demand multipliers — ` +
    `deterministic MVCE v0.1 (AI narrative layer optional in future).`;

  return { strengths, weaknesses, scoutNotes };
}

export function computeValuation(input: MvceValuationInput): MvceValuationResult {
  const weights: { key: string; label: string; weight: number; raw: number }[] = [
    { key: "age", label: "Age upside", weight: 0.15, raw: ageUpsideScore(input.age) },
    {
      key: "competition",
      label: "Competition level",
      weight: 0.15,
      raw: competitionScore(input.competitionTier),
    },
    {
      key: "experience",
      label: "Match experience",
      weight: 0.15,
      raw: experienceScore(input.matchesPlayed),
    },
    {
      key: "performance",
      label: "Performance quality",
      weight: 0.12,
      raw: performanceScore(input),
    },
    {
      key: "visibility",
      label: "Visibility signals",
      weight: 0.1,
      raw: visibilityScore(input),
    },
    {
      key: "market",
      label: "Market signals",
      weight: 0.12,
      raw: marketSignalsScore(input),
    },
    {
      key: "contract",
      label: "Contract security",
      weight: 0.06,
      raw: contractScore(input),
    },
    {
      key: "athletic",
      label: "DTP athletic metrics",
      weight: 0.1,
      raw: athleticScore(input),
    },
    { key: "risk", label: "Risk adjustment", weight: -0.15, raw: riskPenalty(input) },
  ];

  const factors: FactorBreakdown[] = weights.map((w) => {
    const contribution =
      w.key === "risk"
        ? -w.weight * w.raw
        : w.weight * w.raw;
    return {
      key: w.key,
      label: w.label,
      weight: w.weight,
      rawScore: w.raw,
      weightedContribution: contribution,
    };
  });

  const baseScore = clamp(
    factors.reduce((sum, f) => sum + f.weightedContribution, 0)
  );

  const verificationLevel = inferVerificationLevel(input);
  const marketDemand = inferMarketDemand(input);
  const vMult = VERIFICATION_MULTIPLIERS[verificationLevel];
  const dMult = MARKET_DEMAND_MULTIPLIERS[marketDemand];
  const pMult = positionMultiplier(input.positionPrimary);
  const combined = vMult * dMult * pMult;

  const adjustedScore = clamp(baseScore * combined);
  const label = confidenceLabel(adjustedScore);
  const band = marketValueBand(adjustedScore);
  const narrative = buildNarrative(input, factors, adjustedScore);

  return {
    baseScore: Math.round(baseScore * 10) / 10,
    adjustedScore: Math.round(adjustedScore * 10) / 10,
    confidenceLabel: label,
    marketValueLabel: band.label,
    marketValueMinEur: band.minEur,
    marketValueMaxEur: band.maxEur,
    factors,
    multipliers: {
      verification: { level: verificationLevel, value: vMult },
      marketDemand: { level: marketDemand, value: dMult },
      position: { position: input.positionPrimary, value: pMult },
      combined: Math.round(combined * 1000) / 1000,
    },
    ...narrative,
  };
}
