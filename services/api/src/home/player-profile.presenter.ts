import { displayNameFromSlug } from "../players/player-slug";

export type PublicProfileStats = {
  goals: number;
  assists: number;
  appearances: number;
  minutes: number;
  cleanSheets?: number;
};

type CareerFields = {
  careerGoals: number;
  careerAssists: number;
  careerAppearances: number;
  careerMinutes: number;
  careerCleanSheets: number;
  positionPrimary: string;
};

/** Career totals for public profile cards; GK-only clean sheets. */
export function presentProfileStats(
  player: CareerFields,
  roleOverride?: string | null
): PublicProfileStats {
  const role = (roleOverride ?? player.positionPrimary).trim().toUpperCase();
  const stats: PublicProfileStats = {
    goals: player.careerGoals,
    assists: player.careerAssists,
    appearances: player.careerAppearances,
    minutes: player.careerMinutes,
  };
  if (role === "GK") {
    stats.cleanSheets = player.careerCleanSheets;
  }
  return stats;
}

export type SkeletonProfileQuery = {
  club?: string;
  competition?: string;
  role?: string;
};

export function buildSkeletonProfile(
  slugOrId: string,
  query: SkeletonProfileQuery,
  partial?: {
    id?: string;
    displayName?: string;
    slug?: string;
    positionPrimary?: string;
  }
) {
  const displayName =
    partial?.displayName?.trim() || displayNameFromSlug(slugOrId);
  const role =
    (query.role ?? partial?.positionPrimary)?.trim().toUpperCase() || null;
  const club = query.club?.trim() || null;
  const competition = query.competition?.trim() || null;

  return {
    isSkeleton: true as const,
    id: partial?.id ?? null,
    slug: partial?.slug ?? slugOrId,
    displayName,
    positionPrimary: role ?? "—",
    minutesPlayed: null,
    club,
    competition,
    role,
    stats: presentProfileStats(
      {
        careerGoals: 0,
        careerAssists: 0,
        careerAppearances: 0,
        careerMinutes: 0,
        careerCleanSheets: 0,
        positionPrimary: role ?? "",
      },
      role
    ),
    scoutingSummary: null,
    scoreboardHistory: null,
    scoutingIntelligence: null,
    valuation: null,
    tacticalSummary: null,
    positionFit: null,
    mediaItems: [],
  };
}
