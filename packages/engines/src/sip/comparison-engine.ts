import type { PhilosophyFitPlayer } from "./philosophy-fit-engine";
import type { TacticalScores } from "./types";

export type ComparisonRow = {
  playerId: string;
  displayName: string;
  positionPrimary: string;
  overallRating: number;
  offensiveRating: number;
  defensiveRating: number;
  tactical: TacticalScores;
};

export type PlayerComparisonResult = {
  players: ComparisonRow[];
  metrics: string[];
  values: Record<string, number[]>;
};

const COMPARISON_METRICS: (keyof TacticalScores)[] = [
  "gegenpressScore",
  "tikiTakaScore",
  "counterAttackScore",
  "totalFootballScore",
  "highLineScore",
  "wingerScore",
  "lowBlockScore",
  "pressResistanceScore",
  "possessionHubScore",
  "isolationThreatScore",
  "twoFootednessScore",
];

export function comparePlayers(players: PhilosophyFitPlayer[]): PlayerComparisonResult {
  if (players.length === 0) {
    return { players: [], metrics: COMPARISON_METRICS, values: {} };
  }
  if (players.length > 4) {
    throw new Error("comparePlayers: maximum 4 players");
  }

  const rows: ComparisonRow[] = players.map((p) => ({
    playerId: p.id,
    displayName: p.displayName,
    positionPrimary: p.positionPrimary,
    overallRating: p.overallRating,
    offensiveRating: p.offensiveRating,
    defensiveRating: p.defensiveRating,
    tactical: p.tactical,
  }));

  const values: Record<string, number[]> = {};
  for (const key of COMPARISON_METRICS) {
    values[key] = players.map((p) => p.tactical[key] as number);
  }
  values["overallRating"] = players.map((p) => p.overallRating);
  values["offensiveRating"] = players.map((p) => p.offensiveRating);
  values["defensiveRating"] = players.map((p) => p.defensiveRating);

  return {
    players: rows,
    metrics: [...COMPARISON_METRICS, "overallRating", "offensiveRating", "defensiveRating"],
    values,
  };
}
