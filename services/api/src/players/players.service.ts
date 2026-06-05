import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { resolveUniquePlayerSlug } from "./player-slug";
import { CreatePlayerDto } from "./dto/create-player.dto";

@Injectable()
export class PlayersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(limit = 50) {
    return this.prisma.player.findMany({
      take: Math.min(limit, 100),
      orderBy: { updatedAt: "desc" },
    });
  }

  async getById(id: string) {
    const player = await this.prisma.player.findUnique({
      where: { id },
      include: {
        tacticalScores: true,
        positionFit: true,
        aggregatedMetrics: { where: { season: "rolling" } },
      },
    });
    if (!player) {
      throw new NotFoundException(`Player ${id} not found`);
    }
    return player;
  }

  async create(dto: CreatePlayerDto) {
    const displayName = dto.displayName ?? `${dto.firstName} ${dto.lastName}`.trim();
    const slug = await resolveUniquePlayerSlug(this.prisma, displayName);
    return this.prisma.player.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        displayName,
        slug,
        positionPrimary: dto.positionPrimary,
        positionSecondary: dto.positionSecondary,
        nationality: dto.nationality,
        heightCm: dto.heightCm,
        dominantFoot: dto.dominantFoot,
      },
    });
  }

  async getTacticalScores(id: string) {
    const scores = await this.prisma.tacticalScores.findUnique({ where: { playerId: id } });
    if (!scores) {
      throw new NotFoundException(`Tactical scores not found for player ${id}`);
    }
    return scores;
  }

  async getPositionFit(id: string) {
    const fit = await this.prisma.positionFitSnapshot.findUnique({ where: { playerId: id } });
    if (!fit) {
      throw new NotFoundException(`Position fit not found for player ${id}`);
    }
    return fit;
  }

  async getTacticalProfile(id: string) {
    const player = await this.getById(id);
    return {
      player: {
        id: player.id,
        displayName: player.displayName,
        positionPrimary: player.positionPrimary,
        overallRating: player.overallRating,
        offensiveRating: player.offensiveRating,
        defensiveRating: player.defensiveRating,
      },
      tacticalScores: player.tacticalScores,
      positionFit: player.positionFit,
      aggregated: player.aggregatedMetrics[0] ?? null,
    };
  }
}
