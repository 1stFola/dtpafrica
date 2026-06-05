import { apiGet } from "./client";

export type AcademyKpi = {
  id: string;
  label: string;
  value: number | string | null;
  detail: string;
  status: "live" | "computed" | "placeholder" | "deferred" | string;
};

export type AcademySquadPlayer = {
  id: string;
  slug: string | null;
  profilePath: string;
  displayName: string;
  positionPrimary: string;
  positionSecondary: string | null;
  age: number | null;
  ageGroup: string | null;
  dominantFoot: string | null;
  nationality: string | null;
  status: string;
  isPublic: boolean;
  playerPhotoUrl: string | null;
  overallRating: number | null;
  offensiveRating: number | null;
  defensiveRating: number | null;
  developmentIndex: number;
  exposureReadiness: number;
  tacticalFit: number | null;
  tacticalTags: string[];
  positionFit: {
    primary: string;
    secondary: string | null;
    hybrid: string | null;
    confidence: number;
  } | null;
  scoreboard: {
    teams: {
      teamId: string;
      teamName: string;
      competitionName: string;
      shirtNumber: number | null;
      position: string | null;
    }[];
    matchesPlayed: number;
    minutesPlayed: number;
    recentEvents: {
      id: string;
      type: string;
      minute: number;
      detail: string | null;
      matchId: string;
      matchLabel: string;
      createdAt: string;
    }[];
  };
  valuation: {
    runId: string;
    createdAt: string;
    adjustedScore: number;
    confidenceLabel: string;
    marketValueLabel: string;
    marketValueMinEur: number | null;
    marketValueMaxEur: number | null;
    trend: string;
  } | null;
  mediaCount: number;
  updatedAt: string;
};

export type AcademyFixture = {
  id: string;
  status: string;
  minute: number | null;
  kickoffAt: string | null;
  venue: string | null;
  roundLabel: string | null;
  competition: {
    id: string;
    name: string;
    slug: string;
    season: string;
  };
  academySide: "home" | "away" | "both";
  homeTeam: { id: string; name: string; shortName: string | null };
  awayTeam: { id: string; name: string; shortName: string | null };
  score: { home: number; away: number };
  result: string;
  events: {
    id: string;
    type: string;
    minute: number;
    detail: string | null;
    playerLabel: string | null;
  }[];
  highlights: { id: string; title: string; youtubeUrl: string }[];
};

export type AcademyActivityItem = {
  id: string;
  type: string;
  title: string;
  detail: string;
  at: string;
  href: string;
};

export type AcademyMediaItem = {
  id: string;
  type: string;
  title: string;
  url: string;
  thumbnailUrl?: string | null;
  playerName?: string | null;
  playerSlug?: string | null;
  source: string;
  publishedAt: string;
};

export type AcademyDashboard = {
  academy: {
    id: string;
    slug: string;
    name: string;
    city: string | null;
    country: string | null;
    description: string | null;
    logoUrl: string | null;
    websiteUrl: string | null;
  };
  scope: {
    mode: string;
    authNote: string;
    linkedScoreboardTeamIds: string[];
  };
  overview: {
    kpis: AcademyKpi[];
    watchlist: AcademySquadPlayer[];
    activityFeed: AcademyActivityItem[];
  };
  squad: AcademySquadPlayer[];
  fixtures: AcademyFixture[];
  development: {
    indexMethod: string;
    leaders: AcademySquadPlayer[];
    needsData: AcademySquadPlayer[];
  };
  philosophy: {
    defaultFormation: string;
    defaultPhilosophy: string;
    note: string;
    players: AcademySquadPlayer[];
  };
  valuation: {
    latest: AcademySquadPlayer[];
    totalValueRangeEur: { min: number; max: number };
  };
  media: AcademyMediaItem[];
};

export function fetchAcademyDashboard(slug: string, signal?: AbortSignal) {
  return apiGet<AcademyDashboard>(
    `/academy/${encodeURIComponent(slug)}/dashboard`,
    signal
  );
}
