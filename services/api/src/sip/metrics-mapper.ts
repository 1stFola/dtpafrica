import type { RawMatchMetrics } from "@dtp/engines";
import type { PlayerMatchMetrics } from "@prisma/client";

export function toRawMatchMetrics(row: PlayerMatchMetrics): RawMatchMetrics {
  return {
    minutesPlayed: row.minutesPlayed,
    ballTouches: row.ballTouches,
    oneTouchPossessions: row.oneTouchPossessions,
    multiTouchPossessions: row.multiTouchPossessions,
    releaseLacesCount: row.releaseLacesCount,
    releaseInsideFootCount: row.releaseInsideFootCount,
    releaseOtherFootzoneCount: row.releaseOtherFootzoneCount,
    leftFootTouchCount: row.leftFootTouchCount,
    rightFootTouchCount: row.rightFootTouchCount,
    leftFootReleaseCount: row.leftFootReleaseCount,
    rightFootReleaseCount: row.rightFootReleaseCount,
    leftFootReceiveCount: row.leftFootReceiveCount,
    rightFootReceiveCount: row.rightFootReceiveCount,
    leftFootKickingPowerMph: row.leftFootKickingPowerMph ?? 0,
    rightFootKickingPowerMph: row.rightFootKickingPowerMph ?? 0,
    totalDistanceMiles: row.totalDistanceMiles,
    sprintDistanceYards: row.sprintDistanceYards,
    firstStepAccelerations: row.firstStepAccelerations,
    intenseAccelerations: row.intenseAccelerations,
    kickingPowerMph: row.kickingPowerMph ?? 0,
    topSpeedMph: row.topSpeedMph ?? 0,
    sprints: row.sprints,
    intenseTurns: row.intenseTurns,
    avgTurnEntrySpeedMph: row.avgTurnEntrySpeedMph ?? 0,
    avgTurnExitSpeedMph: row.avgTurnExitSpeedMph ?? 0,
    leftTurns: row.leftTurns,
    rightTurns: row.rightTurns,
    backTurns: row.backTurns,
    distanceWithBallYards: row.distanceWithBallYards,
    topSpeedWithBallMph: row.topSpeedWithBallMph ?? 0,
    intenseTurnsWithBall: row.intenseTurnsWithBall,
  };
}
