import type { PrismaClient } from "@prisma/client";

/**
 * Seeding is incremental and additive only.
 *
 * There used to be a second "full" mode that pruned rows the seed data no
 * longer listed — sbMatch/sbTeam deleteMany, role permission resets, and
 * overwrites of admin-edited static content and ad config. It has been removed
 * outright: seeds run against the live database, so no seed path is allowed to
 * delete or overwrite operator data. Do not reintroduce it. If a competition
 * genuinely needs rows removed, do it from the admin UI or a one-off script
 * that says so in its name.
 */

/**
 * True when a match must not be re-seeded because the admin has already worked
 * on it — it has kicked off, finished, or had events recorded against it.
 */
export async function shouldPreserveSbMatch(
  prisma: PrismaClient,
  matchId: string
): Promise<boolean> {
  const existing = await prisma.sbMatch.findUnique({
    where: { id: matchId },
    include: { _count: { select: { events: true } } },
  });
  if (!existing) return false;

  return existing.status !== "scheduled" || existing._count.events > 0;
}
