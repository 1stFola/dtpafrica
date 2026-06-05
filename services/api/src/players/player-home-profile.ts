import {
  PHILOSOPHY_IDS,
  positionFullFromAbbreviation,
  type PhilosophyId,
} from "@dtp/engines";
import type { Prisma } from "@prisma/client";

export type HomePhilosophyScore = { name: string; score: number };

type TacticalRow = {
  gegenpressScore: number;
  tikiTakaScore: number;
  counterAttackScore: number;
  totalFootballScore: number;
  highLineScore: number;
  lowBlockScore: number;
  wingerScore: number;
  directPlayScore: number;
};

const TACTICAL_PHILOSOPHY_KEYS: { philosophy: PhilosophyId; key: keyof TacticalRow }[] = [
  { philosophy: "Gegenpressing", key: "gegenpressScore" },
  { philosophy: "Tiki-Taka", key: "tikiTakaScore" },
  { philosophy: "Counter-Attacking", key: "counterAttackScore" },
  { philosophy: "Total Football", key: "totalFootballScore" },
  { philosophy: "High Line System", key: "highLineScore" },
  { philosophy: "Low Block System", key: "lowBlockScore" },
  { philosophy: "Wing Play", key: "wingerScore" },
  { philosophy: "Direct Vertical Football", key: "directPlayScore" },
];

function clampScore(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

function scoreForPhilosophy(philosophy: PhilosophyId, tactical: TacticalRow | null): number {
  if (!tactical) return 0;
  const mapping = TACTICAL_PHILOSOPHY_KEYS.find((row) => row.philosophy === philosophy);
  if (!mapping) return 0;
  return clampScore(tactical[mapping.key] ?? 0);
}

export function resolvePositionFull(
  positionPrimary: string,
  positionFull: string | null | undefined
): string {
  const stored = positionFull?.trim();
  if (stored) return stored;
  return positionFullFromAbbreviation(positionPrimary) ?? positionPrimary;
}

export function parsePlayingPhilosophies(
  value: Prisma.JsonValue | null | undefined
): PhilosophyId[] {
  if (!Array.isArray(value)) return [];
  const out: PhilosophyId[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (!PHILOSOPHY_IDS.includes(item as PhilosophyId)) continue;
      if (out.includes(item as PhilosophyId)) continue;
      out.push(item as PhilosophyId);
      if (out.length >= 2) break;
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const row = item as Record<string, unknown>;
      const id =
        typeof row.id === "string"
          ? row.id
          : typeof row.philosophy === "string"
            ? row.philosophy
            : null;
      if (!id || !PHILOSOPHY_IDS.includes(id as PhilosophyId)) continue;
      if (out.includes(id as PhilosophyId)) continue;
      out.push(id as PhilosophyId);
      if (out.length >= 2) break;
    }
  }
  return out;
}

type ManualPhilosophyEntry = { id: PhilosophyId; score?: number };

function parseManualPhilosophyEntries(
  value: Prisma.JsonValue | null | undefined
): ManualPhilosophyEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ManualPhilosophyEntry[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (!PHILOSOPHY_IDS.includes(item as PhilosophyId)) continue;
      if (out.some((row) => row.id === item)) continue;
      out.push({ id: item as PhilosophyId });
      if (out.length >= 2) break;
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const row = item as Record<string, unknown>;
      const id =
        typeof row.id === "string"
          ? row.id
          : typeof row.philosophy === "string"
            ? row.philosophy
            : null;
      if (!id || !PHILOSOPHY_IDS.includes(id as PhilosophyId)) continue;
      if (out.some((entry) => entry.id === id)) continue;
      const score =
        typeof row.score === "number" && Number.isFinite(row.score)
          ? clampScore(row.score)
          : undefined;
      out.push({ id: id as PhilosophyId, score });
      if (out.length >= 2) break;
    }
  }
  return out;
}

export function topPhilosophiesFromTactical(
  tactical: TacticalRow | null
): HomePhilosophyScore[] {
  if (!tactical) return [];
  return [...TACTICAL_PHILOSOPHY_KEYS]
    .map(({ philosophy, key }) => ({
      name: philosophy,
      score: clampScore(tactical[key] ?? 0),
    }))
    .sort((a, b) => b.score - a.score)
    .filter((row) => row.score > 0)
    .slice(0, 2);
}

export function resolveTopPhilosophies(args: {
  playingPhilosophies: Prisma.JsonValue | null | undefined;
  tacticalScores: TacticalRow | null;
}): HomePhilosophyScore[] {
  const manual = parseManualPhilosophyEntries(args.playingPhilosophies);
  if (manual.length > 0) {
    return manual.map((entry) => ({
      name: entry.id,
      score:
        entry.score != null
          ? entry.score
          : scoreForPhilosophy(entry.id, args.tacticalScores),
    }));
  }
  return topPhilosophiesFromTactical(args.tacticalScores);
}

export function normalizePlayingPhilosophiesInput(
  input: unknown
): PhilosophyId[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) return [];
  const out: PhilosophyId[] = [];
  for (const item of input) {
    if (typeof item === "string") {
      if (!PHILOSOPHY_IDS.includes(item as PhilosophyId)) continue;
      if (out.includes(item as PhilosophyId)) continue;
      out.push(item as PhilosophyId);
      if (out.length >= 2) break;
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const row = item as Record<string, unknown>;
      const id =
        typeof row.id === "string"
          ? row.id
          : typeof row.philosophy === "string"
            ? row.philosophy
            : null;
      if (!id || !PHILOSOPHY_IDS.includes(id as PhilosophyId)) continue;
      if (out.includes(id as PhilosophyId)) continue;
      out.push(id as PhilosophyId);
      if (out.length >= 2) break;
    }
  }
  return out;
}

/** Validates admin payloads; exported for tests if needed. */
export function isPhilosophyId(value: string): value is PhilosophyId {
  return PHILOSOPHY_IDS.includes(value as PhilosophyId);
}

export { PHILOSOPHY_IDS };
