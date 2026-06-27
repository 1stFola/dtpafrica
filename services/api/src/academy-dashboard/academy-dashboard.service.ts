import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { normalizeClubName } from "@dtp/engines";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { matchPathSegment } from "../scoreboard/match-slug";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PLAYER_INCLUDE = {
  tacticalScores: true,
  positionFit: true,
  philosophyFitRows: {
    orderBy: [{ confidenceScore: "desc" as const }, { updatedAt: "desc" as const }],
    take: 3,
  },
  aggregatedMetrics: {
    where: { season: "rolling" },
    take: 1,
  },
  mvceValuations: {
    orderBy: { createdAt: "desc" as const },
    take: 2,
  },
  scoreboardSquad: {
    include: {
      team: {
        include: {
          competition: true,
        },
      },
    },
  },
  scoreboardEvents: {
    orderBy: { createdAt: "desc" as const },
    take: 8,
    include: {
      team: true,
      match: {
        include: {
          competition: true,
          homeTeam: true,
          awayTeam: true,
        },
      },
    },
  },
} satisfies Prisma.PlayerInclude;

const MATCH_INCLUDE = {
  competition: true,
  homeTeam: true,
  awayTeam: true,
  events: {
    orderBy: { minute: "asc" as const },
    take: 5,
    include: {
      player: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          positionPrimary: true,
        },
      },
    },
  },
  highlights: {
    where: { isPublished: true },
    orderBy: { publishedAt: "desc" as const },
    take: 3,
  },
} satisfies Prisma.SbMatchInclude;

const HIGHLIGHT_INCLUDE = {
  competition: true,
  event: {
    include: {
      player: {
        select: {
          id: true,
          slug: true,
          displayName: true,
        },
      },
    },
  },
  match: {
    include: {
      homeTeam: true,
      awayTeam: true,
    },
  },
} satisfies Prisma.SbHighlightInclude;

type AcademyPlayer = Prisma.PlayerGetPayload<{ include: typeof PLAYER_INCLUDE }>;
type AcademyMatch = Prisma.SbMatchGetPayload<{ include: typeof MATCH_INCLUDE }>;
type AcademyHighlight = Prisma.SbHighlightGetPayload<{ include: typeof HIGHLIGHT_INCLUDE }>;

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: Array<number | null | undefined>) {
  const nums = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericTrend(current?: number | null, previous?: number | null) {
  if (current == null || previous == null) return "new";
  if (current - previous >= 1) return "rising";
  if (previous - current >= 1) return "cooling";
  return "stable";
}

@Injectable()
export class AcademyDashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async dashboard(slugOrId?: string) {
    const academy = await this.findAcademy(slugOrId);
    const players = await this.prisma.player.findMany({
      where: { academyId: academy.id },
      orderBy: [{ overallRating: "desc" }, { displayName: "asc" }],
      include: PLAYER_INCLUDE,
    });

    const teamIds = [
      ...new Set(
        players.flatMap((player) => player.scoreboardSquad.map((row) => row.teamId))
      ),
    ];
    const [matches, highlights] = await Promise.all([
      this.findMatches(teamIds),
      this.findHighlights(academy.id, teamIds),
    ]);

    const squad = players.map((player) => this.toSquadPlayer(player));
    const averageDevelopmentIndex =
      average(squad.map((player) => player.developmentIndex)) ?? 0;
    const activityFeed = this.buildActivityFeed(players, matches, highlights);

    return {
      academy: {
        id: academy.id,
        slug: academy.slug,
        name: academy.name,
        city: academy.city,
        country: academy.country,
        description: academy.description,
        logoUrl: academy.logoUrl,
        websiteUrl: academy.websiteUrl,
      },
      scope: {
        mode: "demo_read_only",
        authNote:
          "Academy-specific authentication is deferred; this dashboard uses the academy-player link and public integration data.",
        linkedScoreboardTeamIds: teamIds,
      },
      overview: {
        kpis: [
          {
            id: "registeredPlayers",
            label: "Registered players",
            value: players.length,
            detail: "Linked to this academy",
            status: "live",
          },
          {
            id: "developmentIndex",
            label: "Avg development index",
            value: clampScore(averageDevelopmentIndex),
            detail: "Ratings + SIP + exposure blend",
            status: "computed",
          },
          {
            id: "scoutViews",
            label: "Scout views",
            value: players.filter((player) => player.isPublic).length,
            detail: "Using public profiles until view analytics exists",
            status: "placeholder",
          },
          {
            id: "trainingAttendance",
            label: "Training attendance",
            value: null,
            detail: "Attendance import not connected",
            status: "deferred",
          },
        ],
        watchlist: squad
          .slice()
          .sort((a, b) => b.exposureReadiness - a.exposureReadiness)
          .slice(0, 6),
        activityFeed,
      },
      squad,
      fixtures: matches.map((match) => this.toFixture(match, teamIds)),
      development: {
        indexMethod:
          "Read-only blend of DTP ratings, SIP tactical fit, ScoreBoard exposure, and latest MVCE score.",
        leaders: squad
          .slice()
          .sort((a, b) => b.developmentIndex - a.developmentIndex)
          .slice(0, 8),
        needsData: squad.filter((player) => player.developmentIndex < 55).slice(0, 6),
      },
      philosophy: {
        defaultFormation: "4-3-3",
        defaultPhilosophy: "tiki_taka",
        note:
          "Academy-level philosophy settings are read-only defaults for now; player fit is sourced from existing SIP rows.",
        players: squad
          .filter((player) => player.tacticalFit != null)
          .sort((a, b) => (b.tacticalFit ?? 0) - (a.tacticalFit ?? 0))
          .slice(0, 10),
      },
      valuation: {
        latest: squad
          .filter((player) => player.valuation)
          .sort(
            (a, b) =>
              (b.valuation?.adjustedScore ?? 0) - (a.valuation?.adjustedScore ?? 0)
          ),
        totalValueRangeEur: this.totalValueRange(players),
      },
      media: this.buildMedia(players, highlights),
    };
  }

  async squad(slugOrId: string) {
    const dashboard = await this.dashboard(slugOrId);
    return dashboard.squad;
  }

  async fixtures(slugOrId: string) {
    const dashboard = await this.dashboard(slugOrId);
    return dashboard.fixtures;
  }

  async development(slugOrId: string) {
    const dashboard = await this.dashboard(slugOrId);
    return dashboard.development;
  }

  async philosophy(slugOrId: string) {
    const dashboard = await this.dashboard(slugOrId);
    return dashboard.philosophy;
  }

  async valuation(slugOrId: string) {
    const dashboard = await this.dashboard(slugOrId);
    return dashboard.valuation;
  }

  async media(slugOrId: string) {
    const dashboard = await this.dashboard(slugOrId);
    return dashboard.media;
  }

  private async findAcademy(slugOrId?: string) {
    if (slugOrId) {
      const academy = await this.prisma.academy.findFirst({
        where: UUID_RE.test(slugOrId) ? { id: slugOrId } : { slug: slugOrId },
      });
      if (!academy) throw new NotFoundException("Academy not found");
      return academy;
    }

    const academy = await this.prisma.academy.findFirst({
      orderBy: [{ isPublished: "desc" }, { updatedAt: "desc" }],
    });
    if (!academy) throw new NotFoundException("No academy has been created yet");
    return academy;
  }

  private async findMatches(teamIds: string[]) {
    if (teamIds.length === 0) return [];
    return this.prisma.sbMatch.findMany({
      where: {
        isPublished: true,
        competition: { isPublished: true },
        OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
      },
      orderBy: [{ kickoffAt: "desc" }, { updatedAt: "desc" }],
      take: 18,
      include: MATCH_INCLUDE,
    });
  }

  private async findHighlights(academyId: string, teamIds: string[]) {
    return this.prisma.sbHighlight.findMany({
      where: {
        isPublished: true,
        OR: [
          { event: { is: { player: { is: { academyId } } } } },
          ...(teamIds.length
            ? [
                { match: { is: { homeTeamId: { in: teamIds } } } },
                { match: { is: { awayTeamId: { in: teamIds } } } },
              ]
            : []),
        ],
      },
      orderBy: { publishedAt: "desc" },
      take: 12,
      include: HIGHLIGHT_INCLUDE,
    });
  }

  private toSquadPlayer(player: AcademyPlayer) {
    const latestValuation = player.mvceValuations[0] ?? null;
    const previousValuation = player.mvceValuations[1] ?? null;
    const aggregate = player.aggregatedMetrics[0] ?? null;
    const ratingAverage = average([
      player.overallRating,
      player.offensiveRating,
      player.defensiveRating,
    ]);
    const tacticalAverage = player.tacticalScores
      ? average([
          player.tacticalScores.gegenpressScore,
          player.tacticalScores.tikiTakaScore,
          player.tacticalScores.counterAttackScore,
          player.tacticalScores.totalFootballScore,
          player.tacticalScores.technicalCleanlinessScore,
          player.tacticalScores.pressResistanceScore,
        ])
      : null;
    const philosophyFit =
      player.philosophyFitRows[0]?.philosophyFitScore ?? tacticalAverage;
    const exposureScore = clampScore(
      Math.min(100, (aggregate?.matchesPlayed ?? player.scoreboardEvents.length) * 12)
    );
    const developmentIndex = clampScore(
      (ratingAverage ?? 50) * 0.52 +
        (philosophyFit ?? 50) * 0.28 +
        exposureScore * 0.1 +
        (latestValuation?.adjustedScore ?? ratingAverage ?? 50) * 0.1
    );
    const exposureReadiness = clampScore(
      developmentIndex * 0.5 +
        (latestValuation?.adjustedScore ?? developmentIndex) * 0.25 +
        (player.isPublic ? 15 : 0) +
        (player.videoUrl ? 10 : 0)
    );

    return {
      id: player.id,
      slug: player.slug,
      profilePath: `/player/${player.slug ?? player.id}`,
      displayName: player.displayName,
      positionPrimary: player.positionPrimary,
      positionSecondary: player.positionSecondary,
      age: player.age,
      ageGroup: player.ageGroup,
      dominantFoot: player.dominantFoot,
      nationality: player.nationality,
      status: player.registrationStatus,
      isPublic: player.isPublic,
      playerPhotoUrl: player.playerPhotoUrl,
      overallRating: player.overallRating,
      offensiveRating: player.offensiveRating,
      defensiveRating: player.defensiveRating,
      developmentIndex,
      exposureReadiness,
      tacticalFit: philosophyFit == null ? null : clampScore(philosophyFit),
      tacticalTags: this.tacticalTags(player),
      positionFit: player.positionFit
        ? {
            primary: player.positionFit.primaryPositionFit,
            secondary: player.positionFit.secondaryPositionFit,
            hybrid: player.positionFit.hybridFit,
            confidence: clampScore(player.positionFit.confidence),
          }
        : null,
      scoreboard: {
        teams: player.scoreboardSquad.map((row) => ({
          teamId: row.teamId,
          teamName: normalizeClubName(row.team.name),
          competitionName: row.team.competition.name,
          shirtNumber: row.shirtNumber,
          position: row.position,
        })),
        matchesPlayed: aggregate?.matchesPlayed ?? 0,
        minutesPlayed: aggregate?.minutesPlayed ?? 0,
        recentEvents: player.scoreboardEvents.map((event) => ({
          id: event.id,
          type: event.type,
          minute: event.minute,
          detail: event.detail,
          matchId: event.matchId,
          matchLabel: `${event.match.homeTeam.shortName ?? event.match.homeTeam.name} ${event.match.homeScore}-${event.match.awayScore} ${event.match.awayTeam.shortName ?? event.match.awayTeam.name}`,
          createdAt: event.createdAt,
        })),
      },
      valuation: latestValuation
        ? {
            runId: latestValuation.id,
            createdAt: latestValuation.createdAt,
            adjustedScore: Math.round(latestValuation.adjustedScore),
            confidenceLabel: latestValuation.confidenceLabel,
            marketValueLabel: latestValuation.marketValueLabel,
            marketValueMinEur: latestValuation.marketValueMinEur,
            marketValueMaxEur: latestValuation.marketValueMaxEur,
            trend: numericTrend(
              latestValuation.adjustedScore,
              previousValuation?.adjustedScore
            ),
          }
        : null,
      mediaCount: this.playerMedia(player).length,
      updatedAt: player.updatedAt,
    };
  }

  private tacticalTags(player: AcademyPlayer) {
    const tactical = player.tacticalScores;
    if (!tactical) return [];
    const rows = [
      ["Gegenpress", tactical.gegenpressScore],
      ["Tiki-taka", tactical.tikiTakaScore],
      ["Counter", tactical.counterAttackScore],
      ["Press resistant", tactical.pressResistanceScore],
      ["Explosive transition", tactical.transitionExplosivenessScore],
      ["Two-footed", tactical.twoFootednessScore],
    ] as const;
    return rows
      .filter(([, value]) => value >= 70)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label]) => label);
  }

  private toFixture(match: AcademyMatch, teamIds: string[]) {
    const homeLinked = teamIds.includes(match.homeTeamId);
    const awayLinked = teamIds.includes(match.awayTeamId);
    const academySide = homeLinked && awayLinked ? "both" : homeLinked ? "home" : "away";
    const goalsFor =
      academySide === "home"
        ? match.homeScore
        : academySide === "away"
          ? match.awayScore
          : null;
    const goalsAgainst =
      academySide === "home"
        ? match.awayScore
        : academySide === "away"
          ? match.homeScore
          : null;

    return {
      id: match.id,
      slug: matchPathSegment(match.slug, match.id),
      status: match.status,
      minute: match.minute,
      kickoffAt: match.kickoffAt,
      venue: match.venue,
      roundLabel: match.roundLabel,
      competition: {
        id: match.competition.id,
        name: match.competition.name,
        slug: match.competition.slug,
        season: match.competition.season,
      },
      academySide,
      homeTeam: {
        id: match.homeTeam.id,
        name: match.homeTeam.name,
        shortName: match.homeTeam.shortName,
      },
      awayTeam: {
        id: match.awayTeam.id,
        name: match.awayTeam.name,
        shortName: match.awayTeam.shortName,
      },
      score: { home: match.homeScore, away: match.awayScore },
      result:
        match.status !== "finished" || goalsFor == null || goalsAgainst == null
          ? match.status
          : goalsFor > goalsAgainst
            ? "W"
            : goalsFor < goalsAgainst
              ? "L"
              : "D",
      events: match.events.map((event) => ({
        id: event.id,
        type: event.type,
        minute: event.minute,
        detail: event.detail,
        playerLabel: event.player?.displayName ?? event.playerLabel,
      })),
      highlights: match.highlights.map((highlight) => ({
        id: highlight.id,
        title: highlight.title,
        youtubeUrl: highlight.youtubeUrl,
      })),
    };
  }

  private buildActivityFeed(
    players: AcademyPlayer[],
    matches: AcademyMatch[],
    highlights: AcademyHighlight[]
  ) {
    const valuationItems = players.flatMap((player) =>
      player.mvceValuations.slice(0, 1).map((valuation) => ({
        id: `valuation-${valuation.id}`,
        type: "valuation",
        title: `${player.displayName} valuation refreshed`,
        detail: `${valuation.confidenceLabel} · ${valuation.marketValueLabel}`,
        at: valuation.createdAt,
        href: `/valuation/player/${player.id}`,
      }))
    );
    const eventItems = players.flatMap((player) =>
      player.scoreboardEvents.slice(0, 3).map((event) => ({
        id: `event-${event.id}`,
        type: "scoreboard",
        title: `${player.displayName}: ${event.type.replace(/_/g, " ")}`,
        detail: `${event.minute}' · ${event.match.competition.name}`,
        at: event.createdAt,
        href: `/scoreboard/match/${matchPathSegment(event.match.slug, event.match.id)}`,
      }))
    );
    const matchItems = matches.slice(0, 5).map((match) => ({
      id: `match-${match.id}`,
      type: "fixture",
      title: `${match.homeTeam.name} ${match.homeScore}-${match.awayScore} ${match.awayTeam.name}`,
      detail: `${match.status} · ${match.competition.name}`,
      at: match.kickoffAt ?? match.updatedAt,
      href: `/scoreboard/match/${matchPathSegment(match.slug, match.id)}`,
    }));
    const highlightItems = highlights.slice(0, 4).map((highlight) => ({
      id: `highlight-${highlight.id}`,
      type: "media",
      title: highlight.title,
      detail: highlight.event?.player?.displayName ?? "ScoreBoard highlight",
      at: highlight.publishedAt,
      href: highlight.youtubeUrl,
    }));

    return [...valuationItems, ...eventItems, ...matchItems, ...highlightItems]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 12);
  }

  private buildMedia(players: AcademyPlayer[], highlights: AcademyHighlight[]) {
    const profileMedia = players.flatMap((player) => this.playerMedia(player));
    const scoreboardMedia = highlights.map((highlight) => ({
      id: `highlight-${highlight.id}`,
      type: "scoreboard_highlight",
      title: highlight.title,
      url: highlight.youtubeUrl,
      playerName: highlight.event?.player?.displayName ?? null,
      playerSlug: highlight.event?.player?.slug ?? null,
      source: "ScoreBoard",
      publishedAt: highlight.publishedAt,
    }));
    return [...profileMedia, ...scoreboardMedia].slice(0, 24);
  }

  private playerMedia(player: AcademyPlayer) {
    const rows: Array<{
      id: string;
      type: string;
      title: string;
      url: string;
      thumbnailUrl: string | null;
      playerName: string;
      playerSlug: string | null;
      source: string;
      publishedAt: Date;
    }> = [];

    if (Array.isArray(player.mediaItems)) {
      player.mediaItems.forEach((item, index) => {
        if (!isRecord(item)) return;
        const url = stringValue(item.url);
        if (!url) return;
        rows.push({
          id: `media-${player.id}-${index}`,
          type: stringValue(item.type) ?? "media",
          title: stringValue(item.title) ?? "Player media",
          url,
          thumbnailUrl: stringValue(item.thumbnailUrl),
          playerName: player.displayName,
          playerSlug: player.slug,
          source: "Player profile",
          publishedAt: player.updatedAt,
        });
      });
    }

    if (player.videoUrl && !rows.some((row) => row.url === player.videoUrl)) {
      rows.push({
        id: `video-${player.id}`,
        type: "video",
        title: "Highlight video",
        url: player.videoUrl,
        thumbnailUrl: null,
        playerName: player.displayName,
        playerSlug: player.slug,
        source: "Player profile",
        publishedAt: player.updatedAt,
      });
    }

    if (player.playerPhotoUrl && !rows.some((row) => row.url === player.playerPhotoUrl)) {
      rows.push({
        id: `photo-${player.id}`,
        type: "photo",
        title: "Profile photo",
        url: player.playerPhotoUrl,
        thumbnailUrl: player.playerPhotoUrl,
        playerName: player.displayName,
        playerSlug: player.slug,
        source: "Player profile",
        publishedAt: player.updatedAt,
      });
    }

    return rows;
  }

  private totalValueRange(players: AcademyPlayer[]) {
    return players.reduce(
      (range, player) => {
        const latest = player.mvceValuations[0];
        return {
          min: range.min + (latest?.marketValueMinEur ?? 0),
          max: range.max + (latest?.marketValueMaxEur ?? 0),
        };
      },
      { min: 0, max: 0 }
    );
  }
}
