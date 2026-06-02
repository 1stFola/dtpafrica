import { getAdminApiKey } from "./admin";
import { ApiError, apiGet } from "./client";

export type SbTeamRef = {
  id: string;
  name: string;
  shortName: string | null;
  slug?: string;
  city?: string | null;
  logoUrl?: string | null;
};

export type SbSquadPlayer = {
  id: string;
  teamId: string;
  playerId: string | null;
  shirtNumber: number | null;
  displayName: string;
  position: string | null;
  player: {
    id: string;
    slug: string | null;
    displayName: string;
    positionPrimary: string;
    positionSecondary: string | null;
    playerPhotoUrl: string | null;
    overallRating: number | null;
    isPublic: boolean;
  } | null;
};

export type SbTeamWithSquad = SbTeamRef & {
  squad: SbSquadPlayer[];
};

export type SbCompetition = {
  id: string;
  slug: string;
  name: string;
  season: string;
  type: string;
  country: string | null;
  description: string | null;
  _count?: { teams: number; matches: number };
};

export type SbMatchStats = {
  possession?: { home: number; away: number };
  shots?: { home: number; away: number };
  shotsOnTarget?: { home: number; away: number };
  corners?: { home: number; away: number };
  fouls?: { home: number; away: number };
  xg?: { home: number; away: number };
};

export type SbMatchListItem = {
  id: string;
  status: string;
  minute: number | null;
  homeScore: number;
  awayScore: number;
  sipMatchId: string | null;
  sipIngestStatus: string;
  sipIngestedAt: string | null;
  sipIngestSummary: Record<string, unknown> | null;
  kickoffAt: string | null;
  venue: string | null;
  roundLabel: string | null;
  stats: SbMatchStats | null;
  homeTeam: SbTeamRef;
  awayTeam: SbTeamRef;
  competition: { id: string; name: string; slug: string };
  _count?: { events: number };
};

export type SbMatchEvent = {
  id: string;
  type: string;
  minute: number;
  teamId: string | null;
  playerId: string | null;
  playerLabel: string | null;
  assistPlayerId: string | null;
  assistLabel: string | null;
  detail: string | null;
  player?: {
    id: string;
    slug: string | null;
    displayName: string;
    positionPrimary: string;
    playerPhotoUrl: string | null;
  } | null;
  assistPlayer?: {
    id: string;
    slug: string | null;
    displayName: string;
    positionPrimary: string;
    playerPhotoUrl: string | null;
  } | null;
  highlights?: SbHighlight[];
};

export type SbMatchDetail = Omit<SbMatchListItem, "homeTeam" | "awayTeam"> & {
  homeTeam: SbTeamWithSquad;
  awayTeam: SbTeamWithSquad;
  events: SbMatchEvent[];
  highlights: SbHighlight[];
};

export type SipIngestResult = {
  scoreboardMatchId: string;
  sipMatchId: string | null;
  status: string;
  reason?: string;
  playersIngested: number;
  playersSkipped: number;
  players: Array<{
    playerId: string;
    status: string;
    reason?: string;
  }>;
};

export type StandingRow = {
  teamId: string;
  teamName: string;
  shortName: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  groupKey?: string;
  rank?: number;
  form?: Array<"W" | "D" | "L">;
};

export type SbHighlight = {
  id: string;
  title: string;
  youtubeUrl: string;
  publishedAt: string;
  match?: {
    id: string;
    homeTeam: SbTeamRef;
    awayTeam: SbTeamRef;
  } | null;
  competition?: { name: string } | null;
  event?: {
    id: string;
    minute: number;
    type: string;
    playerLabel: string | null;
    assistLabel: string | null;
  } | null;
};

export type SbTeamDetail = SbTeamWithSquad & {
  city: string | null;
  logoUrl: string | null;
  competition: SbCompetition;
  matches: SbMatchListItem[];
};

export type SbSearchResult = {
  query: string;
  competitions: SbCompetition[];
  teams: Array<SbTeamRef & { competition: SbCompetition; _count?: { squad: number } }>;
  matches: SbMatchListItem[];
  players: Array<{
    id: string;
    slug: string | null;
    displayName: string;
    positionPrimary: string;
    playerPhotoUrl: string | null;
    overallRating: number | null;
  }>;
};

export function fetchCompetitions() {
  return apiGet<SbCompetition[]>("/scoreboard/competitions");
}

export function fetchCompetition(slug: string, signal?: AbortSignal) {
  return apiGet<SbCompetition & { teams: SbTeamWithSquad[] }>(
    `/scoreboard/competitions/${slug}`,
    signal
  );
}

export function fetchTeam(id: string, signal?: AbortSignal) {
  return apiGet<SbTeamDetail>(`/scoreboard/teams/${id}`, signal);
}

export function searchScoreboard(query: string, signal?: AbortSignal) {
  const q = new URLSearchParams({ q: query });
  return apiGet<SbSearchResult>(`/scoreboard/search?${q.toString()}`, signal);
}

export function fetchMatches(
  params?: { status?: string; competitionId?: string },
  signal?: AbortSignal
) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.competitionId) q.set("competitionId", params.competitionId);
  const qs = q.toString();
  return apiGet<SbMatchListItem[]>(`/scoreboard/matches${qs ? `?${qs}` : ""}`, signal);
}

export function fetchMatch(id: string, signal?: AbortSignal) {
  return apiGet<SbMatchDetail>(`/scoreboard/matches/${id}`, signal);
}

export function fetchStandings(competitionId: string, signal?: AbortSignal) {
  return apiGet<{
    competitionName: string;
    season: string;
    formatType?: string | null;
    groups?: string[];
    rows: StandingRow[];
  }>(`/scoreboard/standings/${competitionId}`, signal);
}

export function fetchHighlights(competitionId?: string) {
  const q = competitionId ? `?competitionId=${competitionId}` : "";
  return apiGet<SbHighlight[]>(`/scoreboard/highlights${q}`);
}

function adminHeaders() {
  const key = getAdminApiKey();
  return {
    "Content-Type": "application/json",
    ...(key ? { "x-admin-api-key": key } : {}),
  };
}

async function apiAdminGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { headers: adminHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

async function apiAdminPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

export function fetchSupervisorLive() {
  return apiAdminGet<SbMatchListItem[]>("/scoreboard/supervisor/live");
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export function postMatchEvent(
  matchId: string,
  body: {
    type: string;
    minute: number;
    teamId?: string;
    playerLabel?: string;
    playerId?: string;
    assistPlayerId?: string;
    assistLabel?: string;
    detail?: string;
    metadata?: Record<string, unknown>;
  }
) {
  return apiAdminPost<SbMatchEvent>(`/scoreboard/matches/${matchId}/events`, body);
}

export function patchMatch(
  matchId: string,
  body: { status?: string; minute?: number; homeScore?: number; awayScore?: number }
) {
  return apiPatch<SbMatchDetail>(`/scoreboard/matches/${matchId}`, body);
}

export function ingestMatchSip(matchId: string) {
  return apiAdminPost<SipIngestResult>(`/scoreboard/matches/${matchId}/ingest-sip`, {});
}

export const EVENT_LABELS: Record<string, string> = {
  goal: "Goal",
  own_goal: "Own goal",
  yellow_card: "Yellow card",
  red_card: "Red card",
  substitution: "Substitution",
  injury: "Injury",
};
