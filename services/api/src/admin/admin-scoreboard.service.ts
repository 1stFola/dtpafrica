import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { normalizeClubName } from "@dtp/engines";
import { isAllowedImageMediaUrl, normalizeVideoMediaUrl } from "../shared/media-url";
import type { CreateAdminHighlightDto } from "./dto/create-admin-highlight.dto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { getRosterReadiness } from "../scoreboard/roster-guard";
import { PlayerDirectoryService } from "../scoreboard/player-directory.service";
import { CompetitionEngineService } from "../scoreboard/competition-engine.service";
import { ScoreboardService } from "../scoreboard/scoreboard.service";
import { CreateMatchEventDto } from "../scoreboard/dto/create-event.dto";
import type { CreateCompetitionFromTemplateInput } from "../scoreboard/competition-engine.service";

export type SbCompetitionStatus = "active" | "upcoming" | "draft" | "archived";

export type MatchdayRosterSlot = {
  squadId: string;
  displayName: string;
  position: string | null;
  shirtNumber: number | null;
  playerId: string | null;
  playerSlug: string | null;
  role: "xi" | "sub";
  cleanSheets?: number;
};

export type MatchdayRosterPayload = {
  teamId: string;
  xi: MatchdayRosterSlot[];
  subs: MatchdayRosterSlot[];
};

export type SpotterOpsState = {
  lineupsLocked: boolean;
  officialsConfirmed: number;
  addedTime: number;
  offlineQueueCount: number;
  lastUndoAt: string | null;
};

type SpotterStatsStored = {
  lineupsLocked: boolean;
  officialsConfirmed: number;
  addedTime: number;
  formation?: { home: string; away: string };
  pitchSelection?: { teamId: string; squadId: string } | null;
  offlineQueue?: Array<{ id: string; type: string; minute: number; at: string }>;
};

type MatchStatsJson = {
  matchdayRosters?: Record<string, MatchdayRosterPayload>;
  spotter?: SpotterStatsStored;
  possession?: { home: number; away: number };
};

function defaultSpotterState(): SpotterStatsStored {
  return {
    lineupsLocked: false,
    officialsConfirmed: 0,
    addedTime: 0,
    offlineQueue: [],
  };
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function deriveCompetitionStatus(
  isPublished: boolean,
  matchStatuses: string[]
): SbCompetitionStatus {
  if (!isPublished) return "draft";
  if (matchStatuses.some((s) => s === "live" || s === "halftime")) return "active";
  if (
    matchStatuses.length > 0 &&
    matchStatuses.every((s) => s === "finished" || s === "cancelled")
  ) {
    return "archived";
  }
  return "upcoming";
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c.length)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((c) => c.length)) rows.push(row);
  return rows;
}

function csvError(label: string, detail: string): BadRequestException {
  return new BadRequestException(`${label}: ${detail}`);
}

@Injectable()
export class AdminScoreboardService {
  private statsCache: { at: number; payload: Awaited<ReturnType<AdminScoreboardService["fetchStats"]>> } | null =
    null;
  private readonly statsTtlMs = 30_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ScoreboardService) private readonly scoreboard: ScoreboardService,
    @Inject(CompetitionEngineService)
    private readonly competitionEngine: CompetitionEngineService,
    @Inject(PlayerDirectoryService)
    private readonly playerDirectory: PlayerDirectoryService
  ) {}

  async stats() {
    const now = Date.now();
    if (this.statsCache && now - this.statsCache.at < this.statsTtlMs) {
      return this.statsCache.payload;
    }
    const payload = await this.fetchStats();
    this.statsCache = { at: now, payload };
    return payload;
  }

  private async fetchStats() {
    const [competitions, teams, squadRows, matches, highlights, liveMatches] =
      await Promise.all([
        this.prisma.sbCompetition.count(),
        this.prisma.sbTeam.count(),
        this.prisma.sbTeamSquad.count(),
        this.prisma.sbMatch.count(),
        this.prisma.sbHighlight.count(),
        this.prisma.sbMatch.count({
          where: { status: { in: ["live", "halftime"] } },
        }),
      ]);
    return {
      competitions,
      teams,
      squadRows,
      matches,
      highlights,
      liveMatches,
    };
  }

  /** Lightweight list for seeders / dropdowns (no match status derivation). */
  listCompetitionPicker() {
    return this.prisma.sbCompetition.findMany({
      select: { id: true, name: true, slug: true, season: true },
      orderBy: { name: "asc" },
    });
  }

  async listCompetitions(filters?: { status?: string; type?: string; q?: string }) {
    const where: Prisma.SbCompetitionWhereInput = {};
    if (filters?.q?.trim()) {
      const q = filters.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { country: { contains: q, mode: "insensitive" } },
      ];
    }
    if (filters?.type?.trim()) {
      where.type = { equals: filters.type.trim(), mode: "insensitive" };
    }

    const rows = await this.prisma.sbCompetition.findMany({
      where,
      include: { _count: { select: { teams: true, matches: true } } },
      orderBy: { name: "asc" },
    });

    const compIds = rows.map((c) => c.id);
    const statusByComp = new Map<string, string[]>();
    if (compIds.length) {
      const statusRows = await this.prisma.sbMatch.findMany({
        where: { competitionId: { in: compIds } },
        select: { competitionId: true, status: true },
      });
      for (const row of statusRows) {
        const list = statusByComp.get(row.competitionId) ?? [];
        list.push(row.status);
        statusByComp.set(row.competitionId, list);
      }
    }

    return rows
      .map((c) => {
        const status = deriveCompetitionStatus(
          c.isPublished,
          statusByComp.get(c.id) ?? []
        );
        return {
          id: c.id,
          slug: c.slug,
          name: c.name,
          type: c.type,
          region: c.country,
          season: c.season,
          teamsCount: c._count.teams,
          matchesCount: c._count.matches,
          status,
          isPublished: c.isPublished,
          isFeatured: (c.description ?? "").includes("[featured]"),
          formatType: c.formatType,
          logoUrl: null as string | null,
        };
      })
      .filter((c) => !filters?.status || c.status === filters.status);
  }

  async listTeams(filters?: { q?: string; competitionId?: string }) {
    const where: Prisma.SbTeamWhereInput = {};
    if (filters?.competitionId) where.competitionId = filters.competitionId;
    if (filters?.q?.trim()) {
      const q = filters.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await this.prisma.sbTeam.findMany({
      where,
      include: {
        competition: { select: { id: true, name: true, slug: true } },
        _count: { select: { squad: true } },
      },
      orderBy: { name: "asc" },
    });
    return rows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: normalizeClubName(t.name),
      shortName: t.shortName,
      region: t.city,
      logoUrl: t.logoUrl,
      competition: t.competition,
      squadCount: t._count.squad,
    }));
  }

  async listScoreboardPlayers(q?: string) {
    const needle = q?.trim();
    const squad = await this.prisma.sbTeamSquad.findMany({
      where: needle
        ? {
            OR: [
              { displayName: { contains: needle, mode: "insensitive" } },
              { player: { displayName: { contains: needle, mode: "insensitive" } } },
            ],
          }
        : undefined,
      include: {
        team: {
          select: {
            id: true,
            name: true,
            slug: true,
            competition: { select: { name: true, slug: true } },
          },
        },
        player: {
          select: {
            id: true,
            slug: true,
            displayName: true,
            positionPrimary: true,
            positionSecondary: true,
            playerPhotoUrl: true,
            isPublic: true,
          },
        },
      },
      orderBy: { displayName: "asc" },
      take: needle ? 500 : undefined,
    });

    const byPlayer = new Map<
      string,
      {
        playerId: string | null;
        slug: string | null;
        displayName: string;
        positionPrimary: string | null;
        teams: Array<{ teamId: string; teamName: string; competitionSlug: string }>;
      }
    >();

    for (const row of squad) {
      const key = row.playerId ?? `squad:${row.id}`;
      const displayName = row.player?.displayName ?? row.displayName;
      const slug = row.player?.slug ?? slugify(displayName);
      const existing = byPlayer.get(key) ?? {
        playerId: row.playerId,
        slug,
        displayName,
        positionPrimary: row.position ?? row.player?.positionPrimary ?? null,
        teams: [],
      };
      existing.teams.push({
        teamId: row.team.id,
        teamName: normalizeClubName(row.team.name),
        competitionSlug: row.team.competition.slug,
      });
      byPlayer.set(key, existing);
    }

    return [...byPlayer.values()];
  }

  async listMatches(competitionId?: string) {
    return this.scoreboard.listMatches({
      competitionId,
      publicOnly: false,
    });
  }

  async getMatchRoster(matchId: string, teamId: string) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: {
        homeTeam: { include: { squad: { include: { player: { select: { id: true, slug: true } } } } } },
        awayTeam: { include: { squad: { include: { player: { select: { id: true, slug: true } } } } } },
      },
    });
    if (!match) throw new NotFoundException("Match not found");
    const team =
      match.homeTeamId === teamId
        ? match.homeTeam
        : match.awayTeamId === teamId
          ? match.awayTeam
          : null;
    if (!team) throw new BadRequestException("Team not in this match");

    const stats = (match.stats ?? {}) as MatchStatsJson;
    const saved = stats.matchdayRosters?.[teamId];

    return {
      matchId,
      teamId,
      directory: team.squad.map((s) => ({
        squadId: s.id,
        displayName: s.displayName,
        position: s.position,
        shirtNumber: s.shirtNumber,
        playerId: s.playerId,
        playerSlug: s.player?.slug ?? (s.playerId ? null : slugify(s.displayName)),
      })),
      roster: saved ?? { teamId, xi: [], subs: [] },
    };
  }

  async saveMatchRoster(matchId: string, payload: MatchdayRosterPayload) {
    if (payload.xi.length > 11) {
      throw new BadRequestException("Starting XI cannot exceed 11 players");
    }
    if (payload.xi.length + payload.subs.length > 20) {
      throw new BadRequestException("Matchday roster cannot exceed 20 players");
    }
    const match = await this.prisma.sbMatch.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException("Match not found");
    if (match.homeTeamId !== payload.teamId && match.awayTeamId !== payload.teamId) {
      throw new BadRequestException("Team not in this match");
    }

    const resolved = await this.resolveRosterPlayerIds(payload);

    const stats = ((match.stats ?? {}) as MatchStatsJson) ?? {};
    stats.matchdayRosters = {
      ...(stats.matchdayRosters ?? {}),
      [payload.teamId]: resolved,
    };

    await this.prisma.sbMatch.update({
      where: { id: matchId },
      data: { stats: stats as Prisma.InputJsonValue },
    });
    return { ok: true, roster: resolved };
  }

  private async resolveRosterPlayerIds(payload: MatchdayRosterPayload) {
    const slots = [...payload.xi, ...payload.subs];
    const squadRows = await this.prisma.sbTeamSquad.findMany({
      where: { id: { in: slots.map((s) => s.squadId) } },
      select: { id: true, playerId: true, position: true, displayName: true },
    });
    const squadById = new Map(squadRows.map((s) => [s.id, s]));

    const linkSlot = async (slot: MatchdayRosterSlot) => {
      if (slot.playerId) return slot;
      const squad = squadById.get(slot.squadId);
      if (squad?.playerId) {
        return { ...slot, playerId: squad.playerId };
      }
      const player = await this.playerDirectory.resolveOrCreatePlayer(
        slot.displayName,
        slot.position ?? squad?.position
      );
      await this.prisma.sbTeamSquad.update({
        where: { id: slot.squadId },
        data: { playerId: player.id },
      });
      return {
        ...slot,
        playerId: player.id,
        playerSlug: player.slug,
      };
    };

    const xi = await Promise.all(payload.xi.map(linkSlot));
    const subs = await Promise.all(payload.subs.map(linkSlot));
    const stripCleanSheets = (slot: MatchdayRosterSlot) => {
      const pos = squadById.get(slot.squadId)?.position ?? slot.position;
      if (!pos || !pos.toUpperCase().includes("GK")) {
        const { cleanSheets: _cs, ...rest } = slot;
        return rest;
      }
      return slot;
    };
    return {
      ...payload,
      xi: xi.map(stripCleanSheets),
      subs: subs.map(stripCleanSheets),
    };
  }

  async getSpotterOps(matchId: string) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: {
        homeTeam: { include: { squad: true } },
        awayTeam: { include: { squad: true } },
        events: { orderBy: { minute: "asc" } },
      },
    });
    if (!match) throw new NotFoundException("Match not found");
    const stats = (match.stats ?? {}) as MatchStatsJson;
    const spotter = stats.spotter ?? defaultSpotterState();
    return {
      match: {
        id: match.id,
        status: match.status,
        minute: match.minute,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        events: match.events,
      },
      ops: {
        lineupsLocked: spotter.lineupsLocked ?? false,
        officialsConfirmed: spotter.officialsConfirmed ?? 0,
        addedTime: spotter.addedTime ?? 0,
        offlineQueueCount: spotter.offlineQueue?.length ?? 0,
        lastUndoAt: null,
        formation: spotter.formation ?? { home: "4-3-3", away: "4-3-3" },
        pitchSelection: spotter.pitchSelection ?? null,
      } satisfies SpotterOpsState & {
        formation: { home: string; away: string };
        pitchSelection: { teamId: string; squadId: string } | null;
      },
      matchdayRosters: stats.matchdayRosters ?? {},
      rosterReadiness: getRosterReadiness(
        stats,
        match.homeTeamId,
        match.awayTeamId
      ),
    };
  }

  async patchSpotterOps(
    matchId: string,
    patch: Partial<SpotterOpsState> & {
      lockLineups?: boolean;
      pushOfflineEvent?: { type: string; minute: number };
      popOfflineQueue?: boolean;
    }
  ) {
    const match = await this.prisma.sbMatch.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException("Match not found");
    const stats = ((match.stats ?? {}) as MatchStatsJson) ?? {};
    const spotter: SpotterStatsStored = { ...(stats.spotter ?? defaultSpotterState()) };

    if (patch.lockLineups !== undefined) spotter.lineupsLocked = patch.lockLineups;
    if (patch.lineupsLocked !== undefined) spotter.lineupsLocked = patch.lineupsLocked;
    if (patch.officialsConfirmed !== undefined) {
      spotter.officialsConfirmed = Math.min(4, Math.max(0, patch.officialsConfirmed));
    }
    if (patch.addedTime !== undefined) spotter.addedTime = patch.addedTime;
    if (patch.pushOfflineEvent) {
      spotter.offlineQueue = [
        ...(spotter.offlineQueue ?? []),
        {
          id: `${Date.now()}`,
          ...patch.pushOfflineEvent,
          at: new Date().toISOString(),
        },
      ];
    }
    if (patch.popOfflineQueue && spotter.offlineQueue?.length) {
      spotter.offlineQueue = spotter.offlineQueue.slice(0, -1);
    }

    stats.spotter = spotter;
    await this.prisma.sbMatch.update({
      where: { id: matchId },
      data: { stats: stats as Prisma.InputJsonValue },
    });
    return this.getSpotterOps(matchId);
  }

  async createHighlight(body: CreateAdminHighlightDto) {
    const match = await this.prisma.sbMatch.findUnique({ where: { id: body.matchId } });
    if (!match) throw new NotFoundException("Match not found");

    const mediaType = body.type ?? "video";
    const storedUrl = this.resolveHighlightMediaUrl(mediaType, body);

    const detail =
      body.timelineMinute != null ? `minute:${body.timelineMinute}` : undefined;
    const highlight = await this.prisma.sbHighlight.create({
      data: {
        competitionId: match.competitionId,
        matchId: body.matchId,
        eventId: body.eventId,
        title: body.title,
        youtubeUrl: storedUrl,
        mediaType,
        isPublished: false,
      } as Prisma.SbHighlightUncheckedCreateInput,
    });
    if (body.thumbnailUrl && detail) {
      await this.prisma.sbMatch.update({
        where: { id: match.id },
        data: {
          stats: {
            ...((match.stats as object) ?? {}),
            highlightMeta: { [highlight.id]: { thumbnailUrl: body.thumbnailUrl, detail } },
          } as Prisma.InputJsonValue,
        },
      });
    }
    return highlight;
  }

  private highlightInclude = {
    competition: { select: { id: true, name: true, slug: true } },
    match: {
      select: {
        id: true,
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
      },
    },
  } as const;

  async listAdminHighlights() {
    return this.prisma.sbHighlight.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: this.highlightInclude,
    });
  }

  async createLandingHighlight(body: {
    title: string;
    youtubeUrl: string;
    duration: string;
    competitionId: string;
  }) {
    const competition = await this.prisma.sbCompetition.findUnique({
      where: { id: body.competitionId },
    });
    if (!competition) throw new BadRequestException("Competition not found");

    const video = normalizeVideoMediaUrl(body.youtubeUrl);
    return this.prisma.sbHighlight.create({
      data: {
        title: body.title.trim(),
        youtubeUrl: video.embedUrl ?? video.sourceUrl,
        duration: body.duration.trim(),
        competitionId: body.competitionId,
        isPublished: false,
      },
      include: this.highlightInclude,
    });
  }

  async updateHighlight(
    id: string,
    body: {
      title?: string;
      type?: "video" | "photo";
      youtubeUrl?: string;
      imageUrl?: string;
      duration?: string;
      competitionId?: string;
    }
  ) {
    const existing = await this.prisma.sbHighlight.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Highlight not found");

    if (body.competitionId) {
      const competition = await this.prisma.sbCompetition.findUnique({
        where: { id: body.competitionId },
      });
      if (!competition) throw new BadRequestException("Competition not found");
    }

    const existingMediaType =
      (existing as { mediaType?: "video" | "photo" }).mediaType ?? "video";
    const mediaType = body.type ?? existingMediaType;
    const storedUrl =
      body.youtubeUrl || body.imageUrl
        ? this.resolveHighlightMediaUrl(mediaType, body)
        : undefined;

    return this.prisma.sbHighlight.update({
      where: { id },
      data: {
        title: body.title?.trim(),
        youtubeUrl: storedUrl,
        mediaType: body.type,
        duration: body.duration?.trim(),
        competitionId: body.competitionId,
      } as Prisma.SbHighlightUncheckedUpdateInput,
      include: this.highlightInclude,
    });
  }

  private resolveHighlightMediaUrl(
    mediaType: "video" | "photo",
    body: { youtubeUrl?: string; imageUrl?: string }
  ) {
    if (mediaType === "photo") {
      const imageUrl = body.imageUrl?.trim();
      if (!imageUrl || !isAllowedImageMediaUrl(imageUrl)) {
        throw new BadRequestException("A valid image URL is required for photo highlights");
      }
      return imageUrl;
    }

    const videoUrl = body.youtubeUrl?.trim();
    if (!videoUrl) {
      throw new BadRequestException("A valid video URL is required for video highlights");
    }
    const video = normalizeVideoMediaUrl(videoUrl);
    return video.embedUrl ?? video.sourceUrl;
  }

  async setHighlightPublished(id: string, isPublished: boolean) {
    const existing = await this.prisma.sbHighlight.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Highlight not found");

    return this.prisma.sbHighlight.update({
      where: { id },
      data: {
        isPublished,
        publishedAt: isPublished ? new Date() : existing.publishedAt,
      },
      include: this.highlightInclude,
    });
  }

  async deleteHighlight(id: string) {
    const existing = await this.prisma.sbHighlight.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Highlight not found");
    await this.prisma.sbHighlight.delete({ where: { id } });
    return { ok: true };
  }

  exportCompetitionsCsv() {
    return this.exportEntityCsv("competitions");
  }

  exportTeamsCsv(competitionId?: string) {
    return this.exportEntityCsv("teams", competitionId);
  }

  private async exportEntityCsv(kind: "competitions" | "teams", competitionId?: string) {
    if (kind === "competitions") {
      const rows = await this.listCompetitions();
      const header = ["name", "type", "region", "status", "logo", "isFeatured"];
      const lines = [
        header.join(","),
        ...rows.map((r) =>
          [
            r.name,
            r.type,
            r.region ?? "",
            r.status,
            r.logoUrl ?? "",
            r.isFeatured,
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
        ),
      ];
      return lines.join("\n");
    }
    const rows = await this.listTeams({ competitionId });
    const header = ["name", "slug", "region", "competitionSlug", "logo"];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [r.name, r.slug, r.region ?? "", r.competition.slug, r.logoUrl ?? ""]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ];
    return lines.join("\n");
  }

  async importCompetitionsCsv(csv: string) {
    const table = parseCsv(csv);
    if (table.length < 2) {
      throw csvError("Competition import", "file must include a header row and at least one data row");
    }
    const header = table[0].map((h) => h.toLowerCase());
    const nameIdx = header.indexOf("name");
    const typeIdx = header.indexOf("type");
    const regionIdx = header.indexOf("region");
    const statusIdx = header.indexOf("status");
    const featuredIdx = header.indexOf("isfeatured");
    if (nameIdx < 0) {
      throw csvError("Competition import", 'missing required column "name"');
    }

    let imported = 0;
    for (const row of table.slice(1)) {
      const name = row[nameIdx];
      if (!name) continue;
      const slug = slugify(name);
      const type = typeIdx >= 0 ? row[typeIdx] || "tournament" : "tournament";
      const region = regionIdx >= 0 ? row[regionIdx] : "Nigeria";
      const status = statusIdx >= 0 ? row[statusIdx] : "upcoming";
      const isFeatured = featuredIdx >= 0 && row[featuredIdx]?.toLowerCase() === "true";
      const isPublished = status !== "draft";

      await this.prisma.sbCompetition.upsert({
        where: { slug },
        create: {
          slug,
          name,
          season: new Date().getFullYear().toString(),
          type,
          country: region || "Nigeria",
          isPublished,
          description: isFeatured ? "[featured]" : null,
        },
        update: {
          name,
          type,
          country: region || "Nigeria",
          isPublished,
          description: isFeatured ? "[featured]" : undefined,
        },
      });
      imported++;
    }
    return { imported };
  }

  listCompetitionTemplates() {
    return this.competitionEngine.listTemplates();
  }

  previewCompetitionTemplate(formatType: string) {
    return this.competitionEngine.previewTemplate(formatType as never);
  }

  createCompetitionFromTemplate(input: CreateCompetitionFromTemplateInput) {
    return this.competitionEngine.createFromTemplate(input);
  }

  groupStandings(competitionId: string) {
    return this.competitionEngine.groupStandings(competitionId);
  }

  async listMatchEvents(matchId: string) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: {
        events: {
          orderBy: { minute: "asc" },
          include: {
            team: { select: { id: true, name: true } },
            player: { select: { id: true, slug: true, displayName: true } },
            assistPlayer: { select: { id: true, slug: true, displayName: true } },
          },
        },
      },
    });
    if (!match) throw new NotFoundException("Match not found");
    return match.events;
  }

  addMatchEvent(matchId: string, dto: CreateMatchEventDto) {
    return this.scoreboard.addEvent(matchId, dto);
  }

  ingestMatchTimelineCsv(
    matchId: string,
    csv: string,
    replace?: boolean,
    matchComment?: string
  ) {
    return this.scoreboard.ingestMatchTimelineCsv(
      matchId,
      csv,
      replace,
      matchComment
    );
  }

  async deleteMatchEvent(matchId: string, eventId: string) {
    const event = await this.prisma.sbMatchEvent.findFirst({
      where: { id: eventId, matchId },
    });
    if (!event) throw new NotFoundException("Event not found");
    await this.prisma.sbMatchEvent.delete({ where: { id: eventId } });
    return { ok: true };
  }

  async exportCompetitionSquad(competitionId: string, format: "json" | "csv" = "json") {
    const comp = await this.prisma.sbCompetition.findUnique({
      where: { id: competitionId },
      include: {
        teams: {
          orderBy: { name: "asc" },
          include: {
            squad: {
              orderBy: [{ shirtNumber: "asc" }, { displayName: "asc" }],
              include: {
                player: {
                  select: {
                    id: true,
                    slug: true,
                    displayName: true,
                    normalizedName: true,
                    positionPrimary: true,
                    careerGoals: true,
                    careerAssists: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!comp) throw new NotFoundException("Competition not found");

    const rows = comp.teams.flatMap((team) =>
      team.squad.map((s) => ({
        competitionSlug: comp.slug,
        competitionName: comp.name,
        teamId: team.id,
        teamName: normalizeClubName(team.name),
        teamSlug: team.slug,
        squadId: s.id,
        shirtNumber: s.shirtNumber,
        displayName: s.displayName,
        position: s.position,
        playerId: s.playerId,
        playerSlug: s.player?.slug ?? null,
        normalizedName: s.player?.normalizedName ?? null,
        careerGoals: s.player?.careerGoals ?? 0,
        careerAssists: s.player?.careerAssists ?? 0,
      }))
    );

    if (format === "json") {
      return { format: "json", competitionId, rows };
    }

    const header = [
      "competitionSlug",
      "teamSlug",
      "shirtNumber",
      "displayName",
      "position",
      "playerId",
      "playerSlug",
      "normalizedName",
    ];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.competitionSlug,
          r.teamSlug,
          r.shirtNumber ?? "",
          r.displayName,
          r.position ?? "",
          r.playerId ?? "",
          r.playerSlug ?? "",
          r.normalizedName ?? "",
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ];
    return { format: "csv", competitionId, csv: lines.join("\n") };
  }

  async importSquadCsv(teamId: string, csv: string) {
    const team = await this.prisma.sbTeam.findUnique({
      where: { id: teamId },
      include: { competition: true },
    });
    if (!team) throw new NotFoundException("Team not found");

    const table = parseCsv(csv);
    if (table.length < 2) {
      throw csvError("Squad import", "file must include a header row and at least one data row");
    }
    const header = table[0].map((h) => h.toLowerCase());
    const nameIdx = header.indexOf("displayname") >= 0 ? header.indexOf("displayname") : header.indexOf("name");
    const posIdx = header.indexOf("position");
    const numIdx = header.indexOf("shirtnumber") >= 0 ? header.indexOf("shirtnumber") : header.indexOf("number");
    if (nameIdx < 0) {
      throw csvError("Squad import", 'missing required column "displayName" or "name"');
    }

    let imported = 0;
    for (const row of table.slice(1)) {
      const displayName = row[nameIdx];
      if (!displayName) continue;
      const position = posIdx >= 0 ? row[posIdx] : null;
      const shirtNumber = numIdx >= 0 && row[numIdx] ? Number(row[numIdx]) : null;
      const player = await this.playerDirectory.resolveOrCreatePlayer(displayName, position);

      const existing = await this.prisma.sbTeamSquad.findFirst({
        where: { teamId, displayName: { equals: displayName, mode: "insensitive" } },
      });
      if (existing) {
        await this.prisma.sbTeamSquad.update({
          where: { id: existing.id },
          data: {
            playerId: player.id,
            position: position ?? existing.position,
            shirtNumber: shirtNumber ?? existing.shirtNumber,
          },
        });
      } else {
        await this.prisma.sbTeamSquad.create({
          data: {
            teamId,
            displayName,
            position,
            shirtNumber: Number.isFinite(shirtNumber) ? shirtNumber : null,
            playerId: player.id,
          },
        });
      }
      imported++;
    }
    return { imported, teamId, competitionId: team.competitionId };
  }

  async importTeamsCsv(csv: string, competitionId: string) {
    const comp = await this.prisma.sbCompetition.findUnique({ where: { id: competitionId } });
    if (!comp) throw new NotFoundException("Competition not found");
    const table = parseCsv(csv);
    if (table.length < 2) {
      throw csvError("Team import", "file must include a header row and at least one data row");
    }
    const header = table[0].map((h) => h.toLowerCase());
    const nameIdx = header.indexOf("name");
    if (nameIdx < 0) {
      throw csvError("Team import", 'missing required column "name"');
    }
    const slugIdx = header.indexOf("slug");
    const regionIdx = header.indexOf("region");
    const logoIdx = header.indexOf("logo");

    let imported = 0;
    for (const row of table.slice(1)) {
      const rawName = row[nameIdx];
      if (!rawName) continue;
      const name = normalizeClubName(rawName);
      const slug = slugIdx >= 0 && row[slugIdx] ? row[slugIdx] : slugify(name);
      await this.prisma.sbTeam.upsert({
        where: { competitionId_slug: { competitionId, slug } },
        create: {
          competitionId,
          slug,
          name,
          city: regionIdx >= 0 ? row[regionIdx] : null,
          logoUrl: logoIdx >= 0 ? row[logoIdx] : null,
        },
        update: {
          name,
          city: regionIdx >= 0 ? row[regionIdx] : undefined,
          logoUrl: logoIdx >= 0 ? row[logoIdx] : undefined,
        },
      });
      imported++;
    }
    return { imported };
  }
}
