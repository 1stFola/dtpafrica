import {
  compareValuationResults,
  computeValuation,
  type MvceValuationInput,
  type MvceValuationResult,
} from "@dtp/engines";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { normalizePlayerAgeCategory } from "../players/age-category";
import { PrismaService } from "../prisma/prisma.service";
import { GenerateValuationDto } from "./dto/generate-valuation.dto";

@Injectable()
export class MvceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async buildInputFromPlayer(
    playerId: string,
    overrides: Partial<GenerateValuationDto>
  ): Promise<MvceValuationInput> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: {
        tacticalScores: true,
        aggregatedMetrics: { where: { season: "rolling" }, take: 1 },
        matchMetrics: true,
      },
    });
    if (!player) throw new NotFoundException("Player not found");

    const tactical = player.tacticalScores;
    let athleticScore = player.overallRating ?? undefined;
    if (tactical) {
      const blend =
        (tactical.transitionExplosivenessScore +
          tactical.pressResistanceScore +
          tactical.isolationThreatScore) /
        3;
      athleticScore = athleticScore != null ? (athleticScore + blend) / 2 : blend;
    }

    const matchesPlayed =
      overrides.matchesPlayed ??
      player.aggregatedMetrics[0]?.matchesPlayed ??
      player.matchMetrics.length;

    return {
      age: overrides.age ?? player.age ?? undefined,
      positionPrimary:
        overrides.positionPrimary ?? player.positionPrimary,
      nationality: player.nationality ?? undefined,
      heightCm: player.heightCm ?? undefined,
      weightKg: player.weightKg ?? undefined,
      dominantFoot: player.dominantFoot ?? undefined,
      competitionTier: overrides.competitionTier ?? 3,
      matchesPlayed,
      goals: overrides.goals,
      assists: overrides.assists,
      performanceScore:
        overrides.performanceScore ?? player.overallRating ?? undefined,
      athleticScore: overrides.athleticScore ?? athleticScore,
      verifiedFootage:
        overrides.verifiedFootage ?? Boolean(player.videoUrl),
      scoutReports: overrides.scoutReports ?? false,
      tournamentExposure: overrides.tournamentExposure ?? false,
      socialVisibility: overrides.socialVisibility ?? player.isPublic,
      youthNationalTeam: overrides.youthNationalTeam ?? false,
      clubInterestRumors: overrides.clubInterestRumors ?? false,
      hasProfessionalContract: overrides.hasProfessionalContract ?? false,
      verificationLevel: overrides.verificationLevel,
      marketDemand: overrides.marketDemand,
    };
  }

  async generate(dto: GenerateValuationDto) {
    const input = await this.buildInputFromPlayer(dto.playerId, dto);
    const result = computeValuation(input);
    return this.persistRun(dto.playerId, input, result);
  }

  private async persistRun(
    playerId: string,
    input: MvceValuationInput,
    result: MvceValuationResult
  ) {
    const row = await this.prisma.mvceValuationRun.create({
      data: {
        playerId,
        inputs: input as object,
        baseScore: result.baseScore,
        adjustedScore: result.adjustedScore,
        confidenceLabel: result.confidenceLabel,
        marketValueLabel: result.marketValueLabel,
        marketValueMinEur: result.marketValueMinEur,
        marketValueMaxEur: result.marketValueMaxEur,
        factors: result.factors as object,
        multipliers: result.multipliers as object,
        strengths: result.strengths,
        weaknesses: result.weaknesses,
        scoutNotes: result.scoutNotes,
      },
      include: {
        player: {
          select: {
            id: true,
            displayName: true,
            positionPrimary: true,
            playerPhotoUrl: true,
          },
        },
      },
    });
    return this.toReport(row);
  }

  async report(playerId: string) {
    const row = await this.prisma.mvceValuationRun.findFirst({
      where: { playerId },
      orderBy: { createdAt: "desc" },
      include: {
        player: {
          select: {
            id: true,
            displayName: true,
            positionPrimary: true,
            playerPhotoUrl: true,
            age: true,
            ageGroup: true,
            dateOfBirth: true,
            nationality: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException("No valuation for this player");
    return this.toReport(row);
  }

  async compare(idsRaw: string) {
    const ids = idsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length < 2) {
      throw new BadRequestException("Provide at least 2 player ids");
    }
    if (ids.length > 4) {
      throw new BadRequestException("Maximum 4 players");
    }

    const rows = await Promise.all(
      ids.map(async (id) => {
        const report = await this.report(id);
        return {
          playerId: report.player.id,
          displayName: report.player.displayName,
          positionPrimary: report.player.positionPrimary,
          adjustedScore: report.result.adjustedScore,
          confidenceLabel: report.result.confidenceLabel,
          marketValueLabel: report.result.marketValueLabel,
        };
      })
    );

    return compareValuationResults(rows);
  }

  listPlayersWithValuations() {
    return this.prisma.player.findMany({
      where: { mvceValuations: { some: {} } },
      take: 50,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        displayName: true,
        positionPrimary: true,
        playerPhotoUrl: true,
        mvceValuations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            adjustedScore: true,
            confidenceLabel: true,
            marketValueLabel: true,
            createdAt: true,
          },
        },
      },
    });
  }

  private toReport(row: {
    id: string;
    playerId: string;
    inputs: unknown;
    baseScore: number;
    adjustedScore: number;
    confidenceLabel: string;
    marketValueLabel: string;
    marketValueMinEur: number | null;
    marketValueMaxEur: number | null;
    factors: unknown;
    multipliers: unknown;
    strengths: unknown;
    weaknesses: unknown;
    scoutNotes: string;
    createdAt: Date;
    player: {
      id: string;
      displayName: string;
      positionPrimary: string;
      playerPhotoUrl: string | null;
      age?: number | null;
      ageGroup?: string | null;
      dateOfBirth?: Date | null;
      nationality?: string | null;
    };
  }) {
    const { age, ageGroup, dateOfBirth, ...player } = row.player;

    return {
      runId: row.id,
      createdAt: row.createdAt,
      player: {
        ...player,
        ageGroup: normalizePlayerAgeCategory({ age, ageGroup, dateOfBirth }),
      },
      inputs: row.inputs,
      result: {
        baseScore: row.baseScore,
        adjustedScore: row.adjustedScore,
        confidenceLabel: row.confidenceLabel,
        marketValueLabel: row.marketValueLabel,
        marketValueMinEur: row.marketValueMinEur,
        marketValueMaxEur: row.marketValueMaxEur,
        factors: row.factors,
        multipliers: row.multipliers,
        strengths: row.strengths,
        weaknesses: row.weaknesses,
        scoutNotes: row.scoutNotes,
      },
    };
  }
}
