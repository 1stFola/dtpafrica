import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Min } from "class-validator";

export class PatchMatchScoreDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  homeScore!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  awayScore!: number;

  /** Defaults to finished when omitted. */
  @IsOptional()
  @IsIn(["finished"])
  status?: "finished";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  penaltyHome?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  penaltyAway?: number;
}
