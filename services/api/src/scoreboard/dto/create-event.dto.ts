import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from "class-validator";

export class CreateMatchEventDto {
  @IsString()
  @IsIn(["goal", "own_goal", "yellow_card", "red_card", "substitution", "injury"])
  type!: string;

  @IsInt()
  @Min(0)
  @Max(130)
  minute!: number;

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsString()
  playerId?: string;

  @IsOptional()
  @IsString()
  assistPlayerId?: string;

  @IsOptional()
  @IsString()
  playerLabel?: string;

  @IsOptional()
  @IsString()
  playerLabel2?: string;

  @IsOptional()
  @IsString()
  assistLabel?: string;

  @IsOptional()
  @IsString()
  detail?: string;

  /** Canonical timeline payload (source, spotterDeviceId, notes, etc.). */
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
