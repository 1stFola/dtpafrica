const API_PREFIX = "/api/v1";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/** True when an error originates from an aborted fetch (component unmount / stale request). */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (error instanceof Error && error.name === "AbortError");
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, signal ? { signal } : undefined);
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

export type FeaturedPlayer = {
  id: string;
  slug: string | null;
  displayName: string;
  positionPrimary: string;
  positionSecondary?: string | null;
  nationality?: string | null;
  ageGroup?: string | null;
  playerPhotoUrl?: string | null;
  overallRating?: number | null;
  offensiveRating?: number | null;
  defensiveRating?: number | null;
};

export type PublicPositionFit = {
  primaryPositionFit: string;
  secondaryPositionFit?: string | null;
  hybridFit?: string | null;
  confidence: number;
};

export type PublicPlayerProfile = FeaturedPlayer & {
  biography?: string | null;
  videoUrl?: string | null;
  dominantFoot?: string | null;
  city?: string | null;
  state?: string | null;
  age?: number | null;
  ratingAttributes?: Record<string, number> | null;
  benchmarkMetadata?: {
    nearest?: Record<string, unknown> | null;
    alternatives?: Record<string, unknown>[];
    filterInfo?: { poolSize?: number };
  } | null;
  mediaItems?: {
    type?: string;
    title?: string;
    url?: string;
    caption?: string;
    thumbnailUrl?: string;
  }[] | null;
  scoutingSummary?: string | null;
  tacticalSummary?: {
    gegenpressScore: number;
    tikiTakaScore: number;
    counterAttackScore: number;
    wingerScore: number;
    totalFootballScore: number;
  } | null;
  positionFit?: PublicPositionFit | null;
  scoutingIntelligence?: {
    tacticalScores: Record<string, number> | null;
    topTacticalScores: { label: string; value: number }[];
    tacticalFit?: { label: string; score: number } | null;
    philosophyMatch?: {
      philosophy: string;
      formation: string;
      score: number;
    } | null;
    positionFit: PublicPositionFit | null;
    philosophyFits: {
      formation: string;
      philosophy: string;
      positionSlot?: string | null;
      philosophyFitScore: number;
      positionFitScore: number;
      confidenceScore: number;
    }[];
    aggregateMetrics: {
      season: string;
      matchesPlayed: number;
      minutesPlayed: number;
      rawAverages: Record<string, unknown>;
      derivedMetrics: Record<string, unknown>;
    } | null;
  };
  scoreboardHistory?: {
    teams: {
      teamId: string;
      teamName: string;
      teamSlug: string;
      shortName: string | null;
      shirtNumber: number | null;
      displayName: string;
      position: string | null;
      competition: {
        id: string;
        name: string;
        slug: string;
        season: string;
        country: string | null;
      };
    }[];
    appearances: {
      matchId: string;
      competitionName: string;
      competitionSlug: string;
      season: string;
      kickoffAt: string | null;
      venue: string | null;
      roundLabel: string | null;
      status: string;
      homeTeam: { id: string; name: string; slug: string; shortName: string | null };
      awayTeam: { id: string; name: string; slug: string; shortName: string | null };
      score: { home: number; away: number };
      events: number;
      goals: number;
      yellowCards: number;
      redCards: number;
    }[];
    events: {
      id: string;
      type: string;
      minute: number;
      detail: string | null;
      playerLabel: string | null;
      team: { id: string; name: string; slug: string; shortName: string | null } | null;
      match: {
        id: string;
        competitionName: string;
        competitionSlug: string;
        season: string;
        kickoffAt: string | null;
        roundLabel: string | null;
        homeTeam: string;
        awayTeam: string;
        score: { home: number; away: number };
      };
    }[];
    aggregates: {
      teams: number;
      competitions: number;
      appearances: number;
      events: number;
      goals: number;
      yellowCards: number;
      redCards: number;
    };
  };
  valuation?: {
    runId: string;
    createdAt: string;
    baseScore: number;
    adjustedScore: number;
    confidenceLabel: string;
    marketValueLabel: string;
    marketValueMinEur: number | null;
    marketValueMaxEur: number | null;
    factors: unknown;
    multipliers: unknown;
    strengths: unknown;
    weaknesses: unknown;
    scoutNotes: string;
  } | null;
};

export type BlogPostSummary = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  publishedAt: string;
};

export type BlogPost = BlogPostSummary & { body: string };

export type Academy = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  country: string | null;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
};

export type RegisterResponse = {
  id: string;
  displayName: string;
  slug: string;
  registrationStatus: string;
  message: string;
};

export type ScoutingMeta = {
  formations: string[];
  philosophies: string[];
};

export type PlayerRow = {
  id: string;
  displayName: string;
  positionPrimary: string;
  overallRating: number | null;
  tacticalScores?: { gegenpressScore: number; tikiTakaScore: number } | null;
};

export type PhilosophyFitRanking = {
  playerId: string;
  philosophyFitScore: number;
  positionFitScore: number;
  primaryStyleScore: number;
  confidenceScore: number;
};

export type StrongXiResponse = {
  formation: string;
  philosophy: string;
  xi: {
    slotId: string;
    slotLabel: string;
    x: number;
    y: number;
    player: {
      id: string;
      displayName: string;
      positionPrimary: string;
      overallRating: number;
      offensiveRating: number;
      defensiveRating: number;
      playerPhotoUrl?: string | null;
    };
    fit: PhilosophyFitRanking;
  }[];
  bench: {
    slotId: string;
    slotLabel: string;
    player: { id: string; displayName: string };
    fit: PhilosophyFitRanking;
  }[];
  insights: string[];
};

export type ComparisonResponse = {
  players: { playerId: string; displayName: string; positionPrimary: string }[];
  metrics: string[];
  values: Record<string, number[]>;
};
