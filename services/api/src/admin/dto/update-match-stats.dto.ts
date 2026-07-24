import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

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
  @IsOptional()
  @ValidateNested()
  @Type(() => MatchStatsSideDto)
  home?: MatchStatsSideDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MatchStatsSideDto)
  away?: MatchStatsSideDto;

  @IsOptional()
  @IsIn(["manual", "csv", "json"])
  source?: "manual" | "csv" | "json";

  @IsOptional()
  @MaxLength(1500)
  narrative?: string;
}
