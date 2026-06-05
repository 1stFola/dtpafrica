import type { MvceValuationResult } from "./types";

export type ValuationCompareRow = {
  playerId: string;
  displayName: string;
  positionPrimary: string;
  adjustedScore: number;
  confidenceLabel: string;
  marketValueLabel: string;
};

export function compareValuationResults(
  rows: ValuationCompareRow[]
): {
  players: ValuationCompareRow[];
  metrics: string[];
  values: Record<string, (number | string)[]>;
} {
  const metrics = [
    "adjustedScore",
    "confidenceLabel",
    "marketValueLabel",
  ] as const;

  const values: Record<string, (number | string)[]> = {
    adjustedScore: rows.map((r) => r.adjustedScore),
    confidenceLabel: rows.map((r) => r.confidenceLabel),
    marketValueLabel: rows.map((r) => r.marketValueLabel),
  };

  return { players: rows, metrics: [...metrics], values };
}

export type StoredValuation = MvceValuationResult & {
  playerId: string;
  displayName: string;
  positionPrimary: string;
};
