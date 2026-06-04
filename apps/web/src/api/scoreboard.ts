import { getAdminApiKey } from "./admin";
import { ApiError, apiGet } from "./client";

export type SbTeamRef = {
  id: string;
  name: string;
  shortName: string | null;
  slug?: string;
  city?: string | null;
  logoUrl?: string | null;
  /** Knockout draw seed (stored in groupKey for cup formats). */
  groupKey?: string | null;
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
  formatType?: string | null;
  formatConfig?: Record<string, unknown> | null;
  country: string | null;
  description: string | null;
  _count?: { teams: number; matches: number };
};

export type SbCompetitionHubTeam = SbTeamRef & {
  seed: number | null;
};

export type SbMatchdayRosterSlot = {
  squadId: string;
  role?: "xi" | "sub";
};

export type SbMatchdayRoster = {
  teamId: string;
  xi: SbMatchdayRosterSlot[];
  subs: SbMatchdayRosterSlot[];
};

export type SbMatchStats = {
  possession?: { home: number; away: number };
  saves?: { home: number | null; away: number | null };
  shots?: { home: number; away: number };
  shotsOnTarget?: { home: number; away: number };
  corners?: { home: number; away: number };
  fouls?: { home: number; away: number };
  xg?: { home: number; away: number };
  narrative?: string | null;
  matchdayRosters?: Record<string, SbMatchdayRoster>;
  spotter?: {
    lineupsLocked?: boolean;
    formation?: { home: string; away: string };
  };
};

export type SbMatchGoal = {
  id: string;
  minute: number;
  type: string;
  teamId: string | null;
  playerLabel: string | null;
  player: { displayName: string; slug: string | null } | null;
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
  /** Engine stage key, e.g. "group_a", "third_place", "grand_final". */
  stageKey?: string | null;
  matchday?: number | null;
  /** Knockout extras such as penalty shootout outcome. */
  meta?: {
    penaltyShootout?: { home: number; away: number; winner: "home" | "away" };
    regulationScore?: { home: number; away: number };
  } | null;
  stats: SbMatchStats | null;
  homeTeam: SbTeamRef;
  awayTeam: SbTeamRef;
  competition: { id: string; name: string; slug: string };
  events?: SbMatchGoal[];
  _count?: { events: number };
};

export type SbStats = {
  competitions: number;
  teams: number;
  matches: number;
  playersTracked: number;
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

export type SbMatchPhoto = { url: string; caption: string | null };

export type SbMatchDetail = Omit<SbMatchListItem, "homeTeam" | "awayTeam"> & {
  homeTeam: SbTeamWithSquad;
  awayTeam: SbTeamWithSquad;
  events: SbMatchEvent[];
  highlights: SbHighlight[];
  photos?: SbMatchPhoto[];
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

export type VideoMediaType = "youtube" | "google_drive" | "external";

export type SbHighlight = {
  id: string;
  title: string;
  youtubeUrl: string;
  mediaType?: VideoMediaType;
  videoEmbedUrl?: string | null;
  thumbnailUrl?: string | null;
  duration?: string | null;
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

export type SbTeamListItem = SbTeamRef & {
  groupKey?: string | null;
  competition: { id: string; name: string; slug: string; season: string };
  _count?: { squad: number; homeMatches: number; awayMatches: number };
};

export function fetchCompetitions() {
  return apiGet<SbCompetition[]>("/scoreboard/competitions");
}

export function fetchTeams(signal?: AbortSignal) {
  return apiGet<SbTeamListItem[]>("/scoreboard/teams", signal);
}

export function fetchScoreboardStats(signal?: AbortSignal) {
  return apiGet<SbStats>("/scoreboard/stats", signal);
}

export type SbOverview = {
  stats: SbStats;
  recentMatches: SbMatchListItem[];
};

export type SbCompetitionHubTopScorer = {
  playerId: string;
  slug: string;
  displayName: string;
  positionPrimary: string;
  playerPhotoUrl: string | null;
  goals: number;
  assists: number;
  team: SbTeamRef | null;
};

export type SbCompetitionHub = {
  meta: {
    id: string;
    slug: string;
    name: string;
    season: string;
    type: string;
    formatType: string | null;
    formatConfig?: Record<string, unknown> | null;
    bracketImageUrl?: string | null;
    country: string | null;
    description: string | null;
    teamCount: number;
    matchCount: number;
    standingsUpdatedAt: string | null;
  };
  teams?: SbCompetitionHubTeam[];
  groups: Record<string, StandingRow[]>;
  topScorers: SbCompetitionHubTopScorer[];
};

export function fetchScoreboardOverview(signal?: AbortSignal) {
  return apiGet<SbOverview>("/scoreboard/overview", signal);
}

export function fetchCompetitionHub(competitionId: string, signal?: AbortSignal) {
  return apiGet<SbCompetitionHub>(
    `/scoreboard/competitions/${competitionId}/hub`,
    signal
  );
}

export {
  highlightThumbnailUrl,
  youtubeThumbnail,
  youtubeVideoId,
} from "../utils/media-url";

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
