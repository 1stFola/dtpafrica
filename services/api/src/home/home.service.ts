import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ContactDto } from "./dto/contact.dto";
import { RegisterPlayerDto } from "./dto/register-player.dto";
import { slugifyDisplayName } from "./slug";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SCOREBOARD_HISTORY_EVENT_LIMIT = 50;

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
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  featuredPlayers(limit = 24) {
    return this.prisma.player.findMany({
      where: { isFeatured: true, isPublic: true },
      take: Math.min(limit, 50),
      orderBy: [{ overallRating: "desc" }, { updatedAt: "desc" }],
      select: this.publicPlayerSelect(),
    });
  }

  async publicPlayer(slugOrId: string) {
    const where: Prisma.PlayerWhereInput = { isPublic: true };
    if (UUID_RE.test(slugOrId)) {
      where.id = slugOrId;
    } else {
      where.slug = slugOrId;
    }

    const player = await this.prisma.player.findFirst({
      where,
      select: this.publicProfileSelect(),
    });
    if (!player) {
      throw new NotFoundException("Player profile not found");
    }

    const {
      tacticalScores,
      positionFit,
      philosophyFitRows,
      aggregatedMetrics,
      scoreboardSquad,
      scoreboardEvents,
      mvceValuations,
      ...profile
    } = player;
    return {
      ...profile,
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
        slug: slugifyDisplayName(displayName),
      },
      select: {
        id: true,
        displayName: true,
        registrationStatus: true,
      },
    });

    const uniqueSlug = slugifyDisplayName(displayName, player.id);
    await this.prisma.player.update({
      where: { id: player.id },
      data: { slug: uniqueSlug },
    });

    return {
      ...player,
      slug: uniqueSlug,
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

  listAcademies() {
    return this.prisma.academy.findMany({
      where: { isPublished: true },
      orderBy: { name: "asc" },
    });
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
    } satisfies Prisma.PlayerSelect;
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
      positionPrimary: true,
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
        orderBy: [{ confidenceScore: "desc" }, { updatedAt: "desc" }],
        take: 5,
      },
      aggregatedMetrics: {
        where: { season: "rolling" },
        take: 1,
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
    const primaryScores = tactical
      ? [
          { label: "Gegenpress", value: tactical.gegenpressScore },
          { label: "Tiki-taka", value: tactical.tikiTakaScore },
          { label: "Counter attack", value: tactical.counterAttackScore },
          { label: "Winger", value: tactical.wingerScore },
          { label: "Press resistance", value: tactical.pressResistanceScore },
          { label: "Two-footedness", value: tactical.twoFootednessScore },
        ].sort((a, b) => b.value - a.value)
      : [];

    return {
      tacticalScores: tactical
        ? {
            gegenpressScore: tactical.gegenpressScore,
            tikiTakaScore: tactical.tikiTakaScore,
            counterAttackScore: tactical.counterAttackScore,
            totalFootballScore: tactical.totalFootballScore,
            highLineScore: tactical.highLineScore,
            wingerScore: tactical.wingerScore,
            lowBlockScore: tactical.lowBlockScore,
            quickReleaseScore: tactical.quickReleaseScore,
            ballRetentionScore: tactical.ballRetentionScore,
            technicalCleanlinessScore: tactical.technicalCleanlinessScore,
            directPlayScore: tactical.directPlayScore,
            flairScore: tactical.flairScore,
            pressResistanceScore: tactical.pressResistanceScore,
            possessionHubScore: tactical.possessionHubScore,
            transitionExplosivenessScore: tactical.transitionExplosivenessScore,
            isolationThreatScore: tactical.isolationThreatScore,
            twoFootednessScore: tactical.twoFootednessScore,
          }
        : null,
      topTacticalScores: primaryScores.slice(0, 4),
      positionFit: args.positionFit,
      philosophyFits: args.philosophyFitRows.map((fit) => ({
        formation: fit.formation,
        philosophy: fit.philosophy,
        positionSlot: fit.positionSlot,
        philosophyFitScore: fit.philosophyFitScore,
        positionFitScore: fit.positionFitScore,
        confidenceScore: fit.confidenceScore,
      })),
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
      teamName: row.team.name,
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
          competitionName: match.competition.name,
          competitionSlug: match.competition.slug,
          season: match.competition.season,
          kickoffAt: match.kickoffAt,
          venue: match.venue,
          roundLabel: match.roundLabel,
          status: match.status,
          homeTeam: {
            id: match.homeTeam.id,
            name: match.homeTeam.name,
            slug: match.homeTeam.slug,
            shortName: match.homeTeam.shortName,
          },
          awayTeam: {
            id: match.awayTeam.id,
            name: match.awayTeam.name,
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
              name: event.team.name,
              slug: event.team.slug,
              shortName: event.team.shortName,
            }
          : null,
        match: {
          id: match.id,
          competitionName: match.competition.name,
          competitionSlug: match.competition.slug,
          season: match.competition.season,
          kickoffAt: match.kickoffAt,
          roundLabel: match.roundLabel,
          homeTeam: match.homeTeam.name,
          awayTeam: match.awayTeam.name,
          score: { home: match.homeScore, away: match.awayScore },
        },
      };
    });

    const appearances = Array.from(matchMap.values()).sort((a, b) => {
      const aTime = a.kickoffAt?.getTime() ?? 0;
      const bTime = b.kickoffAt?.getTime() ?? 0;
      return bTime - aTime;
    });

    return {
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
    };
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
