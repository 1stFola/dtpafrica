import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PlayerMatchMetrics } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SipRecalculationService } from "../sip/sip-recalculation.service";
import { CreateMatchEventDto } from "./dto/create-event.dto";
import { UpdateMatchDto } from "./dto/update-match.dto";
import { computeGroupStandings, normalizeClubName } from "@dtp/engines";
import {
  buildSkeletonProfile,
  presentProfileStats,
  type SkeletonProfileQuery,
} from "../home/player-profile.presenter";
import { resolvePlayerBySlugOrId } from "../players/player-resolve";
import { presentHighlight, presentMatchDetail } from "./present-media";
import { presentScoreboardPayload } from "./present-scoreboard";
import { CompetitionEngineService } from "./competition-engine.service";
import { assertMatchReadyForLiveEvents } from "./roster-guard";
import { ScoreboardLifecycleService } from "./scoreboard-lifecycle.service";
import { deriveMatchStatsFromCsvEvents } from "./match-csv-events";
import { parseMatchTimelineCsv } from "./match-csv-ingest";
import { computeStandings } from "./standings";

const MATCH_INCLUDE = {
  homeTeam: {
    include: {
      squad: {
        orderBy: [{ shirtNumber: "asc" as const }, { displayName: "asc" as const }],
        include: {
          player: {
            select: {
              id: true,
              slug: true,
              displayName: true,
              positionPrimary: true,
              positionSecondary: true,
              playerPhotoUrl: true,
              overallRating: true,
              isPublic: true,
            },
          },
        },
      },
    },
  },
  awayTeam: {
    include: {
      squad: {
        orderBy: [{ shirtNumber: "asc" as const }, { displayName: "asc" as const }],
        include: {
          player: {
            select: {
              id: true,
              slug: true,
              displayName: true,
              positionPrimary: true,
              positionSecondary: true,
              playerPhotoUrl: true,
              overallRating: true,
              isPublic: true,
            },
          },
        },
      },
    },
  },
  competition: true,
  events: {
    orderBy: { minute: "asc" as const },
    include: {
      player: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          positionPrimary: true,
          playerPhotoUrl: true,
        },
      },
      assistPlayer: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          positionPrimary: true,
          playerPhotoUrl: true,
        },
      },
      highlights: {
        where: { isPublished: true },
        orderBy: { publishedAt: "desc" as const },
      },
    },
  },
  highlights: {
    where: { isPublished: true },
    orderBy: { publishedAt: "desc" as const },
    include: { event: true },
  },
} satisfies Prisma.SbMatchInclude;

/** Public team profile match rows — goal events power cards + scorer stats. */
const TEAM_MATCH_LIST_INCLUDE = {
  homeTeam: true,
  awayTeam: true,
  competition: true,
  events: {
    where: { type: { in: ["goal", "own_goal"] } },
    orderBy: { minute: "asc" as const },
    select: {
      id: true,
      minute: true,
      type: true,
      teamId: true,
      playerLabel: true,
      player: { select: { displayName: true, slug: true } },
    },
  },
} satisfies Prisma.SbMatchInclude;

const LIVE_STATUSES = ["live", "halftime"];
const SCOREBOARD_EXTERNAL_REF_PREFIX = "scoreboard:";
const EVENT_TYPES = new Set([
  "goal",
  "own_goal",
  "yellow_card",
  "red_card",
  "substitution",
  "injury",
]);

type EventSnapshot = { minute: number; type: string; playerId: string };
type MatchWithCompetition = Prisma.SbMatchGetPayload<{
  include: { competition: true };
}>;
type SipIngestPlayerResult =
  | { playerId: string; status: "created" | "updated" }
  | { playerId: string; status: "skipped"; reason: string };

@Injectable()
export class ScoreboardService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SipRecalculationService)
    private readonly sipRecalc: SipRecalculationService,
    @Inject(ScoreboardLifecycleService)
    private readonly lifecycle: ScoreboardLifecycleService,
    @Inject(CompetitionEngineService)
    private readonly competitionEngine: CompetitionEngineService
  ) {}

  async competitions() {
    const rows = await this.prisma.sbCompetition.findMany({
      where: { isPublished: true },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { teams: true, matches: true } },
      },
    });
    return presentScoreboardPayload(rows);
  }

  /**
   * All teams that belong to a published competition, with their competition,
   * squad size, and match counts. Powers the public "Featured Teams" grid on
   * the Deep Browse page. Names are normalized to official club spellings.
   */
  async teams() {
    const rows = await this.prisma.sbTeam.findMany({
      where: { competition: { isPublished: true } },
      orderBy: { name: "asc" },
      include: {
        competition: true,
        _count: { select: { squad: true, homeMatches: true, awayMatches: true } },
      },
    });
    return presentScoreboardPayload(rows);
  }

  /**
   * Landing hub: aggregate stats + recent published matches with goal events.
   * No response caching — each request reads fresh match rows and goal events from
   * the database so admin match-center writes appear immediately on the homepage widget.
   */
  async overview() {
    const stats = await this.stats();
    const recentMatches = await this.prisma.sbMatch.findMany({
      where: { isPublished: true, competition: { isPublished: true } },
      orderBy: [{ kickoffAt: "desc" }],
      take: 12,
      include: {
        homeTeam: true,
        awayTeam: true,
        competition: true,
        events: {
          where: { type: { in: ["goal", "own_goal"] } },
          orderBy: { minute: "asc" },
          select: {
            id: true,
            minute: true,
            type: true,
            teamId: true,
            playerLabel: true,
            player: { select: { displayName: true, slug: true } },
          },
        },
      },
    });
    return presentScoreboardPayload({ stats, recentMatches });
  }

  private async resolvePublishedCompetition(competitionIdOrSlug: string) {
    const competition = await this.prisma.sbCompetition.findFirst({
      where: {
        isPublished: true,
        OR: [{ id: competitionIdOrSlug }, { slug: competitionIdOrSlug }],
      },
      include: {
        teams: true,
        _count: { select: { teams: true, matches: true } },
      },
    });
    if (!competition) throw new NotFoundException("Competition not found");
    return competition;
  }

  /**
   * Premium competition hub: meta, group standings (A/B when applicable),
   * and competition top scorers from persisted stats.
   */
  async competitionHub(competitionIdOrSlug: string) {
    const competition = await this.resolvePublishedCompetition(competitionIdOrSlug);
    const competitionId = competition.id;

    const standingsPayload = await this.competitionEngine.groupStandings(competitionId);
    const rows = (standingsPayload as { rows?: Array<{ groupKey: string }> }).rows ?? [];
    const groupKeys = [...new Set(rows.map((r) => r.groupKey))].sort();
    const groups: Record<string, typeof rows> = {};
    for (const key of groupKeys) {
      const label = key.replace(/^group_/i, "").toUpperCase() || key;
      groups[label] = rows.filter((r) => r.groupKey === key);
    }

    const topScorers = await this.prisma.sbPlayerCompetitionStats.findMany({
      where: {
        competitionId,
        goals: { gt: 0 },
        player: { isPublic: true },
      },
      orderBy: [{ goals: "desc" }, { assists: "desc" }],
      take: 10,
      include: {
        player: {
          select: {
            id: true,
            slug: true,
            displayName: true,
            positionPrimary: true,
            playerPhotoUrl: true,
            scoreboardSquad: {
              where: { team: { competitionId } },
              take: 1,
              include: { team: true },
            },
          },
        },
      },
    });

    const scorerRows = topScorers.map((row) => ({
      playerId: row.playerId,
      slug: row.player.slug,
      displayName: row.player.displayName,
      positionPrimary: row.player.positionPrimary,
      playerPhotoUrl: row.player.playerPhotoUrl,
      goals: row.goals,
      assists: row.assists,
      team: row.player.scoreboardSquad[0]?.team
        ? presentScoreboardPayload(row.player.scoreboardSquad[0].team)
        : null,
    }));

    const formatConfig =
      competition.formatConfig && typeof competition.formatConfig === "object"
        ? (competition.formatConfig as Record<string, unknown>)
        : null;

    const teams = [...competition.teams]
      .map((team) => {
        const seed = team.groupKey ? Number(team.groupKey) : null;
        return {
          ...presentScoreboardPayload(team),
          seed: Number.isFinite(seed) ? seed : null,
        };
      })
      .sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));

    return presentScoreboardPayload({
      meta: {
        id: competition.id,
        slug: competition.slug,
        name: competition.name,
        season: competition.season,
        type: competition.type,
        formatType: competition.formatType,
        formatConfig,
        country: competition.country,
        description: competition.description,
        teamCount: competition._count.teams,
        matchCount: competition._count.matches,
        standingsUpdatedAt: competition.standingsUpdatedAt,
        bracketImageUrl:
          (formatConfig?.bracketImageUrl as string | undefined) ??
          (formatConfig?.bannerUrl as string | undefined) ??
          null,
      },
      teams,
      groups,
      topScorers: scorerRows,
    });
  }

  /** Public scoreboard player card (slug/name); skeleton when not published. */
  async playerProfile(slugOrId: string, query: SkeletonProfileQuery = {}) {
    const resolved = await resolvePlayerBySlugOrId(this.prisma, slugOrId);
    if (!resolved || !resolved.isPublic) {
      return buildSkeletonProfile(slugOrId, query, resolved ?? undefined);
    }

    const player = await this.prisma.player.findUnique({
      where: { id: resolved.id },
      select: {
        id: true,
        slug: true,
        displayName: true,
        positionPrimary: true,
        positionSecondary: true,
        playerPhotoUrl: true,
        overallRating: true,
        isPublic: true,
        careerGoals: true,
        careerAssists: true,
        careerAppearances: true,
        careerMinutes: true,
        careerCleanSheets: true,
        scoreboardSquad: {
          take: 1,
          orderBy: { team: { name: "asc" } },
          include: {
            team: {
              include: { competition: true },
            },
          },
        },
      },
    });
    if (!player) {
      return buildSkeletonProfile(slugOrId, query);
    }

    const role = query.role?.trim().toUpperCase() || player.positionPrimary;
    const squadTeam = player.scoreboardSquad[0]?.team;

    return presentScoreboardPayload({
      isSkeleton: false,
      id: player.id,
      slug: player.slug,
      displayName: player.displayName,
      positionPrimary: player.positionPrimary,
      positionSecondary: player.positionSecondary,
      playerPhotoUrl: player.playerPhotoUrl,
      overallRating: player.overallRating,
      club:
        query.club?.trim() ||
        (squadTeam ? normalizeClubName(squadTeam.name) : null),
      competition:
        query.competition?.trim() || squadTeam?.competition.name || null,
      role,
      stats: presentProfileStats(player, role),
    });
  }

  /**
   * Lightweight public aggregate counts that power the landing-page metrics
   * banner. Everything is scoped to published competitions so the figures match
   * what the public can actually browse.
   */
  async stats() {
    const publishedComp = { competition: { isPublished: true } } as const;
    const [competitions, teams, matches, squadEntries, linkedPlayers] =
      await this.prisma.$transaction([
        this.prisma.sbCompetition.count({ where: { isPublished: true } }),
        this.prisma.sbTeam.count({ where: publishedComp }),
        this.prisma.sbMatch.count({
          where: { isPublished: true, ...publishedComp },
        }),
        this.prisma.sbTeamSquad.count({ where: { team: publishedComp } }),
        this.prisma.player.count({
          where: {
            scoreboardSquad: { some: { team: publishedComp } },
          },
        }),
      ]);

    return {
      competitions,
      teams,
      matches,
      // Total roster rows tracked across published competitions. Falls back to
      // the count of linked public players if no roster rows exist yet.
      playersTracked: squadEntries || linkedPlayers,
    };
  }

  async competitionBySlug(slug: string) {
    const comp = await this.prisma.sbCompetition.findFirst({
      where: { slug, isPublished: true },
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
                    positionPrimary: true,
                    positionSecondary: true,
                    playerPhotoUrl: true,
                    overallRating: true,
                    isPublic: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!comp) throw new NotFoundException("Competition not found");
    return presentScoreboardPayload(comp);
  }

  async teamById(id: string) {
    const team = await this.prisma.sbTeam.findFirst({
      where: { id, competition: { isPublished: true } },
      include: {
        competition: true,
        squad: {
          orderBy: [{ shirtNumber: "asc" }, { displayName: "asc" }],
          include: {
            player: {
              select: {
                id: true,
                slug: true,
                displayName: true,
                positionPrimary: true,
                positionSecondary: true,
                playerPhotoUrl: true,
                overallRating: true,
                isPublic: true,
              },
            },
          },
        },
        homeMatches: {
          where: { isPublished: true },
          orderBy: { kickoffAt: "desc" },
          include: TEAM_MATCH_LIST_INCLUDE,
        },
        awayMatches: {
          where: { isPublished: true },
          orderBy: { kickoffAt: "desc" },
          include: TEAM_MATCH_LIST_INCLUDE,
        },
      },
    });
    if (!team) throw new NotFoundException("Team not found");

    const matches = [...team.homeMatches, ...team.awayMatches]
      .sort((a, b) => (b.kickoffAt?.getTime() ?? 0) - (a.kickoffAt?.getTime() ?? 0))
      .slice(0, 12);
    const { homeMatches, awayMatches, ...rest } = team;
    return presentScoreboardPayload({ ...rest, matches });
  }

  async search(query: string) {
    const q = query.trim();
    if (q.length < 2) {
      return { query: q, competitions: [], teams: [], matches: [], players: [] };
    }

    const contains = { contains: q, mode: "insensitive" as const };
    const [competitions, teams, matches, players] = await this.prisma.$transaction([
      this.prisma.sbCompetition.findMany({
        where: { isPublished: true, OR: [{ name: contains }, { season: contains }] },
        take: 6,
        orderBy: { name: "asc" },
      }),
      this.prisma.sbTeam.findMany({
        where: {
          competition: { isPublished: true },
          OR: [{ name: contains }, { shortName: contains }, { city: contains }],
        },
        take: 8,
        include: { competition: true, _count: { select: { squad: true } } },
        orderBy: { name: "asc" },
      }),
      this.prisma.sbMatch.findMany({
        where: {
          isPublished: true,
          competition: { isPublished: true },
          OR: [
            { venue: contains },
            { roundLabel: contains },
            { homeTeam: { name: contains } },
            { awayTeam: { name: contains } },
            { competition: { name: contains } },
          ],
        },
        take: 8,
        include: { homeTeam: true, awayTeam: true, competition: true },
        orderBy: { kickoffAt: "desc" },
      }),
      this.prisma.player.findMany({
        where: {
          isPublic: true,
          scoreboardSquad: { some: { team: { competition: { isPublished: true } } } },
          OR: [
            { displayName: contains },
            { slug: contains },
            { positionPrimary: contains },
          ],
        },
        take: 8,
        select: {
          id: true,
          slug: true,
          displayName: true,
          positionPrimary: true,
          playerPhotoUrl: true,
          overallRating: true,
        },
        orderBy: [{ overallRating: "desc" }, { displayName: "asc" }],
      }),
    ]);

    return presentScoreboardPayload({ query: q, competitions, teams, matches, players });
  }

  async listMatches(query: {
    status?: string;
    competitionId?: string;
    publicOnly?: boolean;
  }) {
    const where: Prisma.SbMatchWhereInput = {};
    if (query.publicOnly !== false) {
      where.isPublished = true;
      where.competition = { isPublished: true };
    }
    if (query.competitionId) {
      where.competitionId = query.competitionId;
    }
    if (query.status === "live") {
      where.status = { in: LIVE_STATUSES };
    } else if (query.status) {
      where.status = query.status;
    }

    const rows = await this.prisma.sbMatch.findMany({
      where,
      orderBy: [{ kickoffAt: "desc" }],
      include: {
        homeTeam: true,
        awayTeam: true,
        competition: true,
        _count: { select: { events: true } },
        // Goal events power the scorer snippet on Match Center cards.
        events: {
          where: { type: { in: ["goal", "own_goal"] } },
          orderBy: { minute: "asc" },
          select: {
            id: true,
            minute: true,
            type: true,
            teamId: true,
            playerLabel: true,
            player: { select: { displayName: true, slug: true } },
          },
        },
      },
    });
    return presentScoreboardPayload(rows);
  }

  async matchById(id: string, publicOnly = true) {
    const match = await this.prisma.sbMatch.findFirst({
      where: {
        id,
        ...(publicOnly
          ? { isPublished: true, competition: { isPublished: true } }
          : {}),
      },
      include: MATCH_INCLUDE,
    });
    if (!match) throw new NotFoundException("Match not found");
    return presentMatchDetail(presentScoreboardPayload(match));
  }

  async standings(competitionId: string) {
    const competition = await this.prisma.sbCompetition.findFirst({
      where: { id: competitionId, isPublished: true },
      include: { teams: true },
    });
    if (!competition) throw new NotFoundException("Competition not found");

    const groupFormats = new Set(["JAGABAN_CUP_STANDARD", "HYBRID_CHAMPIONS_LEAGUE"]);
    const useGroups =
      groupFormats.has(competition.formatType ?? "") ||
      competition.teams.some((t) => t.groupKey);

    const finished = await this.prisma.sbMatch.findMany({
      where: {
        competitionId,
        status: "finished",
        isPublished: true,
        ...(useGroups && competition.formatType === "JAGABAN_CUP_STANDARD"
          ? { stageKey: { startsWith: "group_" } }
          : {}),
      },
      select: {
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
        kickoffAt: true,
      },
    });

    const normalizedTeams = competition.teams.map((t) => ({
      id: t.id,
      name: normalizeClubName(t.name),
      shortName: t.shortName,
      groupKey: t.groupKey,
    }));

    if (useGroups) {
      const groupRows = computeGroupStandings(normalizedTeams, finished);
      return presentScoreboardPayload({
        competitionId,
        competitionName: competition.name,
        season: competition.season,
        formatType: competition.formatType,
        groups: [...new Set(groupRows.map((r) => r.groupKey))].sort(),
        rows: groupRows,
      });
    }

    return presentScoreboardPayload({
      competitionId,
      competitionName: competition.name,
      season: competition.season,
      formatType: competition.formatType,
      rows: computeStandings(normalizedTeams, finished),
    });
  }

  async highlights(competitionId?: string) {
    const rows = await this.prisma.sbHighlight.findMany({
      where: {
        isPublished: true,
        mediaType: "video",
        ...(competitionId ? { competitionId } : {}),
      } as Prisma.SbHighlightWhereInput,
      orderBy: { publishedAt: "desc" },
      include: {
        match: {
          include: { homeTeam: true, awayTeam: true },
        },
        competition: true,
        event: true,
      },
    });
    return presentScoreboardPayload(rows.map((row) => presentHighlight(row)));
  }

  async addEvent(matchId: string, dto: CreateMatchEventDto) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true, competition: true },
    });
    if (!match) throw new NotFoundException("Match not found");
    const rosterCheck = assertMatchReadyForLiveEvents(
      (match.stats ?? {}) as Parameters<typeof assertMatchReadyForLiveEvents>[0],
      match.homeTeamId,
      match.awayTeamId
    );
    if (!rosterCheck.ok) {
      throw new ForbiddenException(rosterCheck.reason);
    }
    if (!EVENT_TYPES.has(dto.type)) {
      throw new BadRequestException("Invalid event type");
    }
    if (dto.teamId && ![match.homeTeamId, match.awayTeamId].includes(dto.teamId)) {
      throw new BadRequestException("Event team must belong to the match");
    }
    const linkedPlayerIds = [dto.playerId, dto.assistPlayerId].filter(
      (id): id is string => Boolean(id)
    );
    if (linkedPlayerIds.length) {
      const found = await this.prisma.player.count({
        where: { id: { in: linkedPlayerIds } },
      });
      if (found !== linkedPlayerIds.length) {
        throw new BadRequestException("One or more linked players were not found");
      }
    }

    const eventData = {
      matchId,
      type: dto.type,
      minute: dto.minute,
      teamId: dto.teamId,
      playerId: dto.playerId,
      assistPlayerId: dto.assistPlayerId,
      playerLabel: dto.playerLabel?.trim() || undefined,
      assistLabel: dto.assistLabel?.trim() || undefined,
      detail: dto.detail?.trim() || undefined,
      metadata: dto.metadata as Prisma.InputJsonValue | undefined,
    };
    const duplicate = await this.prisma.sbMatchEvent.findFirst({
      where: {
        matchId,
        type: dto.type,
        minute: dto.minute,
        teamId: dto.teamId ?? null,
        playerId: dto.playerId ?? null,
        assistPlayerId: dto.assistPlayerId ?? null,
      },
    });
    if (duplicate) {
      return { ...duplicate, duplicate: true };
    }

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.sbMatchEvent.create({ data: eventData });
      if (dto.type === "goal" && dto.teamId) {
        const homeGoal = dto.teamId === match.homeTeamId;
        const awayGoal = dto.teamId === match.awayTeamId;
        if (homeGoal || awayGoal) {
          await tx.sbMatch.update({
            where: { id: matchId },
            data: {
              homeScore: homeGoal ? match.homeScore + 1 : match.homeScore,
              awayScore: awayGoal ? match.awayScore + 1 : match.awayScore,
              minute: dto.minute,
            },
          });
        }
      }
      return created;
    });

    await this.lifecycle.applyMatchEventToPlayerStats(event, match.competitionId);

    if (dto.playerId) {
      void this.ingestSipMetricsFromMatch(matchId).catch(() => undefined);
    }

    return event;
  }

  async updateMatch(matchId: string, dto: UpdateMatchDto) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
    });
    if (!match) throw new NotFoundException("Match not found");

    if (dto.status === "live" || dto.status === "halftime") {
      const rosterCheck = assertMatchReadyForLiveEvents(
        (match.stats ?? {}) as Parameters<typeof assertMatchReadyForLiveEvents>[0],
        match.homeTeamId,
        match.awayTeamId
      );
      if (!rosterCheck.ok) {
        throw new ForbiddenException(rosterCheck.reason);
      }
    }

    if (
      dto.status &&
      !["scheduled", "live", "halftime", "finished", "postponed"].includes(
        dto.status
      )
    ) {
      throw new BadRequestException("Invalid match status");
    }

    const updated = await this.prisma.sbMatch.update({
      where: { id: matchId },
      data: {
        status: dto.status,
        minute: dto.minute,
        homeScore: dto.homeScore,
        awayScore: dto.awayScore,
      },
      include: MATCH_INCLUDE,
    });

    if (dto.status || dto.minute) {
      await this.ingestSipMetricsFromMatch(matchId);
    }

    if (dto.status === "finished" && match.status !== "finished") {
      await this.lifecycle.onMatchFinished(matchId);
    }

    return presentScoreboardPayload(updated);
  }

  async ingestMatchTimelineCsv(matchId: string, csv: string, replace = false) {
    const parsed = parseMatchTimelineCsv(csv);
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true, competition: true, events: true },
    });
    if (!match) throw new NotFoundException("Match not found");

    if (match.status === "finished" && match.events.length > 0 && !replace) {
      throw new BadRequestException(
        "Match is already finished with events. Re-upload with replace=true or clear events first."
      );
    }

    const existingMeta = (match.meta ?? {}) as Record<string, unknown>;
    const existingStats = (match.stats ?? {}) as Record<string, unknown>;
    const wasFinished = match.status === "finished";

    const meta: Record<string, unknown> = { ...existingMeta };
    if (parsed.penaltyShootout) {
      meta.penaltyShootout = {
        home: parsed.penaltyShootout.home,
        away: parsed.penaltyShootout.away,
        winner: parsed.penaltyShootout.winner,
      };
      meta.regulationScore = { home: parsed.homeScore, away: parsed.awayScore };
    }

    const derivedStats = deriveMatchStatsFromCsvEvents(parsed.events, {
      narrative: parsed.narrative,
    });

    const createdEvents = await this.prisma.$transaction(async (tx) => {
      await tx.sbMatchEvent.deleteMany({ where: { matchId } });

      const rows = [];
      for (const ev of parsed.events) {
        const teamId = ev.teamSide
          ? ev.teamSide === "home"
            ? match.homeTeamId
            : match.awayTeamId
          : null;
        const created = await tx.sbMatchEvent.create({
          data: {
            matchId,
            type: ev.type,
            minute: ev.minute,
            teamId,
            playerLabel: ev.playerLabel,
            assistLabel: ev.assistLabel,
            detail: ev.detail,
            metadata: (ev.metadata ?? { source: "csv-ingest" }) as Prisma.InputJsonValue,
          },
        });
        rows.push(created);
      }

      const statsPayload = {
        ...existingStats,
        ...derivedStats,
        ...(wasFinished ? { lifecycle: undefined } : {}),
      };

      await tx.sbMatch.update({
        where: { id: matchId },
        data: {
          homeScore: parsed.homeScore,
          awayScore: parsed.awayScore,
          minute: 90,
          status: "finished",
          meta: meta as Prisma.InputJsonValue,
          stats: statsPayload as Prisma.InputJsonValue,
        },
      });

      return rows;
    });

    for (const event of createdEvents) {
      if (event.playerId) {
        await this.lifecycle.applyMatchEventToPlayerStats(
          event,
          match.competitionId
        );
      }
    }

    await this.lifecycle.onMatchFinished(matchId);

    return {
      matchId,
      status: "finished" as const,
      homeScore: parsed.homeScore,
      awayScore: parsed.awayScore,
      eventsCreated: createdEvents.length,
      penaltyShootout: parsed.penaltyShootout ?? null,
      standingsRefresh: "scheduled" as const,
    };
  }

  async supervisorFeed() {
    const rows = await this.prisma.sbMatch.findMany({
      where: { status: { in: LIVE_STATUSES } },
      orderBy: { kickoffAt: "asc" },
      include: {
        homeTeam: true,
        awayTeam: true,
        competition: true,
        events: { orderBy: { minute: "desc" }, take: 5 },
      },
    });
    return presentScoreboardPayload(rows);
  }

  async ingestSipMetricsFromMatch(matchId: string) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: {
        competition: true,
        events: {
          where: { playerId: { not: null } },
          orderBy: { minute: "asc" },
        },
      },
    });
    if (!match) throw new NotFoundException("Match not found");

    const eventsByPlayer = new Map<string, EventSnapshot[]>();
    for (const event of match.events) {
      if (!event.playerId) continue;
      const events = eventsByPlayer.get(event.playerId) ?? [];
      events.push({
        minute: event.minute,
        type: event.type,
        playerId: event.playerId,
      });
      eventsByPlayer.set(event.playerId, events);
    }

    if (eventsByPlayer.size === 0) {
      const result = {
        scoreboardMatchId: match.id,
        sipMatchId: match.sipMatchId,
        status: "skipped" as const,
        reason: "no_player_events",
        playersIngested: 0,
        playersSkipped: 0,
        players: [],
      };
      await this.recordSipIngest(match.id, result.status, result.reason, result);
      return result;
    }

    const sipMatchId = await this.ensureSipMatch(match);
    const players: SipIngestPlayerResult[] = [];
    for (const [playerId, events] of eventsByPlayer.entries()) {
      players.push(
        await this.upsertEventDerivedMetrics(playerId, sipMatchId, match, events)
      );
    }

    const playersIngested = players.filter((p) => p.status !== "skipped").length;
    const playersSkipped = players.length - playersIngested;
    const status = playersIngested > 0 ? "success" : "skipped";
    const result = {
      scoreboardMatchId: match.id,
      sipMatchId,
      status,
      playersIngested,
      playersSkipped,
      players,
    };
    await this.recordSipIngest(match.id, status, undefined, result);
    return result;
  }

  private async recordSipIngest(
    matchId: string,
    status: string,
    message: string | undefined,
    summary: Prisma.InputJsonValue
  ) {
    await this.prisma.$transaction([
      this.prisma.sbMatch.update({
        where: { id: matchId },
        data: {
          sipIngestStatus: status,
          sipIngestedAt: new Date(),
          sipIngestSummary: summary,
        },
      }),
      this.prisma.sbSipIngestAudit.create({
        data: {
          matchId,
          status,
          message,
          summary,
        },
      }),
    ]);
  }

  private async ensureSipMatch(match: MatchWithCompetition) {
    if (match.sipMatchId) return match.sipMatchId;

    const externalRef = `${SCOREBOARD_EXTERNAL_REF_PREFIX}${match.id}`;
    const existing = await this.prisma.match.findFirst({
      where: { externalRef },
    });

    const sipMatch =
      existing ??
      (await this.prisma.match.create({
        data: {
          externalRef,
          competition: match.competition.name,
          season: match.competition.season,
          playedAt: match.kickoffAt ?? new Date(),
        },
      }));

    await this.prisma.sbMatch.update({
      where: { id: match.id },
      data: { sipMatchId: sipMatch.id },
    });

    return sipMatch.id;
  }

  private async upsertEventDerivedMetrics(
    playerId: string,
    sipMatchId: string,
    match: Pick<MatchWithCompetition, "status" | "minute">,
    events: EventSnapshot[]
  ): Promise<SipIngestPlayerResult> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true },
    });
    if (!player) {
      return { playerId, status: "skipped", reason: "player_not_found" };
    }

    const existing = await this.prisma.playerMatchMetrics.findUnique({
      where: { playerId_matchId: { playerId, matchId: sipMatchId } },
    });
    const data = this.metricsFromEvents(match, events);

    let status: "created" | "updated";
    if (!existing) {
      await this.prisma.playerMatchMetrics.create({
        data: { playerId, matchId: sipMatchId, ...data },
      });
      status = "created";
    } else if (this.canUpdateEventDerivedMetrics(existing)) {
      await this.prisma.playerMatchMetrics.update({
        where: { playerId_matchId: { playerId, matchId: sipMatchId } },
        data,
      });
      status = "updated";
    } else {
      return { playerId, status: "skipped", reason: "manual_metrics_present" };
    }

    await this.sipRecalc.recalculatePlayer(playerId);
    return { playerId, status };
  }

  private metricsFromEvents(
    match: Pick<MatchWithCompetition, "status" | "minute">,
    events: EventSnapshot[]
  ) {
    const latestEventMinute = events.reduce(
      (max, event) => Math.max(max, event.minute),
      0
    );
    const minutesPlayed = Math.max(
      1,
      match.status === "finished" ? 90 : 0,
      match.minute ?? 0,
      latestEventMinute
    );
    const goalEvents = events.filter((event) => event.type === "goal").length;

    return {
      minutesPlayed,
      ballTouches: events.length,
      oneTouchPossessions: events.length,
      multiTouchPossessions: 0,
      possessionDurationSeconds: 0,
      releaseLacesCount: goalEvents,
      releaseInsideFootCount: Math.max(events.length - goalEvents, 0),
      releaseOtherFootzoneCount: 0,
      leftFootTouchCount: 0,
      rightFootTouchCount: 0,
      leftFootReleaseCount: 0,
      rightFootReleaseCount: 0,
      leftFootReceiveCount: 0,
      rightFootReceiveCount: 0,
      totalDistanceMiles: 0,
      sprintDistanceYards: 0,
      firstStepAccelerations: 0,
      intenseAccelerations: 0,
      sprints: 0,
      intenseTurns: 0,
      leftTurns: 0,
      rightTurns: 0,
      backTurns: 0,
      distanceWithBallYards: 0,
      intenseTurnsWithBall: 0,
    };
  }

  private canUpdateEventDerivedMetrics(row: PlayerMatchMetrics) {
    return (
      row.totalDistanceMiles === 0 &&
      row.sprintDistanceYards === 0 &&
      row.firstStepAccelerations === 0 &&
      row.intenseAccelerations === 0 &&
      row.leftFootTouchCount === 0 &&
      row.rightFootTouchCount === 0 &&
      row.leftFootReceiveCount === 0 &&
      row.rightFootReceiveCount === 0 &&
      row.sprints === 0 &&
      row.intenseTurns === 0 &&
      row.distanceWithBallYards === 0 &&
      row.intenseTurnsWithBall === 0 &&
      (row.kickingPowerMph ?? 0) === 0 &&
      (row.topSpeedMph ?? 0) === 0 &&
      (row.avgTurnEntrySpeedMph ?? 0) === 0 &&
      (row.avgTurnExitSpeedMph ?? 0) === 0
    );
  }
}
