import type { PrismaClient } from "@prisma/client";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isMatchUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Resolve scoreboard match by SEO slug or legacy UUID. */
export async function resolveMatchBySlugOrId(
  prisma: PrismaClient,
  slugOrId: string
): Promise<{ id: string; slug: string } | null> {
  if (isMatchUuid(slugOrId)) {
    return prisma.sbMatch.findUnique({
      where: { id: slugOrId },
      select: { id: true, slug: true },
    });
  }

  return prisma.sbMatch.findUnique({
    where: { slug: slugOrId },
    select: { id: true, slug: true },
  });
}
