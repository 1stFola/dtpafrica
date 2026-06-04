import type { Academy, SbTeam } from "@prisma/client";

export type PublicAcademyListing = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  country: string | null;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  loginUsername: string | null;
  teamSlug: string | null;
  seed: number | null;
  badges: string[];
};

export function buildSeedByTeamSlug(
  teams: Pick<SbTeam, "slug" | "groupKey">[]
): Map<string, number | null> {
  return new Map(teams.map((t) => [t.slug, Number(t.groupKey) || null]));
}

export function presentAcademyListing(
  row: Academy,
  seedByTeamSlug: Map<string, number | null>
): PublicAcademyListing {
  const isExIntl = row.slug.startsWith("ex-intl-");
  const teamSlug = isExIntl ? row.slug.slice("ex-intl-".length) : null;
  const seedFromTeam = teamSlug ? (seedByTeamSlug.get(teamSlug) ?? null) : null;
  const seedFromDesc = row.description?.match(/seed\s+(\d+)/i)?.[1];
  const seed = seedFromTeam ?? (seedFromDesc ? Number(seedFromDesc) : null);

  const badges = ["Partner Academy"];
  if (isExIntl) badges.push("Ex Internationals Cup Participant");

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    city: row.city,
    country: row.country,
    description: row.description,
    logoUrl: row.logoUrl,
    websiteUrl: row.websiteUrl,
    loginUsername: row.loginUsername,
    teamSlug,
    seed: Number.isFinite(seed) ? seed : null,
    badges,
  };
}
