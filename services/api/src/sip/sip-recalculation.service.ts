import { runSipPipeline } from "@dtp/engines";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { toRawMatchMetrics } from "./metrics-mapper";

@Injectable()
export class SipRecalculationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recalculatePlayer(playerId: string) {
    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!player) {
      throw new NotFoundException(`Player ${playerId} not found`);
    }

    const rows = await this.prisma.playerMatchMetrics.findMany({ where: { playerId } });
    if (rows.length === 0) {
      throw new NotFoundException(`No match metrics for player ${playerId}`);
    }

    const pipeline = runSipPipeline(rows.map(toRawMatchMetrics));

    await this.prisma.playerAggregatedMetrics.upsert({
      where: { playerId_season: { playerId, season: "rolling" } },
      create: {
        playerId,
        season: "rolling",
        matchesPlayed: rows.length,
        minutesPlayed: pipeline.raw.minutesPlayed,
        rawAverages: pipeline.raw as object,
        derivedMetrics: pipeline.derived as object,
      },
      update: {
        matchesPlayed: rows.length,
        minutesPlayed: pipeline.raw.minutesPlayed,
        rawAverages: pipeline.raw as object,
        derivedMetrics: pipeline.derived as object,
      },
    });

    const tactical = await this.prisma.tacticalScores.upsert({
      where: { playerId },
      create: { playerId, ...pipeline.tactical },
      update: { ...pipeline.tactical },
    });

    await this.prisma.positionFitSnapshot.upsert({
      where: { playerId },
      create: {
        playerId,
        primaryPositionFit: pipeline.positionFit.primaryPositionFit,
        secondaryPositionFit: pipeline.positionFit.secondaryPositionFit,
        hybridFit: pipeline.positionFit.hybridFit,
        confidence: pipeline.positionFit.confidence,
      },
      update: {
        primaryPositionFit: pipeline.positionFit.primaryPositionFit,
        secondaryPositionFit: pipeline.positionFit.secondaryPositionFit,
        hybridFit: pipeline.positionFit.hybridFit,
        confidence: pipeline.positionFit.confidence,
      },
    });

    const updatedPlayer = await this.prisma.player.update({
      where: { id: playerId },
      data: {
        overallRating: pipeline.overallRating,
        offensiveRating: pipeline.offensiveRating,
        defensiveRating: pipeline.defensiveRating,
      },
    });

    return {
      player: updatedPlayer,
      aggregated: pipeline.raw,
      derived: pipeline.derived,
      tactical,
      positionFit: pipeline.positionFit,
    };
  }
}
