import type { PrismaClient } from "@prisma/client";
import type { SeedOptions } from "../src/seed/seed-options";
import { seedExInternationalsCup2026 } from "./seed-ex-internationals-cup-2026";
import { seedJagabanCup2026 } from "./seed-jagaban-cup-2026";

/** ScoreBoard demo seed — Jagaban Cup 2026 + Ex Internationals Cup 2026. */
export async function seedScoreboard(
  prisma: PrismaClient,
  _seedPlayerId?: string,
  options?: SeedOptions
) {
  await seedJagabanCup2026(prisma, options);
  await seedExInternationalsCup2026(prisma, options);
}
