import { getAdminApiKey, getAdminJwt } from "./admin";
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
  /** Competition crest. Null for competitions that have not supplied one. */
  logoUrl?: string | null;
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

export type SbMatchSquadPlayer = SbSquadPlayer & {
  isStarter: boolean;
};

export type SbMatchSquadTeam = {
  team: SbTeamRef;
  starting: SbMatchSquadPlayer[];
  bench: SbMatchSquadPlayer[];
  players: SbMatchSquadPlayer[];
};

export type SbMatchSquadsResponse = {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  teams: Record<string, SbMatchSquadTeam>;
};

export type SbMatchStats = {
  goals?: { home: number; away: number };
  possession?: { home: number; away: number };
  saves?: { home: number | null; away: number | null };
  shots?: { home: number; away: number };
  shotsOnTarget?: { home: number; away: number };
  shotsOffTarget?: { home: number; away: number };
  blockedShots?: { home: number; away: number };
  corners?: { home: number; away: number };
  fouls?: { home: number; away: number };
  offsides?: { home: number; away: number };
  yellowCards?: { home: number; away: number };
  redCards?: { home: number; away: number };
  penaltiesAwarded?: { home: number; away: number };
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
  slug: string;
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
  /** Admin-authored match report shown on the stats tab (not CSV narrative). */
  matchComment?: string | null;
  /** Engine stage key, e.g. "group_a", "third_place", "grand_final". */
  stageKey?: string | null;
  matchday?: number | null;
  /** Knockout extras such as penalty shootout outcome. */
  meta?: {
    leg?: "first_leg" | "second_leg";
    penaltyShootout?: { home: number; away: number; winner: "home" | "away" };
    regulationScore?: { home: number; away: number };
    goalScorers?: string | null;
  } | null;
  stats: SbMatchStats | null;
  homeTeam: SbTeamRef;
  awayTeam: SbTeamRef;
  competition: { id: string; name: string; slug: string; logoUrl?: string | null };
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
  playerLabel2: string | null;
  assistPlayerId: string | null;
  assistLabel: string | null;
  detail: string | null;
  metadata?: {
    csvEventType?: string;
    flowKind?: string;
    source?: string;
    [key: string]: unknown;
  } | null;
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
  highlightKind?: "video" | "photo";
  mediaType?: VideoMediaType | "photo";
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
  params?: { status?: string; competitionId?: string; limit?: number },
  signal?: AbortSignal
) {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.competitionId) q.set("competitionId", params.competitionId);
  if (params?.limit != null) q.set("limit", String(params.limit));
  const qs = q.toString();
  return apiGet<SbMatchListItem[]>(`/scoreboard/matches${qs ? `?${qs}` : ""}`, signal);
}

export function fetchMatch(slugOrId: string, signal?: AbortSignal) {
  return apiGet<SbMatchDetail>(`/scoreboard/matches/${slugOrId}`, signal);
}

export function fetchMatchSquads(slugOrId: string, signal?: AbortSignal) {
  return apiGet<SbMatchSquadsResponse>(`/scoreboard/matches/${slugOrId}/squads`, signal);
}

export type StatLeaderMetric = "goals" | "assists" | "yellow" | "red";

export type StatLeaderRow = {
  rank: number;
  playerId: string | null;
  playerName: string;
  playerSlug: string;
  photoUrl: string | null;
  count: number;
  team: SbTeamRef | null;
};

export type StatLeadersResponse = {
  metric: StatLeaderMetric;
  competitionId: string;
  competitionSlug: string;
  leaders: StatLeaderRow[];
};

export function fetchStatLeaders(
  competitionSlug: string,
  metric: StatLeaderMetric = "goals",
  signal?: AbortSignal
) {
  const q = new URLSearchParams({ metric });
  return apiGet<StatLeadersResponse>(
    `/scoreboard/competitions/${competitionSlug}/stat-leaders?${q.toString()}`,
    signal
  );
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
  const jwt = getAdminJwt();
  return {
    "Content-Type": "application/json",
    ...(key ? { "x-admin-api-key": key } : {}),
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
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
  return apiAdminGet<SbMatchListItem[]>("/admin/scoreboard/supervisor/live");
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
    playerLabel2?: string;
    playerId?: string;
    assistPlayerId?: string;
    assistLabel?: string;
    detail?: string;
    metadata?: Record<string, unknown>;
  }
) {
  return apiAdminPost<SbMatchEvent>(`/admin/scoreboard/matches/${matchId}/events`, body);
}

export function patchMatch(
  matchId: string,
  body: { status?: string; minute?: number; homeScore?: number; awayScore?: number }
) {
  return apiPatch<SbMatchDetail>(`/admin/scoreboard/matches/${matchId}`, body);
}

export function ingestMatchSip(matchId: string) {
  return apiAdminPost<SipIngestResult>(
    `/admin/scoreboard/matches/${matchId}/ingest-sip`,
    {}
  );
}

export const EVENT_LABELS: Record<string, string> = {
  added_time: "Added time",
  aerial_duel_won: "Aerial duel won",
  blocked_shot: "Blocked shot",
  chance: "Chance",
  assist: "Assist",
  clearance: "Clearance",
  close_chance: "Close chance",
  corner_kick: "Corner",
  counter_attack: "Counter attack",
  cross: "Cross",
  dangerous_attack: "Dangerous attack",
  dangerous_cross: "Dangerous cross",
  dangerous_run: "Dangerous run",
  disallowed_goal: "Disallowed goal",
  dominance: "Dominance",
  dribble: "Dribble",
  double_save: "Double save",
  foul: "Foul",
  freekick: "Free kick",
  full_time: "Full time",
  game_management: "Game management",
  goal: "Goal",
  goal_penalty: "Penalty goal",
  goal_kick: "Goal kick",
  goal_line_clearance: "Goal-line clearance",
  goal_scorers_update: "Goal scorers update",
  goalkeeper_claim: "Goalkeeper claim",
  goalkeeper_command: "Goalkeeper command",
  goalkeeper_distribution: "Goalkeeper distribution",
  goalkeeper_error: "Goalkeeper error",
  goalkeeper_intervention: "Goalkeeper intervention",
  half_time: "Half-time",
  header_missed: "Header missed",
  injury: "Injury",
  injury_substitution: "Injury substitution",
  interception: "Interception",
  kick_off: "Kick-off",
  late_defense: "Late defense",
  long_throw: "Long throw",
  match_control: "Match control",
  match_flow: "Match moment",
  medical_timeout: "Medical timeout",
  midfield_battle: "Midfield battle",
  missed_chance: "Missed chance",
  offside: "Offside",
  one_on_one: "One-on-one",
  own_goal: "Own goal",
  penalty_awarded: "Penalty awarded",
  penalty_saved: "Penalty saved",
  penalty_shootout: "Shootout begins",
  poor_delivery: "Poor delivery",
  possession: "Possession",
  possession_lost: "Possession lost",
  pressure: "Pressure",
  recovery_tackle: "Recovery tackle",
  red_card: "Red card",
  restart_play: "Restart play",
  save: "Save",
  score_update: "Score update",
  second_half_kickoff: "Second half",
  shot_off_target: "Shot off target",
  shootout_goal: "Shootout goal",
  shootout_miss: "Shootout miss",
  substitution: "Substitution",
  sustained_pressure: "Sustained pressure",
  tactical_substitution: "Tactical substitution",
  throw_in: "Throw-in",
  volley_missed: "Volley missed",
  water_break: "Water break",
  woodwork: "Hit woodwork",
  yellow_card: "Yellow card",
};
