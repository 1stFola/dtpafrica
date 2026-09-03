import { createRequire } from "module";
import * as path from "path";
import type { PrismaClient } from "@prisma/client";
import type { SeedOptions } from "./seed-options";

type SeedScoreboardFn = (
  prisma: PrismaClient,
  seedPlayerId?: string,
  options?: SeedOptions
) => Promise<void>;
type SeedMvceFn = (prisma: PrismaClient, playerId: string) => Promise<void>;
type SeedLegacyAcademiesFn = (
  prisma: PrismaClient,
  options?: SeedOptions
) => Promise<number>;
type LegacyPlayerSeedResult = {
  playerCount: number;
  academyLinkCount: number;
  sampleSlugs: string[];
};
type SeedLegacyPlayersFn = (
  prisma: PrismaClient,
  options?: SeedOptions
) => Promise<LegacyPlayerSeedResult>;
type SeedScoutToProInternationalTournament2026Fn = (
  prisma: PrismaClient,
  seedPlayerId?: string,
  options?: SeedOptions
) => Promise<void>;

type SeedScoutToProTeamsFixturesSquadsFn = (
  prisma: PrismaClient,
  options?: SeedOptions
) => Promise<{
  teamsCreated: number;
  matchesCreated: number;
  squadRecordsCreated: number;
  playersProcessed: number;
}>;

const requireFromDist = createRequire(__filename);
const prismaSeedDir = path.join(__dirname, "../../prisma");

function loadModule<T>(filename: string): T {
  return requireFromDist(path.join(prismaSeedDir, filename)) as T;
}

export function seedScoreboard(
  prisma: PrismaClient,
  seedPlayerId?: string,
  options?: SeedOptions
) {
  const mod = loadModule<{ seedScoreboard: SeedScoreboardFn }>("seed-scoreboard");
  return mod.seedScoreboard(prisma, seedPlayerId, options);
}

export function seedMvce(prisma: PrismaClient, playerId: string) {
  const mod = loadModule<{ seedMvce: SeedMvceFn }>("seed-mvce");
  return mod.seedMvce(prisma, playerId);
}

export function seedLegacyAcademies(prisma: PrismaClient, options?: SeedOptions) {
  const mod = loadModule<{ seedLegacyAcademies: SeedLegacyAcademiesFn }>(
    "seed-legacy-academies"
  );
  return mod.seedLegacyAcademies(prisma, options);
}

export function seedLegacyPlayers(prisma: PrismaClient, options?: SeedOptions) {
  const mod = loadModule<{ seedLegacyPlayers: SeedLegacyPlayersFn }>(
    "seed-legacy-players"
  );
  return mod.seedLegacyPlayers(prisma, options);
}

export function seedScoutToProInternationalTournament2026(
  prisma: PrismaClient,
  seedPlayerId?: string,
  options?: SeedOptions
) {
  const mod = loadModule<{ seedScoutToProInternationalTournament2026: SeedScoutToProInternationalTournament2026Fn }>(
    "seed-scout-to-pro-international-tournament-2026"
  );
  return mod.seedScoutToProInternationalTournament2026(prisma, seedPlayerId, options);
}

export function seedScoutToProTeamsFixturesSquads(
  prisma: PrismaClient,
  options?: SeedOptions
) {
  const mod = loadModule<{ seedScoutToProTeamsFixturesSquads: SeedScoutToProTeamsFixturesSquadsFn }>(
    "seed-scout-to-pro-international-tournament-2026-teams-fixtures"
  );
  return mod.seedScoutToProTeamsFixturesSquads(prisma, options);
}
