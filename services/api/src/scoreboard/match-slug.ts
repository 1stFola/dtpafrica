import type { PrismaClient } from "@prisma/client";

export type MatchSlugLeg = "first_leg" | "second_leg";

export function buildMatchSlugBase(homeSlug: string, awaySlug: string): string {
  return `${homeSlug}-vs-${awaySlug}`;
}

/** Every slug a pairing can take, in the order allocateMatchSlug tries them. */
export function matchSlugCandidates(
  homeSlug: string,
  awaySlug: string,
  leg?: MatchSlugLeg | null
): string[] {
  const base = buildMatchSlugBase(homeSlug, awaySlug);
  const candidates = [base];
  if (leg === "second_leg") candidates.push(`${base}-leg-2`);
  for (let i = 2; i < 100; i++) candidates.push(`${base}-${i}`);
  return candidates;
}

/** Pick a unique slug within a batch (seeds) or against an existing set. */
export function allocateMatchSlug(
  homeSlug: string,
  awaySlug: string,
  used: Set<string>,
  leg?: MatchSlugLeg | null
): string {
  const base = buildMatchSlugBase(homeSlug, awaySlug);
  for (const candidate of matchSlugCandidates(homeSlug, awaySlug, leg)) {
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not allocate unique match slug for ${base}`);
}

export function matchPathSegment(slug: string | null | undefined, id: string): string {
  return slug ?? id;
}

export function readMatchLeg(meta: unknown): MatchSlugLeg | null {
  if (!meta || typeof meta !== "object") return null;
  const leg = (meta as { leg?: unknown }).leg;
  if (leg === "second_leg") return "second_leg";
  if (leg === "first_leg") return "first_leg";
  return null;
}

export async function loadExistingMatchSlugs(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.sbMatch.findMany({
    where: { slug: { not: null } },
    select: { slug: true },
  });
  return new Set(rows.map((r) => r.slug as string));
}

export type SeedMatchSlugAllocator = (
  matchId: string,
  homeSlug: string,
  awaySlug: string,
  leg?: MatchSlugLeg | null
) => string;

/**
 * Slugs for a seed that upserts matches on fixed ids.
 *
 * A match that already has a slug for the same pairing keeps it. Seeds used to
 * call allocateMatchSlug against every slug in the table, and that set includes
 * the match's own slug, so each run gave a still-scheduled match "<base>-2" and
 * the next run gave it "<base>" back. Every full seed moved those URLs.
 *
 * A match whose teams have changed since its slug was given gets a new one,
 * because the old slug would name the wrong teams.
 */
export async function createSeedMatchSlugAllocator(
  prisma: PrismaClient,
  matchIds: string[]
): Promise<SeedMatchSlugAllocator> {
  const used = await loadExistingMatchSlugs(prisma);
  const rows = await prisma.sbMatch.findMany({
    where: { id: { in: matchIds } },
    select: { id: true, slug: true },
  });
  const current = new Map(rows.map((r) => [r.id, r.slug]));
  return (matchId, homeSlug, awaySlug, leg) => {
    const own = current.get(matchId);
    if (own && matchSlugCandidates(homeSlug, awaySlug, leg).includes(own)) return own;
    const slug = allocateMatchSlug(homeSlug, awaySlug, used, leg);
    /* Remembered so a second call for the same match in one run returns the same
       slug rather than taking the next free one. */
    current.set(matchId, slug);
    return slug;
  };
}

/** Assign slugs to scoreboard matches that were created before the slug column existed. */
export async function backfillMissingMatchSlugs(prisma: PrismaClient): Promise<number> {
  const matches = await prisma.sbMatch.findMany({
    where: { slug: null },
    select: {
      id: true,
      meta: true,
      homeTeam: { select: { slug: true } },
      awayTeam: { select: { slug: true } },
    },
    orderBy: [{ kickoffAt: "asc" }, { createdAt: "asc" }],
  });
  if (matches.length === 0) return 0;

  const used = await loadExistingMatchSlugs(prisma);
  let updated = 0;

  for (const match of matches) {
    const slug = allocateMatchSlug(
      match.homeTeam.slug,
      match.awayTeam.slug,
      used,
      readMatchLeg(match.meta)
    );
    await prisma.sbMatch.update({
      where: { id: match.id },
      data: { slug },
    });
    updated += 1;
  }

  return updated;
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
  const used = new Set(
    rows.map((r) => r.slug).filter((slug): slug is string => slug != null)
  );
  return allocateMatchSlug(homeSlug, awaySlug, used, opts?.leg);
}
