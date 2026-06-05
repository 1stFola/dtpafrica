import { Type } from "class-transformer";
import { IsNumber, IsOptional, IsString, Min } from "class-validator";

export class IngestMatchMetricsDto {
  @IsOptional()
  @IsString()
  matchId?: string;

  @IsOptional()
  @IsString()
  competition?: string;

  @IsOptional()
  @IsString()
  season?: string;

  @IsNumber()
  @Min(0)
  minutesPlayed!: number;

  @IsOptional() @IsNumber() ballTouches?: number;
  @IsOptional() @IsNumber() oneTouchPossessions?: number;
  @IsOptional() @IsNumber() multiTouchPossessions?: number;
  @IsOptional() @IsNumber() releaseLacesCount?: number;
  @IsOptional() @IsNumber() releaseInsideFootCount?: number;
  @IsOptional() @IsNumber() releaseOtherFootzoneCount?: number;
  @IsOptional() @IsNumber() leftFootTouchCount?: number;
  @IsOptional() @IsNumber() rightFootTouchCount?: number;
  @IsOptional() @IsNumber() leftFootReleaseCount?: number;
  @IsOptional() @IsNumber() rightFootReleaseCount?: number;
  @IsOptional() @IsNumber() leftFootReceiveCount?: number;
  @IsOptional() @IsNumber() rightFootReceiveCount?: number;
  @IsOptional() @IsNumber() leftFootKickingPowerMph?: number;
  @IsOptional() @IsNumber() rightFootKickingPowerMph?: number;
  @IsOptional() @IsNumber() totalDistanceMiles?: number;
  @IsOptional() @IsNumber() sprintDistanceYards?: number;
  @IsOptional() @IsNumber() firstStepAccelerations?: number;
  @IsOptional() @IsNumber() intenseAccelerations?: number;
  @IsOptional() @IsNumber() kickingPowerMph?: number;
  @IsOptional() @IsNumber() topSpeedMph?: number;
  @IsOptional() @IsNumber() sprints?: number;
  @IsOptional() @IsNumber() intenseTurns?: number;
  @IsOptional() @IsNumber() avgTurnEntrySpeedMph?: number;
  @IsOptional() @IsNumber() avgTurnExitSpeedMph?: number;
  @IsOptional() @IsNumber() leftTurns?: number;
  @IsOptional() @IsNumber() rightTurns?: number;
  @IsOptional() @IsNumber() backTurns?: number;
  @IsOptional() @IsNumber() distanceWithBallYards?: number;
  @IsOptional() @IsNumber() topSpeedWithBallMph?: number;
  @IsOptional() @IsNumber() intenseTurnsWithBall?: number;

  @IsOptional()
  @Type(() => Boolean)
  recalculate?: boolean;
}
