import { displayNameFromSlug, playerLookupKeyFromSlug } from "./player-slug";
import { playerLookupKey } from "@dtp/engines";
import type { PrismaClient } from "@prisma/client";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PLAYER_REF_SELECT = {
  id: true,
  slug: true,
  displayName: true,
  positionPrimary: true,
  isPublic: true,
} as const;

export type PlayerRef = {
  id: string;
  slug: string;
  displayName: string;
  positionPrimary: string;
  isPublic: boolean;
};

/** Resolve master Player by UUID, slug, or normalized name from slug text. */
export async function resolvePlayerBySlugOrId(
  prisma: PrismaClient,
  slugOrId: string
): Promise<PlayerRef | null> {
  if (UUID_RE.test(slugOrId)) {
    return prisma.player.findUnique({
      where: { id: slugOrId },
      select: PLAYER_REF_SELECT,
    });
  }

  const bySlug = await prisma.player.findUnique({
    where: { slug: slugOrId },
    select: PLAYER_REF_SELECT,
  });
  if (bySlug) return bySlug;

  const key = playerLookupKeyFromSlug(slugOrId);
  if (key) {
    const byNormalized = await prisma.player.findUnique({
      where: { normalizedName: key },
      select: PLAYER_REF_SELECT,
    });
    if (byNormalized) return byNormalized;
  }

  const displayKey = playerLookupKey(displayNameFromSlug(slugOrId));
  if (displayKey && displayKey !== key) {
    return prisma.player.findUnique({
      where: { normalizedName: displayKey },
      select: PLAYER_REF_SELECT,
    });
  }

  return null;
}
