import type { PrismaClient } from "@prisma/client";

export type MatchSlugLeg = "first_leg" | "second_leg";

export function buildMatchSlugBase(homeSlug: string, awaySlug: string): string {
  return `${homeSlug}-vs-${awaySlug}`;
}

/** Pick a unique slug within a batch (seeds) or against an existing set. */
export function allocateMatchSlug(
  homeSlug: string,
  awaySlug: string,
  used: Set<string>,
  leg?: MatchSlugLeg | null
): string {
  const base = buildMatchSlugBase(homeSlug, awaySlug);
  const candidates = [base];
  if (leg === "second_leg") candidates.push(`${base}-leg-2`);
  for (let i = 2; i < 100; i++) candidates.push(`${base}-${i}`);

  for (const candidate of candidates) {
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not allocate unique match slug for ${base}`);
}

export async function resolveUniqueMatchSlug(
  prisma: PrismaClient,
  homeSlug: string,
  awaySlug: string,
  opts?: { leg?: MatchSlugLeg | null; excludeId?: string }
): Promise<string> {
  const rows = await prisma.sbMatch.findMany({
    where: opts?.excludeId ? { id: { not: opts.excludeId } } : undefined,
    select: { slug: true },
  });
  const used = new Set(rows.map((r) => r.slug));
  return allocateMatchSlug(homeSlug, awaySlug, used, opts?.leg);
}
