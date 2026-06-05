import type { PrismaClient } from "@prisma/client";
import { seedJagabanCup2026 } from "./seed-jagaban-cup-2026";

/** ScoreBoard demo seed — Jagaban Cup 2026 full tournament data. */
export async function seedScoreboard(prisma: PrismaClient, _seedPlayerId?: string) {
  await seedJagabanCup2026(prisma);
}
