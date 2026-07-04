import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class PatchSpotterOpsDto {
  @IsOptional()
  @IsBoolean()
  lineupsLocked?: boolean;

  @IsOptional()
  @IsBoolean()
  lockLineups?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  officialsConfirmed?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  addedTime?: number;

  @IsOptional()
  pushOfflineEvent?: { type: string; minute: number };

  @IsOptional()
  @IsBoolean()
  popOfflineQueue?: boolean;

  @IsOptional()
  formation?: { home?: string; away?: string };
}
