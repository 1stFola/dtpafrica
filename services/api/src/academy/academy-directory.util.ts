import type { Academy, SbTeam } from "@prisma/client";

/** One competition a club has entered, linking to that entry's team page. */
export type ClubCompetitionEntry = {
  competitionId: string;
  competitionName: string;
  competitionSlug: string;
  season: string;
  teamId: string;
};

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
  /** Every published competition the club has entered, newest season first. */
  competitions: ClubCompetitionEntry[];
};

/** A club's team rows, as selected for the public listing. */
export type ClubTeamRow = {
  id: string;
  competition: { id: string; name: string; slug: string; season: string; isPublished: boolean };
};

/** Select for the teams a club profile needs to list its competitions. */
export const CLUB_TEAMS_SELECT = {
  select: {
    id: true,
    competition: {
      select: { id: true, name: true, slug: true, season: true, isPublished: true },
    },
  },
} as const;

export function buildSeedByTeamSlug(
  teams: Pick<SbTeam, "slug" | "groupKey">[]
): Map<string, number | null> {
  return new Map(teams.map((t) => [t.slug, Number(t.groupKey) || null]));
}

export function presentClubCompetitions(teams: ClubTeamRow[]): ClubCompetitionEntry[] {
  const seen = new Set<string>();
  return teams
    .filter((team) => team.competition.isPublished)
    .map((team) => ({
      competitionId: team.competition.id,
      competitionName: team.competition.name,
      competitionSlug: team.competition.slug,
      season: team.competition.season,
      teamId: team.id,
    }))
    .sort(
      (a, b) =>
        b.season.localeCompare(a.season, undefined, { numeric: true }) ||
        a.competitionName.localeCompare(b.competitionName)
    )
    .filter((entry) => {
      if (seen.has(entry.competitionId)) return false;
      seen.add(entry.competitionId);
      return true;
    });
}

export function presentAcademyListing(
  row: Academy,
  seedByTeamSlug: Map<string, number | null>,
  teams: ClubTeamRow[] = []
): PublicAcademyListing {
  const isExIntl = row.slug.startsWith("ex-intl-");
  const teamSlug = isExIntl ? row.slug.slice("ex-intl-".length) : null;
  const seedFromTeam = teamSlug ? (seedByTeamSlug.get(teamSlug) ?? null) : null;
  const seedFromDesc = row.description?.match(/seed\s+(\d+)/i)?.[1];
  const seed = seedFromTeam ?? (seedFromDesc ? Number(seedFromDesc) : null);

  /*
   * "Partner Academy" is reserved for clubs with a partner login. Club profiles
   * created automatically from ScoreBoard teams have none, and calling them
   * partners would misstate the relationship.
   */
  const badges = [row.loginUsername ? "Partner Academy" : "Club"];
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
    competitions: presentClubCompetitions(teams),
  };
}
