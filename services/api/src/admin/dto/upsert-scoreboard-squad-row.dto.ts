import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class UpsertScoreboardSquadRowDto {
  @IsOptional()
  @IsString()
  teamId?: string;

  @IsString()
  @MaxLength(120)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  position?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  shirtNumber?: number;
}
