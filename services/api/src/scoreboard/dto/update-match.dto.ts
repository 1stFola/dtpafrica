import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class UpdateMatchDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(130)
  minute?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  homeScore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  awayScore?: number;
}
