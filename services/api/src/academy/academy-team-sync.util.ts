import type { Academy } from "@prisma/client";
import { normalizeClubName } from "@dtp/engines";

const EX_INTL_PREFIX = "ex-intl-";

/** Scoreboard team slug linked to an academy record (Ex Internationals convention). */
export function scoreboardTeamSlugForAcademy(academy: Pick<Academy, "slug">): string | null {
  if (academy.slug.startsWith(EX_INTL_PREFIX)) {
    return academy.slug.slice(EX_INTL_PREFIX.length);
  }
  return academy.slug;
}

export type AcademyTeamSyncFields = {
  name?: string;
  logoUrl?: string | null;
  city?: string | null;
};

/**
 * Build SbTeam update payload from academy profile fields.
 *
 * An empty crest or city on the profile is left out rather than written as
 * null: saving a club profile without a logo used to wipe the logo from every
 * one of its teams, in every competition.
 */
export function academyFieldsForTeamSync(
  academy: Pick<Academy, "name" | "logoUrl" | "city">
): AcademyTeamSyncFields {
  return {
    name: normalizeClubName(academy.name),
    ...(academy.logoUrl?.trim() ? { logoUrl: academy.logoUrl } : {}),
    ...(academy.city?.trim() ? { city: academy.city } : {}),
  };
}
