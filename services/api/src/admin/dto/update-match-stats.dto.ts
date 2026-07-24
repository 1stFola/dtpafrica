import { Type } from "class-transformer";
import { IsInt, IsOptional, MaxLength, Min } from "class-validator";

export class MatchStatsSideDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  goals?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  shots?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  shotsOnTarget?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  shotsOffTarget?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  blockedShots?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  corners?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fouls?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offsides?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  yellowCards?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  redCards?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  saves?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  penaltiesAwarded?: number;
}

export class UpdateMatchStatsDto {
  home?: MatchStatsSideDto;
  away?: MatchStatsSideDto;
  source?: "manual" | "csv" | "json";

  @IsOptional()
  @MaxLength(1500)
  narrative?: string;
}
