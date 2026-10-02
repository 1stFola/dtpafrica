import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { EVIDENCE_KINDS, VISION_EVENT_TYPES } from "@dtp/vision-contracts";

export class EvidenceLinkDto {
  @IsIn(EVIDENCE_KINDS as readonly string[])
  kind!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  targetId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ProposeEventDto {
  @IsUUID()
  videoAssetId!: string;

  @IsIn(VISION_EVENT_TYPES as readonly string[])
  type!: string;

  @IsInt()
  @Min(0)
  startMs!: number;

  @IsInt()
  @Min(0)
  endMs!: number;

  @IsOptional()
  @IsUUID()
  actorTrackId?: string;

  /** A roster slot of this match. */
  @IsOptional()
  @IsUUID()
  actorMatchSquadPlayerId?: string;

  /** The team, when known without a slot; must be one of the match's two. */
  @IsOptional()
  @IsUUID()
  sbTeamId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EvidenceLinkDto)
  evidence?: EvidenceLinkDto[];
}

/** A correction: every field optional, and the result is a new row superseding the old. */
export class CorrectEventDto {
  @IsOptional()
  @IsIn(VISION_EVENT_TYPES as readonly string[])
  type?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  startMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  endMs?: number;

  /** null clears the actor track. */
  @IsOptional()
  @IsUUID()
  actorTrackId?: string | null;

  /** null clears the slot. */
  @IsOptional()
  @IsUUID()
  actorMatchSquadPlayerId?: string | null;

  @IsOptional()
  @IsUUID()
  sbTeamId?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EvidenceLinkDto)
  evidence?: EvidenceLinkDto[];
}

export class DecideEventDto {
  @IsIn(["accepted", "rejected"])
  decision!: "accepted" | "rejected";

  /** Required for a rejection. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason?: string;
}

export class PromoteEventDto {
  /** Create a recorder event where none matches. Off by default: creating one changes the match record. */
  @IsOptional()
  @IsBoolean()
  create?: boolean;
}
