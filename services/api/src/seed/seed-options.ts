import type { PrismaClient } from "@prisma/client";

export type SeedMode = "incremental" | "full";

export type SeedOptions = {
  mode?: SeedMode;
};

export function resolveSeedMode(options?: SeedOptions): SeedMode {
  return options?.mode === "full" ? "full" : "incremental";
}

export function isFullSeed(options?: SeedOptions): boolean {
  return resolveSeedMode(options) === "full";
}

/** Skip destructive match re-seed when admin has progressed or edited events. */
export async function shouldPreserveSbMatch(
  prisma: PrismaClient,
  matchId: string,
  options?: SeedOptions
): Promise<boolean> {
  if (isFullSeed(options)) return false;

  const existing = await prisma.sbMatch.findUnique({
    where: { id: matchId },
    include: { _count: { select: { events: true } } },
  });
  if (!existing) return false;

  return existing.status !== "scheduled" || existing._count.events > 0;
}
