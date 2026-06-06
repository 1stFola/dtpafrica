import { createRequire } from "module";
import * as path from "path";
import type { PrismaClient } from "@prisma/client";

type SeedScoreboardFn = (prisma: PrismaClient, seedPlayerId?: string) => Promise<void>;
type SeedMvceFn = (prisma: PrismaClient, playerId: string) => Promise<void>;
type SeedLegacyAcademiesFn = (prisma: PrismaClient) => Promise<number>;
type LegacyPlayerSeedResult = {
  playerCount: number;
  academyLinkCount: number;
  sampleSlugs: string[];
};
type SeedLegacyPlayersFn = (prisma: PrismaClient) => Promise<LegacyPlayerSeedResult>;

const requireFromDist = createRequire(__filename);
const prismaSeedDir = path.join(__dirname, "../../prisma");

function loadModule<T>(filename: string): T {
  return requireFromDist(path.join(prismaSeedDir, filename)) as T;
}

export function seedScoreboard(prisma: PrismaClient, seedPlayerId?: string) {
  const mod = loadModule<{ seedScoreboard: SeedScoreboardFn }>("seed-scoreboard");
  return mod.seedScoreboard(prisma, seedPlayerId);
}

export function seedMvce(prisma: PrismaClient, playerId: string) {
  const mod = loadModule<{ seedMvce: SeedMvceFn }>("seed-mvce");
  return mod.seedMvce(prisma, playerId);
}

export function seedLegacyAcademies(prisma: PrismaClient) {
  const mod = loadModule<{ seedLegacyAcademies: SeedLegacyAcademiesFn }>(
    "seed-legacy-academies"
  );
  return mod.seedLegacyAcademies(prisma);
}

export function seedLegacyPlayers(prisma: PrismaClient) {
  const mod = loadModule<{ seedLegacyPlayers: SeedLegacyPlayersFn }>(
    "seed-legacy-players"
  );
  return mod.seedLegacyPlayers(prisma);
}
