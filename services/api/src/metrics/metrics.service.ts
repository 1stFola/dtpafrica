import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SipRecalculationService } from "../sip/sip-recalculation.service";
import { IngestMatchMetricsDto } from "./dto/ingest-match-metrics.dto";

@Injectable()
export class MetricsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SipRecalculationService) private readonly sipRecalc: SipRecalculationService
  ) {}

  async ingest(playerId: string, dto: IngestMatchMetricsDto) {
    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!player) {
      throw new NotFoundException(`Player ${playerId} not found`);
    }

    let matchId = dto.matchId;
    if (!matchId) {
      const match = await this.prisma.match.create({
        data: {
          competition: dto.competition,
          season: dto.season,
          playedAt: new Date(),
        },
      });
      matchId = match.id;
    }

    const metrics = await this.prisma.playerMatchMetrics.upsert({
      where: { playerId_matchId: { playerId, matchId } },
      create: {
        playerId,
        matchId,
        minutesPlayed: dto.minutesPlayed,
        ballTouches: dto.ballTouches ?? 0,
        oneTouchPossessions: dto.oneTouchPossessions ?? 0,
        multiTouchPossessions: dto.multiTouchPossessions ?? 0,
        releaseLacesCount: dto.releaseLacesCount ?? 0,
        releaseInsideFootCount: dto.releaseInsideFootCount ?? 0,
        releaseOtherFootzoneCount: dto.releaseOtherFootzoneCount ?? 0,
        leftFootTouchCount: dto.leftFootTouchCount ?? 0,
        rightFootTouchCount: dto.rightFootTouchCount ?? 0,
        leftFootReleaseCount: dto.leftFootReleaseCount ?? 0,
        rightFootReleaseCount: dto.rightFootReleaseCount ?? 0,
        leftFootReceiveCount: dto.leftFootReceiveCount ?? 0,
        rightFootReceiveCount: dto.rightFootReceiveCount ?? 0,
        leftFootKickingPowerMph: dto.leftFootKickingPowerMph,
        rightFootKickingPowerMph: dto.rightFootKickingPowerMph,
        totalDistanceMiles: dto.totalDistanceMiles ?? 0,
        sprintDistanceYards: dto.sprintDistanceYards ?? 0,
        firstStepAccelerations: dto.firstStepAccelerations ?? 0,
        intenseAccelerations: dto.intenseAccelerations ?? 0,
        kickingPowerMph: dto.kickingPowerMph,
        topSpeedMph: dto.topSpeedMph,
        sprints: dto.sprints ?? 0,
        intenseTurns: dto.intenseTurns ?? 0,
        avgTurnEntrySpeedMph: dto.avgTurnEntrySpeedMph,
        avgTurnExitSpeedMph: dto.avgTurnExitSpeedMph,
        leftTurns: dto.leftTurns ?? 0,
        rightTurns: dto.rightTurns ?? 0,
        backTurns: dto.backTurns ?? 0,
        distanceWithBallYards: dto.distanceWithBallYards ?? 0,
        topSpeedWithBallMph: dto.topSpeedWithBallMph,
        intenseTurnsWithBall: dto.intenseTurnsWithBall ?? 0,
      },
      update: {
        minutesPlayed: dto.minutesPlayed,
        ballTouches: dto.ballTouches ?? 0,
        oneTouchPossessions: dto.oneTouchPossessions ?? 0,
        multiTouchPossessions: dto.multiTouchPossessions ?? 0,
        releaseLacesCount: dto.releaseLacesCount ?? 0,
        releaseInsideFootCount: dto.releaseInsideFootCount ?? 0,
        releaseOtherFootzoneCount: dto.releaseOtherFootzoneCount ?? 0,
        leftFootTouchCount: dto.leftFootTouchCount ?? 0,
        rightFootTouchCount: dto.rightFootTouchCount ?? 0,
        leftFootReleaseCount: dto.leftFootReleaseCount ?? 0,
        rightFootReleaseCount: dto.rightFootReleaseCount ?? 0,
        leftFootReceiveCount: dto.leftFootReceiveCount ?? 0,
        rightFootReceiveCount: dto.rightFootReceiveCount ?? 0,
        leftFootKickingPowerMph: dto.leftFootKickingPowerMph,
        rightFootKickingPowerMph: dto.rightFootKickingPowerMph,
        totalDistanceMiles: dto.totalDistanceMiles ?? 0,
        sprintDistanceYards: dto.sprintDistanceYards ?? 0,
        firstStepAccelerations: dto.firstStepAccelerations ?? 0,
        intenseAccelerations: dto.intenseAccelerations ?? 0,
        kickingPowerMph: dto.kickingPowerMph,
        topSpeedMph: dto.topSpeedMph,
        sprints: dto.sprints ?? 0,
        intenseTurns: dto.intenseTurns ?? 0,
        avgTurnEntrySpeedMph: dto.avgTurnEntrySpeedMph,
        avgTurnExitSpeedMph: dto.avgTurnExitSpeedMph,
        leftTurns: dto.leftTurns ?? 0,
        rightTurns: dto.rightTurns ?? 0,
        backTurns: dto.backTurns ?? 0,
        distanceWithBallYards: dto.distanceWithBallYards ?? 0,
        topSpeedWithBallMph: dto.topSpeedWithBallMph,
        intenseTurnsWithBall: dto.intenseTurnsWithBall ?? 0,
      },
    });

    const recalc =
      dto.recalculate !== false
        ? await this.sipRecalc.recalculatePlayer(playerId)
        : null;

    return { metrics, recalculation: recalc };
  }
}
