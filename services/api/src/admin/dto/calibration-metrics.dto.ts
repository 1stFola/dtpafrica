import { IsNumber, IsOptional } from "class-validator";

export class CalibrationMetricsDto {
  @IsOptional()
  @IsNumber()
  minutesPlayed?: number;

  @IsOptional()
  @IsNumber()
  ballTouches?: number;

  @IsOptional()
  @IsNumber()
  totalDistanceMiles?: number;

  @IsOptional()
  @IsNumber()
  sprintDistanceYards?: number;

  @IsOptional()
  @IsNumber()
  firstStepAccelerations?: number;

  @IsOptional()
  @IsNumber()
  intenseAccelerations?: number;

  @IsOptional()
  @IsNumber()
  kickingPowerMph?: number;

  @IsOptional()
  @IsNumber()
  topSpeedMph?: number;

  @IsOptional()
  @IsNumber()
  sprints?: number;

  @IsOptional()
  @IsNumber()
  intenseTurns?: number;

  @IsOptional()
  @IsNumber()
  avgTurnEntrySpeedMph?: number;

  @IsOptional()
  @IsNumber()
  avgTurnExitSpeedMph?: number;

  @IsOptional()
  @IsNumber()
  leftTurns?: number;

  @IsOptional()
  @IsNumber()
  rightTurns?: number;

  @IsOptional()
  @IsNumber()
  backTurns?: number;

  @IsOptional()
  @IsNumber()
  distanceWithBallYards?: number;

  @IsOptional()
  @IsNumber()
  topSpeedWithBallMph?: number;

  @IsOptional()
  @IsNumber()
  intenseTurnsWithBall?: number;
}
