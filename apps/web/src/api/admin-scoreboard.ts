import { getAdminApiKey } from "./admin";
import { AdminApiError } from "./admin";
import type {
  AdminSbCompetition,
  AdminSbPlayerDirectoryRow,
  AdminSbStats,
  AdminSbTeam,
  CompetitionFormat,
  CompetitionTemplatePreview,
  MatchdayRoster,
  SpotterOps,
} from "../modules/admin/scoreboard/types";
import type { SbMatchListItem } from "./scoreboard";

export type AdminHighlightRow = {
  id: string;
  title: string;
  youtubeUrl: string;
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

async function sbFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = getAdminApiKey();
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-admin-api-key": key } : {}),
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

  teams: (params?: { q?: string; competitionId?: string }) => {
    const q = new URLSearchParams();
    if (params?.q) q.set("q", params.q);
    if (params?.competitionId) q.set("competitionId", params.competitionId);
    const qs = q.toString();
    return sbFetch<AdminSbTeam[]>(`/admin/scoreboard/teams${qs ? `?${qs}` : ""}`);
  },

  players: (q?: string) => {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return sbFetch<AdminSbPlayerDirectoryRow[]>(`/admin/scoreboard/players${qs}`);
  },

  matches: (competitionId?: string) => {
    const qs = competitionId ? `?competitionId=${competitionId}` : "";
    return sbFetch<SbMatchListItem[]>(`/admin/scoreboard/matches${qs}`);
  },

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
    body: Partial<SpotterOps> & {
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
    sbFetch<{ imported: number }>(`/admin/scoreboard/teams/${teamId}/squad/import`, {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),

  listMatchEvents: (matchId: string) =>
    sbFetch<
      Array<{
        id: string;
        type: string;
        minute: number;
        teamId: string | null;
        playerId: string | null;
        assistPlayerId: string | null;
        playerLabel: string | null;
        metadata: Record<string, unknown> | null;
        team: { id: string; name: string } | null;
        player: { id: string; slug: string | null; displayName: string } | null;
      }>
    >(`/admin/scoreboard/matches/${matchId}/events`),

  deleteMatchEvent: (matchId: string, eventId: string) =>
    sbFetch<{ ok: boolean }>(`/admin/scoreboard/matches/${matchId}/events/${eventId}`, {
      method: "DELETE",
    }),

  ingestMatchCsv: (matchId: string, csv: string, replace?: boolean) =>
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
      body: JSON.stringify({ csv, replace }),
    }),

  createHighlight: (body: {
    matchId: string;
    title: string;
    youtubeUrl: string;
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
      youtubeUrl?: string;
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
      youtubeUrl?: string;
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
};
