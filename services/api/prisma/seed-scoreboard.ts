import type { PrismaClient } from "@prisma/client";
import { seedExInternationalsCup2026 } from "./seed-ex-internationals-cup-2026";
import { seedJagabanCup2026 } from "./seed-jagaban-cup-2026";

/** ScoreBoard demo seed — Jagaban Cup 2026 + Ex Internationals Cup 2026. */
export async function seedScoreboard(prisma: PrismaClient, _seedPlayerId?: string) {
  await seedJagabanCup2026(prisma);
  await seedExInternationalsCup2026(prisma);
}
