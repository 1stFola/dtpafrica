import { clampPercent } from "../clamp-percent";
import type { TacticalScores } from "./types";

export type PhilosophyId =
  | "Gegenpressing"
  | "Tiki-Taka"
  | "Counter-Attacking"
  | "Total Football"
  | "High Line System"
  | "Low Block System"
  | "Wing Play"
  | "Direct Vertical Football"
  | "Inverted Fullback System"
  | "False 9 Fluid System";

export const PHILOSOPHY_IDS: PhilosophyId[] = [
  "Gegenpressing",
  "Tiki-Taka",
  "Counter-Attacking",
  "Total Football",
  "High Line System",
  "Low Block System",
  "Wing Play",
  "Direct Vertical Football",
  "Inverted Fullback System",
  "False 9 Fluid System",
];

type PhilosophyConfig = {
  primaryKey: keyof TacticalScores;
  /** Blend keys for secondary influence */
  blend?: { key: keyof TacticalScores; weight: number }[];
  offensiveBias: number;
};

export const PHILOSOPHIES: Record<PhilosophyId, PhilosophyConfig> = {
  Gegenpressing: { primaryKey: "gegenpressScore", offensiveBias: 0.55 },
  "Tiki-Taka": { primaryKey: "tikiTakaScore", offensiveBias: 0.45 },
  "Counter-Attacking": { primaryKey: "counterAttackScore", offensiveBias: 0.65 },
  "Total Football": { primaryKey: "totalFootballScore", offensiveBias: 0.5 },
  "High Line System": { primaryKey: "highLineScore", offensiveBias: 0.55 },
  "Low Block System": { primaryKey: "lowBlockScore", offensiveBias: 0.35 },
  "Wing Play": { primaryKey: "wingerScore", offensiveBias: 0.6 },
  "Direct Vertical Football": {
    primaryKey: "directPlayScore",
    blend: [{ key: "counterAttackScore", weight: 0.35 }],
    offensiveBias: 0.7,
  },
  "Inverted Fullback System": {
    primaryKey: "highLineScore",
    blend: [{ key: "totalFootballScore", weight: 0.3 }],
    offensiveBias: 0.5,
  },
  "False 9 Fluid System": {
    primaryKey: "tikiTakaScore",
    blend: [{ key: "possessionHubScore", weight: 0.35 }],
    offensiveBias: 0.55,
  },
};

export function primaryStyleScore(
  tactical: TacticalScores,
  philosophy: PhilosophyId
): number {
  const cfg = PHILOSOPHIES[philosophy];
  let score = tactical[cfg.primaryKey] as number;
  if (cfg.blend) {
    for (const b of cfg.blend) {
      score = score * (1 - b.weight) + (tactical[b.key] as number) * b.weight;
    }
  }
  return clampPercent(score, 1);
}
