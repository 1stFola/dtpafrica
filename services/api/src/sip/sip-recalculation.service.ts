import { runSipPipeline } from "@dtp/engines";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { isRatingAttributesPayload } from "../home/player-metrics.presenter";
import { syncPhilosophyFitsForPlayer } from "../scouting/philosophy-fit-sync";
import {
  mergeCalibrationExtrasIntoRaw,
  readCalibrationMetricsFromBenchmark,
} from "./legacy-match-metrics-mapper";
import { toRawMatchMetrics } from "./metrics-mapper";

export type SipRecalculateOptions = {
  /** Keep calibration headline ratings instead of SIP tactical proxies. */
  preserveHeadlineRatings?: boolean;
};

@Injectable()
export class SipRecalculationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recalculatePlayer(playerId: string, options: SipRecalculateOptions = {}) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        benchmarkMetadata: true,
        ratingAttributes: true,
      },
    });
    if (!player) {
      throw new NotFoundException(`Player ${playerId} not found`);
    }

    const calibrationMetrics = readCalibrationMetricsFromBenchmark(
      player.benchmarkMetadata ?? null
    );

    const rows = await this.prisma.playerMatchMetrics.findMany({ where: { playerId } });
    if (rows.length === 0) {
      throw new NotFoundException(`No match metrics for player ${playerId}`);
    }

    const pipeline = runSipPipeline(rows.map(toRawMatchMetrics));
    const rawAverages = mergeCalibrationExtrasIntoRaw(
      pipeline.raw,
      pipeline.derived as Record<string, unknown>,
      calibrationMetrics
    );

    await this.prisma.playerAggregatedMetrics.upsert({
      where: { playerId_season: { playerId, season: "rolling" } },
      create: {
        playerId,
        season: "rolling",
        matchesPlayed: rows.length,
        minutesPlayed: pipeline.raw.minutesPlayed,
        rawAverages: rawAverages as object,
        derivedMetrics: pipeline.derived as object,
      },
      update: {
        matchesPlayed: rows.length,
        minutesPlayed: pipeline.raw.minutesPlayed,
        rawAverages: rawAverages as object,
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

    const preserveHeadlineRatings =
      options.preserveHeadlineRatings ??
      isRatingAttributesPayload(
        player.ratingAttributes as Record<string, unknown> | null | undefined
      );

    const updatedPlayer = preserveHeadlineRatings
      ? await this.prisma.player.findUniqueOrThrow({ where: { id: playerId } })
      : await this.prisma.player.update({
          where: { id: playerId },
          data: {
            overallRating: pipeline.overallRating,
            offensiveRating: pipeline.offensiveRating,
            defensiveRating: pipeline.defensiveRating,
          },
        });

    await syncPhilosophyFitsForPlayer(this.prisma, playerId);

    return {
      player: updatedPlayer,
      aggregated: pipeline.raw,
      derived: pipeline.derived,
      tactical,
      positionFit: pipeline.positionFit,
    };
  }
}
