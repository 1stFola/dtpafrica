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
  total_distance?: number;

  @IsOptional()
  @IsNumber()
  sprint_distance?: number;

  @IsOptional()
  @IsNumber()
  sprints?: number;

  @IsOptional()
  @IsNumber()
  top_speed?: number;

  @IsOptional()
  @IsNumber()
  first_step_accelerations?: number;

  @IsOptional()
  @IsNumber()
  intense_accelerations?: number;

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
  turn_efficiency?: number;

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
  ball_touches?: number;

  @IsOptional()
  @IsNumber()
  possession_duration_seconds?: number;

  @IsOptional()
  @IsNumber()
  one_touch_possessions_percentage?: number;

  @IsOptional()
  @IsNumber()
  multi_touch_possessions__percentage?: number;

  @IsOptional()
  @IsNumber()
  quick_release_score?: number;

  @IsOptional()
  @IsNumber()
  distance_with_ball?: number;

  @IsOptional()
  @IsNumber()
  top_speed_with_ball?: number;

  @IsOptional()
  @IsNumber()
  intense_turns_with_ball?: number;

  @IsOptional()
  @IsNumber()
  kicking_power?: number;

  @IsOptional()
  @IsNumber()
  release_inside_foot_percentage?: number;

  @IsOptional()
  @IsNumber()
  release_laces_percentage?: number;

  @IsOptional()
  @IsNumber()
  release_other_footzone_percentage?: number;

  @IsOptional()
  @IsNumber()
  left_foot_touch_percentage?: number;

  @IsOptional()
  @IsNumber()
  left_foot_release_percentage?: number;

  @IsOptional()
  @IsNumber()
  left_foot_receive_percentage?: number;

  @IsOptional()
  @IsNumber()
  left_foot_kicking_power_mph?: number;

  @IsOptional()
  @IsNumber()
  right_foot_touch_percentage?: number;

  @IsOptional()
  @IsNumber()
  right_foot_release_percentage?: number;

  @IsOptional()
  @IsNumber()
  right_foot_receive_percentage?: number;

  @IsOptional()
  @IsNumber()
  right_foot_kicking_power_mph?: number;
}
