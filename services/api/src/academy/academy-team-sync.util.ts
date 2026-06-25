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

/** Build SbTeam update payload from academy profile fields. */
export function academyFieldsForTeamSync(
  academy: Pick<Academy, "name" | "logoUrl" | "city">
): AcademyTeamSyncFields {
  return {
    name: normalizeClubName(academy.name),
    logoUrl: academy.logoUrl,
    city: academy.city,
  };
}
