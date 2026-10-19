import { getAdminApiKey, getAdminJwt } from "./admin";
import { AdminApiError } from "./admin";
import type {
  AdminSbCompetition,
  AdminSbCompetitionInput,
  AdminSbMatchInput,
  AdminSbPlayerDirectoryRow,
  AdminSbSquadRowInput,
  AdminSbStats,
  AdminSbTeam,
  AdminSbTeamInput,
  CompetitionFormat,
  CompetitionTemplatePreview,
  MatchdayRoster,
  SpotterOps,
  AdminSbTeamMergeOutcome,
  AdminSbTeamMergePlan,
} from "../modules/admin/scoreboard/types";
import type { SbMatchListItem } from "./scoreboard";

export type HighlightMediaType = "video" | "photo";

/**
 * What a bulk records action did.
 *
 * `done + failures.length === requested`. Partial success is expected rather than
 * exceptional: the server runs each row through the same guard the single-row delete uses, so
 * a competition that still has fixtures stays and says so.
 */
export type AdminSbBulkResult = {
  requested: number;
  done: number;
  failures: { id: string; reason: string }[];
};

type AdminSbSquadRowUpdateResponse = {
  squadId: string;
  playerId: string | null;
  slug: string | null;
  displayName: string;
  positionPrimary: string | null;
  teams: AdminSbPlayerDirectoryRow["teams"];
};

export type AdminMatchTimelineEvent = {
  id: string;
  type: string;
  minute: number;
  teamId: string | null;
  playerId: string | null;
  assistPlayerId: string | null;
  playerLabel: string | null;
  assistLabel?: string | null;
  detail?: string | null;
  metadata: Record<string, unknown> | null;
  team: { id: string; name: string } | null;
  player: { id: string; slug: string | null; displayName: string } | null;
  assistPlayer?: { id: string; slug: string | null; displayName: string } | null;
};

export type AdminHighlightRow = {
  id: string;
  title: string;
  youtubeUrl: string;
  mediaType: HighlightMediaType;
  duration: string | null;
  competitionId: string | null;
  matchId: string | null;
  isPublished: boolean;
  publishedAt: string;
  createdAt: string;
  competition: { id: string; name: string; slug: string } | null;
  match: {
    id: string;
    homeTeam: { name: string };
    awayTeam: { name: string };
  } | null;
};

/** A row on the admin Live streams page; see `SbLiveStream` on the API. */
export type AdminLiveStreamRow = {
  id: string;
  title: string;
  youtubeUrl: string;
  matchId: string | null;
  competitionId: string | null;
  isPublished: boolean;
  sortOrder: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  competition: { id: string; name: string; slug: string } | null;
  match: {
    id: string;
    slug: string | null;
    status: string;
    kickoffAt: string | null;
    homeTeam: { name: string };
    awayTeam: { name: string };
  } | null;
  /**
   * When the API will publish and unpublish this stream on its own: ten minutes before
   * kickoff to ten minutes after full time. Null without a linked fixture and kickoff.
   * `closesBy: "ceiling"` means the game has no result yet, so `closesAt` is the latest
   * it will come down (four hours after kickoff) rather than the expected time.
   */
  schedule: { opensAt: string; closesAt: string; closesBy: "full_time" | "ceiling" } | null;
};

export type LiveStreamInput = {
  title: string;
  youtubeUrl: string;
  /** Empty string clears the link. */
  matchId?: string;
  /** Empty string clears the link. */
  competitionId?: string;
  sortOrder?: number;
};

async function sbFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = getAdminApiKey();
  const jwt = getAdminJwt();
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-admin-api-key": key } : {}),
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new AdminApiError(text || res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

export const adminScoreboardApi = {
  stats: () => sbFetch<AdminSbStats>("/admin/scoreboard/stats"),

  listTemplates: () => sbFetch<CompetitionTemplatePreview[]>("/admin/scoreboard/templates"),

  previewTemplate: (format: CompetitionFormat) =>
    sbFetch<CompetitionTemplatePreview>(`/admin/scoreboard/templates/${format}/preview`),

  createFromTemplate: (body: {
    name: string;
    season: string;
    formatType: CompetitionFormat;
    country?: string;
    description?: string;
    isPublished?: boolean;
    teams?: Array<{ name: string; slug?: string; shortName?: string; city?: string; groupKey?: string }>;
    generateFixtures?: boolean;
    cloneFromCompetitionId?: string;
  }) =>
    sbFetch<{
      competition: { id: string; slug: string; name: string };
      fixturesCreated: number;
      progressionPreview: string[];
    }>("/admin/scoreboard/competitions/from-template", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  groupStandings: (competitionId: string) =>
    sbFetch<{
      groups: string[];
      rows: Array<{
        teamId: string;
        teamName: string;
        groupKey: string;
        rank: number;
        points: number;
        goalDifference: number;
        form: string[];
      }>;
    }>(`/admin/scoreboard/competitions/${competitionId}/standings/groups`),

  competitionPicker: () =>
    sbFetch<Array<{ id: string; name: string; slug: string; season: string }>>(
      "/admin/scoreboard/competitions/picker"
    ),

  competitions: (params?: { status?: string; type?: string; q?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.type) q.set("type", params.type);
    if (params?.q) q.set("q", params.q);
    const qs = q.toString();
    return sbFetch<AdminSbCompetition[]>(
      `/admin/scoreboard/competitions${qs ? `?${qs}` : ""}`
    );
  },

  updateCompetition: (competitionId: string, body: AdminSbCompetitionInput) =>
    sbFetch<AdminSbCompetition>(`/admin/scoreboard/competitions/${competitionId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteCompetition: (competitionId: string) =>
    sbFetch<{ ok: boolean }>(`/admin/scoreboard/competitions/${competitionId}`, {
      method: "DELETE",
    }),

  teams: (params?: { q?: string; competitionId?: string }) => {
    const q = new URLSearchParams();
    if (params?.q) q.set("q", params.q);
    if (params?.competitionId) q.set("competitionId", params.competitionId);
    const qs = q.toString();
    return sbFetch<AdminSbTeam[]>(`/admin/scoreboard/teams${qs ? `?${qs}` : ""}`);
  },

  getTeam: (teamId: string) =>
    sbFetch<AdminSbTeam>(`/admin/scoreboard/teams/${teamId}`),

  createTeam: (body: AdminSbTeamInput) =>
    sbFetch<AdminSbTeam>("/admin/scoreboard/teams", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateTeam: (teamId: string, body: AdminSbTeamInput) =>
    sbFetch<AdminSbTeam>(`/admin/scoreboard/teams/${teamId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  previewTeamMerge: (body: { sourceTeamId: string; targetTeamId: string }) =>
    sbFetch<AdminSbTeamMergePlan>("/admin/scoreboard/teams/merge/preview", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  mergeTeams: (body: { sourceTeamId: string; targetTeamId: string }) =>
    sbFetch<AdminSbTeamMergeOutcome>("/admin/scoreboard/teams/merge", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteTeam: (teamId: string) =>
    sbFetch<{ ok: boolean }>(`/admin/scoreboard/teams/${teamId}`, {
      method: "DELETE",
    }),

  players: (q?: string) => {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return sbFetch<AdminSbPlayerDirectoryRow[]>(`/admin/scoreboard/players${qs}`);
  },

  mergePlayers: (body: {
    sourcePlayerId?: string | null;
    targetPlayerId?: string | null;
    sourceSquadId?: string | null;
    targetSquadId?: string | null;
    removeSource?: boolean;
  }) =>
    sbFetch<{
      ok: boolean;
      source: { id: string; displayName: string; slug: string | null };
      target: { id: string; displayName: string; slug: string | null };
      moved: {
        eventPlayer: number;
        eventAssist: number;
        labeledPrimaryEvents: number;
        labeledSecondaryEvents: number;
        labeledAssistEvents: number;
        teamSquad: number;
        matchSquad: number;
        competitionStats: number;
        matchMetrics: number;
        duplicateMatchMetricsDropped: number;
      };
    }>("/admin/scoreboard/players/merge", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateSquadRow: (squadId: string, body: AdminSbSquadRowInput) =>
    sbFetch<AdminSbSquadRowUpdateResponse>(`/admin/scoreboard/squad/${squadId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteSquadRow: (squadId: string) =>
    sbFetch<{ ok: boolean }>(`/admin/scoreboard/squad/${squadId}`, {
      method: "DELETE",
    }),

  matches: (competitionId?: string) => {
    const qs = competitionId ? `?competitionId=${competitionId}` : "";
    return sbFetch<SbMatchListItem[]>(`/admin/scoreboard/matches${qs}`);
  },

  supervisorLive: () =>
    sbFetch<SbMatchListItem[]>("/admin/scoreboard/supervisor/live"),

  createMatch: (body: AdminSbMatchInput) =>
    sbFetch<{ ok: boolean; match: SbMatchListItem }>("/admin/scoreboard/matches", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteMatch: (matchId: string) =>
    sbFetch<{ ok: boolean }>(`/admin/scoreboard/matches/${matchId}`, {
      method: "DELETE",
    }),

  setMatchLiveFeature: (
    matchId: string,
    patch: { enabled?: boolean; audioEnabled?: boolean }
  ) =>
    sbFetch<{
      ok: boolean;
      liveFeature: {
        enabled: boolean;
        audioEnabled: boolean;
        updatedAt: string | null;
        audioUpdatedAt: string | null;
      };
    }>(
      `/admin/scoreboard/matches/${matchId}/live-feature`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      }
    ),

  patchMatchGameday: (
    matchId: string,
    body: {
      venue?: string;
      kickoffDate?: string;
      kickoffTime?: string;
      kickoffAt?: string | null;
      roundLabel?: string;
    }
  ) =>
    sbFetch<{
      ok: boolean;
      match: {
        id: string;
        venue: string | null;
        kickoffAt: string | null;
        roundLabel: string | null;
        status: string;
        homeTeam: { id: string; name: string };
        awayTeam: { id: string; name: string };
      };
    }>(`/admin/scoreboard/matches/${matchId}/gameday`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  patchMatchScore: (
    matchId: string,
    body: {
      homeScore: number;
      awayScore: number;
      status?: "finished";
      penaltyHome?: number;
      penaltyAway?: number;
      goalScorers?: string;
    }
  ) =>
    sbFetch<{
      ok: boolean;
      matchId: string;
      status: string;
      homeScore: number;
      awayScore: number;
      penaltyShootout: { home: number; away: number; winner: "home" | "away" } | null;
      goalScorers: string | null;
      standingsRefresh: "scheduled" | null;
    }>(`/admin/scoreboard/matches/${matchId}/score`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  updateMatchStats: (
    matchId: string,
    body: {
      home?: Record<string, number>;
      away?: Record<string, number>;
      source?: "manual" | "csv" | "json";
      narrative?: string;
    }
  ) =>
    sbFetch<{ ok: boolean; match: SbMatchListItem }>(
      `/admin/scoreboard/matches/${matchId}/stats`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      }
    ),

  importMatchStatsCsv: (csv: string) =>
    sbFetch<{ ok: boolean; updated: number; rows: number }>(
      "/admin/scoreboard/matches/stats/import",
      {
        method: "POST",
        body: JSON.stringify({ csv }),
      }
    ),

  exportCompetitionsCsv: () =>
    sbFetch<{ csv: string }>("/admin/scoreboard/seed/competitions/export"),

  exportTeamsCsv: (competitionId?: string) => {
    const qs = competitionId ? `?competitionId=${competitionId}` : "";
    return sbFetch<{ csv: string }>(`/admin/scoreboard/seed/teams/export${qs}`);
  },

  importCompetitionsCsv: (csv: string) =>
    sbFetch<{ imported: number }>("/admin/scoreboard/seed/competitions/import", {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),

  importTeamsCsv: (csv: string, competitionId: string) =>
    sbFetch<{ imported: number }>("/admin/scoreboard/seed/teams/import", {
      method: "POST",
      body: JSON.stringify({ csv, competitionId }),
    }),

  getRoster: (matchId: string, teamId: string) =>
    sbFetch<{
      matchId: string;
      teamId: string;
      directory: Array<{
        squadId: string;
        displayName: string;
        position: string | null;
        shirtNumber: number | null;
        playerId: string | null;
        playerSlug: string | null;
      }>;
      roster: MatchdayRoster;
    }>(`/admin/scoreboard/matches/${matchId}/roster?teamId=${teamId}`),

  saveRoster: (matchId: string, roster: MatchdayRoster) =>
    sbFetch<{ ok: boolean }>(`/admin/scoreboard/matches/${matchId}/roster`, {
      method: "PUT",
      body: JSON.stringify(roster),
    }),

  uploadMatchSquadsCsv: (matchId: string, teamId: string, csv: string) =>
    sbFetch<{
      ok: boolean;
      matchId: string;
      teamId: string;
      imported: number;
      starters: number;
      bench: number;
    }>(`/admin/scoreboard/matches/${matchId}/squads/upload`, {
      method: "POST",
      body: JSON.stringify({ teamId, csv }),
    }),

  getSpotter: (matchId: string) =>
    sbFetch<{
      match: {
        id: string;
        status: string;
        minute: number | null;
        homeScore: number;
        awayScore: number;
        homeTeam: { id: string; name: string; squad: Array<{ id: string; displayName: string; position: string | null; shirtNumber: number | null }> };
        awayTeam: { id: string; name: string; squad: Array<{ id: string; displayName: string; position: string | null; shirtNumber: number | null }> };
        events: Array<{ id: string; type: string; minute: number; playerLabel: string | null }>;
      };
      ops: SpotterOps;
      matchdayRosters: Record<string, MatchdayRoster>;
      rosterReadiness: {
        lineupsLocked: boolean;
        home: { xiCount: number; subsCount: number; complete: boolean };
        away: { xiCount: number; subsCount: number; complete: boolean };
        readyForLive: boolean;
      };
    }>(`/admin/scoreboard/matches/${matchId}/spotter`),

  patchSpotter: (
    matchId: string,
    body: Omit<Partial<SpotterOps>, "formation"> & {
      formation?: Partial<SpotterOps["formation"]>;
      lockLineups?: boolean;
      pushOfflineEvent?: { type: string; minute: number };
      popOfflineQueue?: boolean;
    }
  ) =>
    sbFetch<Awaited<ReturnType<typeof adminScoreboardApi.getSpotter>>>(
      `/admin/scoreboard/matches/${matchId}/spotter`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),

  exportCompetitionSquad: (competitionId: string, format: "json" | "csv" = "json") => {
    const qs = format === "csv" ? "?format=csv" : "";
    return sbFetch<{ format: string; rows?: unknown[]; csv?: string }>(
      `/admin/scoreboard/competitions/${competitionId}/squad/export${qs}`
    );
  },

  importSquadCsv: (teamId: string, csv: string) =>
    sbFetch<{
      imported: number;
      created: number;
      updated: number;
      /** Non-blocking notes, e.g. a shirt number used twice. */
      warnings: string[];
      teamId: string;
      competitionId: string;
    }>(`/admin/scoreboard/teams/${teamId}/squad/import`, {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),

  listMatchEvents: (matchId: string) =>
    sbFetch<AdminMatchTimelineEvent[]>(`/admin/scoreboard/matches/${matchId}/events`),

  deleteMatchEvent: (matchId: string, eventId: string) =>
    sbFetch<{ ok: boolean }>(`/admin/scoreboard/matches/${matchId}/events/${eventId}`, {
      method: "DELETE",
    }),

  ingestMatchCsv: (
    matchId: string,
    csv: string,
    replace?: boolean,
    matchComment?: string
  ) =>
    sbFetch<{
      matchId: string;
      status: string;
      homeScore: number;
      awayScore: number;
      eventsCreated: number;
      penaltyShootout: { home: number; away: number; winner: string } | null;
      standingsRefresh: string;
    }>(`/admin/scoreboard/matches/${matchId}/csv-ingest`, {
      method: "POST",
      body: JSON.stringify({ csv, replace, matchComment }),
    }),

  ingestShortEventsCsv: (matchId: string, csv: string) =>
    sbFetch<{
      matchId: string;
      eventsCreated: number;
      skippedDuplicates: number;
      events: AdminMatchTimelineEvent[];
    }>(`/admin/scoreboard/matches/${matchId}/short-events-csv`, {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),

  createHighlight: (body: {
    matchId: string;
    title: string;
    type?: HighlightMediaType;
    youtubeUrl?: string;
    imageUrl?: string;
    eventId?: string;
    timelineMinute?: number;
    thumbnailUrl?: string;
  }) =>
    sbFetch<{ id: string }>("/admin/scoreboard/highlights", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listHighlights: () => sbFetch<AdminHighlightRow[]>("/admin/scoreboard/highlights"),

  createLandingHighlight: (body: {
    title: string;
    youtubeUrl: string;
    duration: string;
    competitionId: string;
  }) =>
    sbFetch<AdminHighlightRow>("/admin/scoreboard/highlights/landing", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateHighlight: (
    id: string,
    body: {
      title?: string;
      type?: HighlightMediaType;
      youtubeUrl?: string;
      imageUrl?: string;
      duration?: string;
      competitionId?: string;
    }
  ) =>
    sbFetch<AdminHighlightRow>(`/admin/scoreboard/highlights/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** PUT alias — same handler as PATCH update. */
  replaceHighlight: (
    id: string,
    body: {
      title?: string;
      type?: HighlightMediaType;
      youtubeUrl?: string;
      imageUrl?: string;
      duration?: string;
      competitionId?: string;
    }
  ) =>
    sbFetch<AdminHighlightRow>(`/admin/scoreboard/highlights/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  publishHighlight: (id: string, isPublished: boolean) =>
    sbFetch<AdminHighlightRow>(`/admin/scoreboard/highlights/${id}/publish`, {
      method: "PATCH",
      body: JSON.stringify({ isPublished }),
    }),

  deleteHighlight: (id: string) =>
    sbFetch<{ ok: boolean }>(`/admin/scoreboard/highlights/${id}`, {
      method: "DELETE",
    }),

  // Live streams (YouTube broadcasts on the public Live Games page)
  listLiveStreams: () => sbFetch<AdminLiveStreamRow[]>("/admin/scoreboard/live-streams"),

  createLiveStream: (body: LiveStreamInput) =>
    sbFetch<AdminLiveStreamRow>("/admin/scoreboard/live-streams", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateLiveStream: (id: string, body: Partial<LiveStreamInput>) =>
    sbFetch<AdminLiveStreamRow>(`/admin/scoreboard/live-streams/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  publishLiveStream: (id: string, isPublished: boolean) =>
    sbFetch<AdminLiveStreamRow>(`/admin/scoreboard/live-streams/${id}/publish`, {
      method: "PATCH",
      body: JSON.stringify({ isPublished }),
    }),

  deleteLiveStream: (id: string) =>
    sbFetch<{ ok: boolean }>(`/admin/scoreboard/live-streams/${id}`, {
      method: "DELETE",
    }),

  // Squad Management
  listSquads: (filters?: {
    q?: string;
    teamId?: string;
    competitionId?: string;
    position?: string;
    shirtNumber?: number;
  }) => {
    const qs = new URLSearchParams();
    if (filters?.q) qs.set("q", filters.q);
    if (filters?.teamId) qs.set("teamId", filters.teamId);
    if (filters?.competitionId) qs.set("competitionId", filters.competitionId);
    if (filters?.position) qs.set("position", filters.position);
    if (filters?.shirtNumber !== undefined) qs.set("shirtNumber", filters.shirtNumber.toString());
    const query = qs.toString();
    return sbFetch<Array<{
      squadId: string;
      teamId: string;
      playerId: string | null;
      displayName: string;
      slug: string | null;
      positionPrimary: string | null;
      shirtNumber: number | null;
      team: {
        id: string;
        name: string;
        slug: string;
        competition: {
          id: string;
          name: string;
          slug: string;
        };
      };
    }>>(`/admin/scoreboard/squads${query ? `?${query}` : ""}`);
  },

  createSquad: (data: {
    displayName: string;
    teamId: string;
    position?: string | null;
    shirtNumber?: number | null;
  }) =>
    sbFetch<{
      squadId: string;
      teamId: string;
      playerId: string | null;
      displayName: string;
      slug: string | null;
      positionPrimary: string | null;
      shirtNumber: number | null;
      team: {
        id: string;
        name: string;
        slug: string;
        competition: {
          id: string;
          name: string;
          slug: string;
        };
      };
    }>("/admin/scoreboard/squads", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteSquads: (body: { squadIds: string[] }) =>
    sbFetch<{ deleted: number }>("/admin/scoreboard/squads", {
      method: "DELETE",
      body: JSON.stringify(body),
    }),

  /* Bulk actions for the Master records page. Each one goes through the same single-row
     guards on the server, so partial success is the normal outcome and the result says
     which rows refused. */
  deleteCompetitions: (competitionIds: string[]) =>
    sbFetch<AdminSbBulkResult>("/admin/scoreboard/competitions", {
      method: "DELETE",
      body: JSON.stringify({ competitionIds }),
    }),

  setCompetitionsPublished: (competitionIds: string[], isPublished: boolean) =>
    sbFetch<AdminSbBulkResult>("/admin/scoreboard/competitions", {
      method: "PATCH",
      body: JSON.stringify({ competitionIds, isPublished }),
    }),

  deleteTeams: (teamIds: string[]) =>
    sbFetch<AdminSbBulkResult>("/admin/scoreboard/teams", {
      method: "DELETE",
      body: JSON.stringify({ teamIds }),
    }),

  deleteMatches: (matchIds: string[]) =>
    sbFetch<AdminSbBulkResult>("/admin/scoreboard/matches", {
      method: "DELETE",
      body: JSON.stringify({ matchIds }),
    }),
};
