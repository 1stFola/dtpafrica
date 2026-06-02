import { getAdminApiKey } from "./admin";
import { ApiError, apiGet } from "./client";

export type ValuationReport = {
  runId: string;
  createdAt: string;
  player: {
    id: string;
    displayName: string;
    positionPrimary: string;
    playerPhotoUrl?: string | null;
    age?: number | null;
    nationality?: string | null;
  };
  inputs: Record<string, unknown>;
  result: {
    baseScore: number;
    adjustedScore: number;
    confidenceLabel: string;
    marketValueLabel: string;
    marketValueMinEur: number | null;
    marketValueMaxEur: number | null;
    factors: {
      key: string;
      label: string;
      weight: number;
      rawScore: number;
      weightedContribution: number;
    }[];
    multipliers: {
      verification: { level: string; value: number };
      marketDemand: { level: string; value: number };
      position: { position: string; value: number };
      combined: number;
    };
    strengths: string[];
    weaknesses: string[];
    scoutNotes: string;
  };
};

export type ValuedPlayerRow = {
  id: string;
  displayName: string;
  positionPrimary: string;
  playerPhotoUrl?: string | null;
  mvceValuations: {
    adjustedScore: number;
    confidenceLabel: string;
    marketValueLabel: string;
    createdAt: string;
  }[];
};

export function fetchValuedPlayers(signal?: AbortSignal) {
  return apiGet<ValuedPlayerRow[]>("/mvce/players", signal);
}

export function fetchValuationReport(playerId: string) {
  return apiGet<ValuationReport>(`/mvce/valuation/report/${playerId}`);
}

export async function generateValuation(body: Record<string, unknown>) {
  const key = getAdminApiKey();
  const res = await fetch("/api/v1/mvce/valuation/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-admin-api-key": key } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || res.statusText, res.status);
  }
  return res.json() as Promise<ValuationReport>;
}

export function compareValuations(ids: string[]) {
  return apiGet<{
    players: {
      playerId: string;
      displayName: string;
      positionPrimary: string;
      adjustedScore: number;
      confidenceLabel: string;
      marketValueLabel: string;
    }[];
    metrics: string[];
    values: Record<string, (number | string)[]>;
  }>(`/mvce/valuation/compare?ids=${ids.join(",")}`);
}
