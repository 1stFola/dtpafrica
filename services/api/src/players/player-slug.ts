import { normalizePlayerName, playerLookupKey } from "@dtp/engines";
import type { PrismaClient } from "@prisma/client";

/** URL-safe slug from a display name (no id suffix). */
export function slugifyPlayerName(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "player";
}

/** Turn a route slug into a readable title ("ahmed-adesanu" → "Ahmed Adesanu"). */
export function displayNameFromSlug(slug: string): string {
  const cleaned = slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Player";
  return cleaned
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Lookup key from slug when no Player row exists yet. */
export function normalizedNameFromSlug(slug: string): string {
  return normalizePlayerName(displayNameFromSlug(slug));
}

export function playerLookupKeyFromSlug(slug: string): string {
  return playerLookupKey(normalizedNameFromSlug(slug));
}

/** Allocate a unique `players.slug` (optionally scoped away from `excludeId`). */
export async function resolveUniquePlayerSlug(
  prisma: PrismaClient,
  displayName: string,
  excludeId?: string
): Promise<string> {
  const base = slugifyPlayerName(displayName);
  let slug = base;
  let n = 0;
  while (true) {
    const clash = await prisma.player.findFirst({
      where: {
        slug,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!clash) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

/** Preview slug allocation without persisting. */
export async function previewPlayerSlug(
  prisma: PrismaClient,
  displayName: string,
  excludeId?: string
): Promise<{ slug: string; available: boolean }> {
  const slug = await resolveUniquePlayerSlug(prisma, displayName, excludeId);
  const base = slugifyPlayerName(displayName);
  return { slug, available: slug === base };
}
