import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MvceService } from "../mvce/mvce.service";
import { SipRecalculationService } from "../sip/sip-recalculation.service";
import {
  isCalibrationMetricsIncomplete,
  isRatingAttributesPayload,
  presentPlayerMetrics,
} from "./player-metrics.presenter";
import {
  legacyMatchMetricsToPlayerMatchRecord,
  playerMatchMetricsToLegacyMetrics,
  readCalibrationMetricsFromBenchmark,
  toCalibrationMetricsFallback,
} from "../sip/legacy-match-metrics-mapper";
import { syncPhilosophyFitsForPlayer } from "../scouting/philosophy-fit-sync";

@Injectable()
export class PlayerProfileIntelligenceService {
  private readonly logger = new Logger(PlayerProfileIntelligenceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SipRecalculationService) private readonly sipRecalc: SipRecalculationService,
    @Inject(MvceService) private readonly mvce: MvceService
  ) {}

  /** Run SIP / philosophy-fit / MVCE engines when public profile data is missing. */
  async ensureForPublicProfile(playerId: string): Promise<void> {
    const snapshot = await this.prisma.player.findUnique({
      where: { id: playerId, isPublic: true },
      select: {
        id: true,
        _count: {
          select: {
            matchMetrics: true,
            philosophyFitRows: true,
            mvceValuations: true,
          },
        },
      },
    });
    if (!snapshot) return;

    if (snapshot._count.matchMetrics > 0 && (await this.needsSipRecalculation(playerId))) {
      try {
        await this.repairMatchMetricsFromCalibration(playerId);
        await this.sipRecalc.recalculatePlayer(playerId);
      } catch (error) {
        this.logger.warn(
          `SIP recalculation skipped for ${playerId}: ${error instanceof Error ? error.message : error}`
        );
      }
    }

    const hasTactical = await this.prisma.tacticalScores.findUnique({
      where: { playerId },
      select: { playerId: true },
    });

    if (hasTactical) {
      try {
        await syncPhilosophyFitsForPlayer(this.prisma, playerId);
      } catch (error) {
        this.logger.warn(
          `Philosophy fit generation skipped for ${playerId}: ${error instanceof Error ? error.message : error}`
        );
      }
    }

    if (snapshot._count.mvceValuations === 0) {
      try {
        await this.mvce.generate({ playerId });
      } catch (error) {
        this.logger.warn(
          `MVCE generation skipped for ${playerId}: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  }

  /** Rebuild rolling aggregates when match metrics exist but stored aggregates are missing or FM-only. */
  private async needsSipRecalculation(playerId: string): Promise<boolean> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: {
        benchmarkMetadata: true,
        aggregatedMetrics: {
          where: { season: "rolling" },
          take: 1,
          select: { rawAverages: true, derivedMetrics: true },
        },
      },
    });
    const aggregate = player?.aggregatedMetrics[0];
    if (!aggregate?.rawAverages) return true;

    const raw = aggregate.rawAverages as Record<string, unknown>;
    if (isRatingAttributesPayload(raw)) return true;

    const calibrationFallback = toCalibrationMetricsFallback(
      readCalibrationMetricsFromBenchmark(player?.benchmarkMetadata ?? null)
    );
    const presented = presentPlayerMetrics(
      raw,
      aggregate.derivedMetrics as Record<string, unknown> | null,
      calibrationFallback
    );
    if (presented == null) return true;
    return isCalibrationMetricsIncomplete(presented);
  }

  /** Backfill possession / foot-release counts from stored calibration CSV snapshot. */
  private async repairMatchMetricsFromCalibration(playerId: string): Promise<void> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { benchmarkMetadata: true },
    });
    const legacy = readCalibrationMetricsFromBenchmark(player?.benchmarkMetadata ?? null);
    if (!legacy) return;

    const latest = await this.prisma.playerMatchMetrics.findFirst({
      where: { playerId },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) return;

    const repaired = legacyMatchMetricsToPlayerMatchRecord({
      ...playerMatchMetricsToLegacyMetrics(latest),
      ...legacy,
    });

    const needsRepair =
      latest.oneTouchPossessions + latest.multiTouchPossessions <= 0 ||
      latest.leftFootReleaseCount + latest.rightFootReleaseCount <= 0 ||
      latest.possessionDurationSeconds <= 0;
    if (!needsRepair) return;

    await this.prisma.playerMatchMetrics.update({
      where: { id: latest.id },
      data: {
        oneTouchPossessions: repaired.oneTouchPossessions,
        multiTouchPossessions: repaired.multiTouchPossessions,
        possessionDurationSeconds: repaired.possessionDurationSeconds,
        leftFootReleaseCount: repaired.leftFootReleaseCount,
        rightFootReleaseCount: repaired.rightFootReleaseCount,
        leftFootTouchCount: repaired.leftFootTouchCount,
        rightFootTouchCount: repaired.rightFootTouchCount,
        leftFootReceiveCount: repaired.leftFootReceiveCount,
        rightFootReceiveCount: repaired.rightFootReceiveCount,
        releaseLacesCount: repaired.releaseLacesCount,
        releaseInsideFootCount: repaired.releaseInsideFootCount,
        releaseOtherFootzoneCount: repaired.releaseOtherFootzoneCount,
        leftFootKickingPowerMph: repaired.leftFootKickingPowerMph,
        rightFootKickingPowerMph: repaired.rightFootKickingPowerMph,
      },
    });
  }

}
