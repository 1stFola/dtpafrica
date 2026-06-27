import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { normalizeClubName, clampPercent } from "@dtp/engines";
import {
  resolvePositionFull,
  resolveTopPhilosophies,
} from "../players/player-home-profile";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { resolvePlayerBySlugOrId } from "../players/player-resolve";
import { resolveUniquePlayerSlug } from "../players/player-slug";
import { presentScoreboardPayload } from "../scoreboard/present-scoreboard";
import { matchPathSegment } from "../scoreboard/match-slug";
import { ContactDto } from "./dto/contact.dto";
import { RegisterPlayerDto } from "./dto/register-player.dto";
import {
  buildSkeletonProfile,
  presentProfileStats,
  type SkeletonProfileQuery,
} from "./player-profile.presenter";
import { PlayerProfileIntelligenceService } from "./player-profile-intelligence.service";
import { presentPlayerMetrics } from "./player-metrics.presenter";
import {
  playerMatchMetricsToLegacyMetrics,
  readCalibrationMetricsFromBenchmark,
} from "../sip/legacy-match-metrics-mapper";
import {
  buildSeedByTeamSlug,
  presentAcademyListing,
} from "../academy/academy-directory.util";

const SCOREBOARD_HISTORY_EVENT_LIMIT = 50;
const HOMEPAGE_VIDEO_HIGHLIGHTS_KEY = "homepage.video-highlights";

export type HomeVideoHighlight = {
  id: string;
  playerName: string;
  title: string;
  description?: string;
  youtubeUrl: string;
  sortOrder: number;
};

type ScoreboardSquadRow = Prisma.SbTeamSquadGetPayload<{
  include: { team: { include: { competition: true } } };
}>;

type ScoreboardEventRow = Prisma.SbMatchEventGetPayload<{
  include: {
    team: true;
    match: { include: { competition: true; homeTeam: true; awayTeam: true } };
  };
}>;

@Injectable()
export class HomeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlayerProfileIntelligenceService)
    private readonly profileIntelligence: PlayerProfileIntelligenceService
  ) {}

  async featuredPlayers(limit = 24) {
    const rows = await this.prisma.player.findMany({
      where: { isFeatured: true, isPublic: true },
      take: Math.min(limit, 50),
      orderBy: [{ overallRating: "desc" }, { updatedAt: "desc" }],
      select: {
        ...this.publicPlayerSelect(),
        positionFull: true,
        playingPhilosophies: true,
        tacticalScores: {
          select: {
            gegenpressScore: true,
            tikiTakaScore: true,
            counterAttackScore: true,
            totalFootballScore: true,
            highLineScore: true,
            lowBlockScore: true,
            wingerScore: true,
            directPlayScore: true,
          },
        },
        aggregatedMetrics: {
          where: { season: "rolling" },
          take: 1,
          select: { rawAverages: true, derivedMetrics: true, minutesPlayed: true },
        },
        benchmarkMetadata: true,
      },
    });

    return rows.map(
      ({
        aggregatedMetrics,
        tacticalScores,
        playingPhilosophies,
        positionFull,
        careerMinutes,
        benchmarkMetadata,
        ...player
      }) => ({
        ...player,
        positionFull: resolvePositionFull(player.positionPrimary, positionFull),
        philosophies: resolveTopPhilosophies({
          playingPhilosophies,
          tacticalScores,
        }),
        interceptions: this.extractInterceptions(
          aggregatedMetrics[0]?.derivedMetrics ?? null
        ),
        minutesPlayed: this.resolveMinutesPlayed(
          careerMinutes,
          aggregatedMetrics[0]?.minutesPlayed
        ),
        metrics: presentPlayerMetrics(
          aggregatedMetrics[0]?.rawAverages as Record<string, unknown> | null,
          aggregatedMetrics[0]?.derivedMetrics as Record<string, unknown> | null,
          readCalibrationMetricsFromBenchmark(benchmarkMetadata)
        ),
        benchmarkMetadata: benchmarkMetadata
          ? {
              calibrationMetrics:
                readCalibrationMetricsFromBenchmark(benchmarkMetadata) ?? null,
            }
          : null,
      })
    );
  }

  async videoHighlights(): Promise<HomeVideoHighlight[]> {
    const row = await this.prisma.staticContent.findUnique({
      where: { key: HOMEPAGE_VIDEO_HIGHLIGHTS_KEY },
    });
    if (!row?.value) return [];

    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item): item is HomeVideoHighlight =>
            item != null &&
            typeof item === "object" &&
            typeof (item as HomeVideoHighlight).id === "string" &&
            typeof (item as HomeVideoHighlight).playerName === "string" &&
            typeof (item as HomeVideoHighlight).title === "string" &&
            typeof (item as HomeVideoHighlight).youtubeUrl === "string" &&
            ((item as HomeVideoHighlight).description == null ||
              typeof (item as HomeVideoHighlight).description === "string")
        )
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    } catch {
      return [];
    }
  }

  async publicPlayer(slugOrId: string, query: SkeletonProfileQuery = {}) {
    const resolved = await resolvePlayerBySlugOrId(this.prisma, slugOrId);
    if (!resolved || !resolved.isPublic) {
      return buildSkeletonProfile(slugOrId, query, resolved ?? undefined);
    }

    await this.profileIntelligence.ensureForPublicProfile(resolved.id);

    const player = await this.prisma.player.findFirst({
      where: { id: resolved.id },
      select: {
        ...this.publicProfileSelect(),
        careerGoals: true,
        careerAssists: true,
        careerAppearances: true,
        careerMinutes: true,
        careerCleanSheets: true,
      },
    });
    if (!player) {
      return buildSkeletonProfile(slugOrId, query);
    }

    const {
      tacticalScores,
      positionFit,
      philosophyFitRows,
      aggregatedMetrics,
      matchMetrics,
      scoreboardSquad,
      scoreboardEvents,
      mvceValuations,
      careerGoals,
      careerAssists,
      careerAppearances,
      careerMinutes,
      careerCleanSheets,
      ...profile
    } = player;

    const role = query.role?.trim().toUpperCase() || profile.positionPrimary;
    const latestClub = scoreboardSquad[0]?.team.name
      ? normalizeClubName(scoreboardSquad[0].team.name)
      : null;

    return {
      isSkeleton: false as const,
      ...profile,
      minutesPlayed: this.resolveMinutesPlayed(
        careerMinutes,
        aggregatedMetrics[0]?.minutesPlayed
      ),
      club: query.club?.trim() || latestClub,
      competition:
        query.competition?.trim() ||
        scoreboardSquad[0]?.team.competition.name ||
        null,
      role,
      stats: presentProfileStats(
        {
          careerGoals,
          careerAssists,
          careerAppearances,
          careerMinutes,
          careerCleanSheets,
          positionPrimary: profile.positionPrimary,
        },
        role
      ),
      ratingAttributes: profile.ratingAttributes ?? null,
      benchmarkMetadata: profile.benchmarkMetadata ?? null,
      mediaItems:
        profile.mediaItems ?? this.buildMediaItems(profile.playerPhotoUrl, profile.videoUrl),
      scoutingSummary:
        profile.scoutingSummary ??
        this.buildScoutingSummary({
          displayName: profile.displayName,
          position: profile.positionPrimary,
          ageGroup: profile.ageGroup,
          overallRating: profile.overallRating,
          offensiveRating: profile.offensiveRating,
          defensiveRating: profile.defensiveRating,
        }),
      tacticalSummary: tacticalScores
        ? {
            gegenpressScore: tacticalScores.gegenpressScore,
            tikiTakaScore: tacticalScores.tikiTakaScore,
            counterAttackScore: tacticalScores.counterAttackScore,
            wingerScore: tacticalScores.wingerScore,
            totalFootballScore: tacticalScores.totalFootballScore,
          }
        : null,
      positionFit,
      metrics: presentPlayerMetrics(
        aggregatedMetrics[0]?.rawAverages as Record<string, unknown> | null,
        aggregatedMetrics[0]?.derivedMetrics as Record<string, unknown> | null,
        readCalibrationMetricsFromBenchmark(profile.benchmarkMetadata) ??
          (matchMetrics[0]
            ? playerMatchMetricsToLegacyMetrics(matchMetrics[0])
            : null)
      ),
      scoutingIntelligence: this.buildScoutingIntelligence({
        tacticalScores,
        positionFit,
        philosophyFitRows,
        aggregatedMetrics,
      }),
      scoreboardHistory: this.buildScoreboardHistory(
        scoreboardSquad,
        scoreboardEvents
      ),
      valuation: this.buildValuationSnapshot(mvceValuations[0] ?? null),
    };
  }

  async register(dto: RegisterPlayerDto) {
    if (!dto.consentAccepted) {
      throw new BadRequestException("Consent is required to register");
    }

    const isMinor = dto.age != null && dto.age < 18;
    if (isMinor && (!dto.guardianName || !dto.guardianEmail)) {
      throw new BadRequestException(
        "Guardian name and email are required for players under 18"
      );
    }

    const displayName = `${dto.firstName} ${dto.lastName}`.trim();
    const ageGroup =
      dto.age != null
        ? dto.age <= 15
          ? "U15"
          : dto.age <= 17
            ? "U17"
            : dto.age <= 19
              ? "U19"
              : "Senior"
        : undefined;

    const slug = await resolveUniquePlayerSlug(this.prisma, displayName);
    const player = await this.prisma.player.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName,
        positionPrimary: dto.positionPrimary,
        positionSecondary: dto.positionSecondary,
        nationality: dto.nationality,
        city: dto.city,
        state: dto.state,
        age: dto.age,
        ageGroup,
        dominantFoot: dto.dominantFoot,
        videoUrl: dto.videoUrl,
        biography: dto.biography,
        guardianName: dto.guardianName,
        guardianEmail: dto.guardianEmail,
        guardianPhone: dto.guardianPhone,
        isPublic: false,
        isFeatured: false,
        registrationStatus: "pending",
        slug,
      },
      select: {
        id: true,
        displayName: true,
        registrationStatus: true,
        slug: true,
      },
    });

    return {
      ...player,
      slug: player.slug,
      message:
        "Registration received. Our team will review your profile and contact you.",
    };
  }

  submitContact(dto: ContactDto) {
    return this.prisma.contactMessage.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        subject: dto.subject,
        message: dto.message,
      },
      select: { id: true, createdAt: true },
    });
  }

  listBlog() {
    return this.prisma.blogPost.findMany({
      where: { isPublished: true },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        coverImageUrl: true,
        publishedAt: true,
      },
    });
  }

  async blogBySlug(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { slug, isPublished: true },
    });
    if (!post) throw new NotFoundException("Post not found");
    return post;
  }

  async listAcademies() {
    const comp = await this.prisma.sbCompetition.findUnique({
      where: { slug: "ex-internationals-cup-2026" },
      include: { teams: true },
    });
    const seedByTeamSlug = buildSeedByTeamSlug(comp?.teams ?? []);
    const rows = await this.prisma.academy.findMany({
      where: { isPublished: true },
      orderBy: { name: "asc" },
    });
    return rows.map((row) => presentAcademyListing(row, seedByTeamSlug));
  }

  async academyBySlug(slug: string) {
    const academy = await this.prisma.academy.findFirst({
      where: { slug, isPublished: true },
    });
    if (!academy) throw new NotFoundException("Academy not found");
    return academy;
  }

  async staticContent(keys?: string) {
    if (keys) {
      const list = keys.split(",").map((k) => k.trim()).filter(Boolean);
      const rows = await this.prisma.staticContent.findMany({
        where: { key: { in: list } },
      });
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    }
    const rows = await this.prisma.staticContent.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  private extractInterceptions(derivedMetrics: Prisma.JsonValue): number | null {
    if (
      !derivedMetrics ||
      typeof derivedMetrics !== "object" ||
      Array.isArray(derivedMetrics)
    ) {
      return null;
    }

    const metrics = derivedMetrics as Record<string, unknown>;
    for (const key of [
      "interceptions",
      "interceptionsTotal",
      "total_interceptions",
    ]) {
      const value = metrics[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.round(value);
      }
    }

    return null;
  }

  private publicPlayerSelect() {
    return {
      id: true,
      slug: true,
      displayName: true,
      positionPrimary: true,
      positionSecondary: true,
      nationality: true,
      ageGroup: true,
      playerPhotoUrl: true,
      overallRating: true,
      offensiveRating: true,
      defensiveRating: true,
      careerGoals: true,
      careerAssists: true,
      careerMinutes: true,
      careerCleanSheets: true,
    } satisfies Prisma.PlayerSelect;
  }

  /** Career minutes first; rolling SIP aggregate as fallback. */
  private resolveMinutesPlayed(
    careerMinutes: number,
    aggregatedMinutes?: number | null
  ): number | null {
    if (careerMinutes > 0) return careerMinutes;
    const rolling =
      aggregatedMinutes != null && Number.isFinite(aggregatedMinutes)
        ? Math.round(aggregatedMinutes)
        : 0;
    return rolling > 0 ? rolling : null;
  }

  private publicProfileSelect() {
    return {
      id: true,
      slug: true,
      displayName: true,
      age: true,
      ageGroup: true,
      nationality: true,
      city: true,
      state: true,
      dominantFoot: true,
      heightCm: true,
      positionPrimary: true,
      positionFull: true,
      positionSecondary: true,
      playerPhotoUrl: true,
      videoUrl: true,
      biography: true,
      overallRating: true,
      offensiveRating: true,
      defensiveRating: true,
      ratingAttributes: true,
      benchmarkMetadata: true,
      mediaItems: true,
      scoutingSummary: true,
      tacticalScores: true,
      positionFit: true,
      philosophyFitRows: {
        orderBy: [{ philosophyFitScore: "desc" }, { updatedAt: "desc" }],
        take: 5,
      },
      aggregatedMetrics: {
        where: { season: "rolling" },
        take: 1,
      },
      matchMetrics: {
        take: 1,
        orderBy: { createdAt: "desc" },
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
        take: SCOREBOARD_HISTORY_EVENT_LIMIT,
        orderBy: [{ createdAt: "desc" }],
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
      mvceValuations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    } satisfies Prisma.PlayerSelect;
  }

  private buildScoutingIntelligence(args: {
    tacticalScores: {
      gegenpressScore: number;
      tikiTakaScore: number;
      counterAttackScore: number;
      totalFootballScore: number;
      highLineScore: number;
      wingerScore: number;
      lowBlockScore: number;
      quickReleaseScore: number;
      ballRetentionScore: number;
      technicalCleanlinessScore: number;
      directPlayScore: number;
      flairScore: number;
      pressResistanceScore: number;
      possessionHubScore: number;
      transitionExplosivenessScore: number;
      isolationThreatScore: number;
      twoFootednessScore: number;
    } | null;
    positionFit: {
      primaryPositionFit: string;
      secondaryPositionFit: string | null;
      hybridFit: string | null;
      confidence: number;
    } | null;
    philosophyFitRows: Array<{
      formation: string;
      philosophy: string;
      positionSlot: string | null;
      philosophyFitScore: number;
      positionFitScore: number;
      confidenceScore: number;
    }>;
    aggregatedMetrics: Array<{
      season: string;
      matchesPlayed: number;
      minutesPlayed: number;
      rawAverages: Prisma.JsonValue;
      derivedMetrics: Prisma.JsonValue;
    }>;
  }) {
    const tactical = args.tacticalScores;
    const clampTactical = (value: number) => clampPercent(value, 1);
    const primaryScores = tactical
      ? [
          { label: "Gegenpress", value: clampTactical(tactical.gegenpressScore) },
          { label: "Tiki-taka", value: clampTactical(tactical.tikiTakaScore) },
          { label: "Counter attack", value: clampTactical(tactical.counterAttackScore) },
          { label: "Winger", value: clampTactical(tactical.wingerScore) },
          { label: "Press resistance", value: clampTactical(tactical.pressResistanceScore) },
          { label: "Two-footedness", value: clampTactical(tactical.twoFootednessScore) },
        ].sort((a, b) => b.value - a.value)
      : [];

    const philosophyFits = [...args.philosophyFitRows]
      .sort((a, b) => b.philosophyFitScore - a.philosophyFitScore)
      .map((fit) => ({
        formation: fit.formation,
        philosophy: fit.philosophy,
        positionSlot: fit.positionSlot,
        philosophyFitScore: clampPercent(fit.philosophyFitScore, 1),
        positionFitScore: clampPercent(fit.positionFitScore),
        confidenceScore: clampPercent(fit.confidenceScore),
      }));

    const topTactical = primaryScores[0];
    const bestPhilosophy = philosophyFits[0];

    return {
      tacticalScores: tactical
        ? {
            gegenpressScore: clampTactical(tactical.gegenpressScore),
            tikiTakaScore: clampTactical(tactical.tikiTakaScore),
            counterAttackScore: clampTactical(tactical.counterAttackScore),
            totalFootballScore: clampTactical(tactical.totalFootballScore),
            highLineScore: clampTactical(tactical.highLineScore),
            wingerScore: clampTactical(tactical.wingerScore),
            lowBlockScore: clampTactical(tactical.lowBlockScore),
            quickReleaseScore: clampTactical(tactical.quickReleaseScore),
            ballRetentionScore: clampTactical(tactical.ballRetentionScore),
            technicalCleanlinessScore: clampTactical(tactical.technicalCleanlinessScore),
            directPlayScore: clampTactical(tactical.directPlayScore),
            flairScore: clampTactical(tactical.flairScore),
            pressResistanceScore: clampTactical(tactical.pressResistanceScore),
            possessionHubScore: clampTactical(tactical.possessionHubScore),
            transitionExplosivenessScore: clampTactical(tactical.transitionExplosivenessScore),
            isolationThreatScore: clampTactical(tactical.isolationThreatScore),
            twoFootednessScore: clampTactical(tactical.twoFootednessScore),
          }
        : null,
      topTacticalScores: primaryScores.slice(0, 4).map((row) => ({
        label: row.label,
        value: clampPercent(row.value),
      })),
      tacticalFit: topTactical
        ? { label: topTactical.label, score: clampPercent(topTactical.value) }
        : null,
      philosophyMatch: bestPhilosophy
        ? {
            philosophy: bestPhilosophy.philosophy,
            formation: bestPhilosophy.formation,
            score: clampPercent(bestPhilosophy.philosophyFitScore),
          }
        : null,
      positionFit: args.positionFit
        ? {
            ...args.positionFit,
            confidence: clampPercent(args.positionFit.confidence),
          }
        : null,
      philosophyFits,
      aggregateMetrics: args.aggregatedMetrics[0]
        ? {
            season: args.aggregatedMetrics[0].season,
            matchesPlayed: args.aggregatedMetrics[0].matchesPlayed,
            minutesPlayed: args.aggregatedMetrics[0].minutesPlayed,
            rawAverages: args.aggregatedMetrics[0].rawAverages,
            derivedMetrics: args.aggregatedMetrics[0].derivedMetrics,
          }
        : null,
    };
  }

  private buildScoreboardHistory(
    squadRows: ScoreboardSquadRow[],
    eventRows: ScoreboardEventRow[]
  ) {
    const teams = squadRows.map((row) => ({
      teamId: row.team.id,
      teamName: normalizeClubName(row.team.name),
      teamSlug: row.team.slug,
      shortName: row.team.shortName,
      shirtNumber: row.shirtNumber,
      displayName: row.displayName,
      position: row.position,
      competition: {
        id: row.team.competition.id,
        name: row.team.competition.name,
        slug: row.team.competition.slug,
        season: row.team.competition.season,
        country: row.team.competition.country,
      },
    }));

    const matchMap = new Map<
      string,
      {
        matchId: string;
        matchSlug: string;
        competitionName: string;
        competitionSlug: string;
        season: string;
        kickoffAt: Date | null;
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
      }
    >();

    const events = eventRows.map((event) => {
      const match = event.match;
      const existing =
        matchMap.get(match.id) ??
        {
          matchId: match.id,
          matchSlug: matchPathSegment(match.slug, match.id),
          competitionName: match.competition.name,
          competitionSlug: match.competition.slug,
          season: match.competition.season,
          kickoffAt: match.kickoffAt,
          venue: match.venue,
          roundLabel: match.roundLabel,
          status: match.status,
          homeTeam: {
            id: match.homeTeam.id,
            name: normalizeClubName(match.homeTeam.name),
            slug: match.homeTeam.slug,
            shortName: match.homeTeam.shortName,
          },
          awayTeam: {
            id: match.awayTeam.id,
            name: normalizeClubName(match.awayTeam.name),
            slug: match.awayTeam.slug,
            shortName: match.awayTeam.shortName,
          },
          score: { home: match.homeScore, away: match.awayScore },
          events: 0,
          goals: 0,
          yellowCards: 0,
          redCards: 0,
        };

      existing.events += 1;
      if (event.type === "goal") existing.goals += 1;
      if (event.type === "yellow_card") existing.yellowCards += 1;
      if (event.type === "red_card") existing.redCards += 1;
      matchMap.set(match.id, existing);

      return {
        id: event.id,
        type: event.type,
        minute: event.minute,
        detail: event.detail,
        playerLabel: event.playerLabel,
        team: event.team
          ? {
              id: event.team.id,
              name: normalizeClubName(event.team.name),
              slug: event.team.slug,
              shortName: event.team.shortName,
            }
          : null,
        match: {
          id: match.id,
          slug: matchPathSegment(match.slug, match.id),
          competitionName: match.competition.name,
          competitionSlug: match.competition.slug,
          season: match.competition.season,
          kickoffAt: match.kickoffAt,
          roundLabel: match.roundLabel,
          homeTeam: normalizeClubName(match.homeTeam.name),
          awayTeam: normalizeClubName(match.awayTeam.name),
          score: { home: match.homeScore, away: match.awayScore },
        },
      };
    });

    const appearances = Array.from(matchMap.values()).sort((a, b) => {
      const aTime = a.kickoffAt?.getTime() ?? 0;
      const bTime = b.kickoffAt?.getTime() ?? 0;
      return bTime - aTime;
    });

    return presentScoreboardPayload({
      teams,
      appearances,
      events,
      aggregates: {
        teams: teams.length,
        competitions: new Set(teams.map((team) => team.competition.id)).size,
        appearances: appearances.length,
        events: events.length,
        goals: events.filter((event) => event.type === "goal").length,
        yellowCards: events.filter((event) => event.type === "yellow_card").length,
        redCards: events.filter((event) => event.type === "red_card").length,
      },
    });
  }

  private buildValuationSnapshot(
    valuation: {
      id: string;
      createdAt: Date;
      baseScore: number;
      adjustedScore: number;
      confidenceLabel: string;
      marketValueLabel: string;
      marketValueMinEur: number | null;
      marketValueMaxEur: number | null;
      factors: Prisma.JsonValue;
      multipliers: Prisma.JsonValue;
      strengths: Prisma.JsonValue;
      weaknesses: Prisma.JsonValue;
      scoutNotes: string;
    } | null
  ) {
    if (!valuation) return null;
    return {
      runId: valuation.id,
      createdAt: valuation.createdAt,
      baseScore: valuation.baseScore,
      adjustedScore: valuation.adjustedScore,
      confidenceLabel: valuation.confidenceLabel,
      marketValueLabel: valuation.marketValueLabel,
      marketValueMinEur: valuation.marketValueMinEur,
      marketValueMaxEur: valuation.marketValueMaxEur,
      factors: valuation.factors,
      multipliers: valuation.multipliers,
      strengths: valuation.strengths,
      weaknesses: valuation.weaknesses,
      scoutNotes: valuation.scoutNotes,
    };
  }

  private buildMediaItems(photoUrl?: string | null, videoUrl?: string | null) {
    return [
      photoUrl
        ? {
            type: "photo",
            title: "Profile photo",
            url: photoUrl,
          }
        : null,
      videoUrl
        ? {
            type: "video",
            title: "Highlight video",
            url: videoUrl,
          }
        : null,
    ].filter(Boolean);
  }

  private buildScoutingSummary(args: {
    displayName: string;
    position: string;
    ageGroup?: string | null;
    overallRating?: number | null;
    offensiveRating?: number | null;
    defensiveRating?: number | null;
  }) {
    const overall = args.overallRating ?? 0;
    const tier =
      overall >= 85
        ? "elite prospect"
        : overall >= 75
          ? "pro-ready profile"
          : overall >= 65
            ? "developing prospect"
            : "emerging profile";
    const strongest =
      (args.offensiveRating ?? 0) >= (args.defensiveRating ?? 0)
        ? "attacking contribution"
        : "defensive reliability";
    const ageBand = args.ageGroup ? `${args.ageGroup} ` : "";

    return `${args.displayName} profiles as a ${ageBand}${tier} at ${args.position}, with the clearest current signal in ${strongest}. Scouts should validate the rating against recent match footage, tactical context, and benchmark fit.`;
  }
}
