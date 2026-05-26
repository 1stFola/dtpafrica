import { IsIn, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";

const POSITIONS = ["ST", "WINGER", "AM", "CM", "CDM", "FB", "CB"] as const;

export class CalibrationPlayerInfoDto {
  @IsString()
  @MaxLength(120)
  fullName!: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @IsString()
  @IsIn([...POSITIONS])
  position!: string;

  @IsOptional()
  @IsString()
  benchmarkRegion?: string;

  @IsOptional()
  @IsString()
  benchmarkAgeBand?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  heightFt?: string;

  @IsOptional()
  @IsNumber()
  weightKg?: number;

  @IsOptional()
  @IsString()
  currentClub?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsString()
  videoUrl?: string;
}

export class LegacyMatchMetricsDto {
  @IsOptional()
  @IsNumber()
  duration?: number;

  @IsOptional()
  @IsNumber()
  ball_touches?: number;

  @IsOptional()
  @IsNumber()
  total_distance?: number;

  @IsOptional()
  @IsNumber()
  sprint_distance?: number;

  @IsOptional()
  @IsNumber()
  accelerations?: number;

  @IsOptional()
  @IsNumber()
  decelerations?: number;

  @IsOptional()
  @IsNumber()
  top_speed?: number;

  @IsOptional()
  @IsNumber()
  sprints?: number;

  @IsOptional()
  @IsNumber()
  intense_turns?: number;

  @IsOptional()
  @IsNumber()
  avg_turn_entry?: number;

  @IsOptional()
  @IsNumber()
  avg_turn_exit?: number;

  @IsOptional()
  @IsNumber()
  left_turns?: number;

  @IsOptional()
  @IsNumber()
  right_turns?: number;

  @IsOptional()
  @IsNumber()
  back_turns?: number;

  @IsOptional()
  @IsNumber()
  kicking_power?: number;

  @IsOptional()
  @IsNumber()
  distance_with_ball?: number;

  @IsOptional()
  @IsNumber()
  top_speed_with_ball?: number;

  @IsOptional()
  @IsNumber()
  intense_turns_with_ball?: number;
}
