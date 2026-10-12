import { Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject,
  IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from "class-validator";
import {
  ACQUISITION_METHODS, RIGHTS_EVIDENCE_KINDS, SOURCE_QUALITY_RANKS,
} from "@dtp/vision-contracts";

export class CreatePartnerDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsOptional() @IsUUID() academyId?: string;
  @IsOptional() @IsString() @MaxLength(200) contactName?: string;
  @IsOptional() @IsString() @MaxLength(320) contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(50) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class AddSignatoryDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  /** Q1: Team Managers. Free text, because titles vary by club. */
  @IsString() @MinLength(2) @MaxLength(120) role!: string;
  @IsOptional() @IsString() @MaxLength(320) contactEmail?: string;
  @IsOptional() @IsString() @MaxLength(50) contactPhone?: string;
  @IsOptional() @IsUUID() authorityEvidenceId?: string;
  @IsOptional() @IsISO8601() activeFrom?: string;
}

export class BeginEvidenceUploadDto {
  @IsIn(RIGHTS_EVIDENCE_KINDS as unknown as string[]) kind!: string;
  @Matches(/^[a-z0-9]{1,8}$/i, { message: "extension must be 1-8 alphanumeric characters" })
  extension!: string;
  @IsOptional() @IsISO8601() documentDate?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class GrantScopeDto {
  @IsOptional() @IsUUID() partnerId?: string;
  @IsOptional() @IsUUID() sourceVideoRecordId?: string;
  @IsOptional() @IsUUID() playerId?: string;

  @IsOptional() @IsBoolean() canAnalyze?: boolean;
  @IsOptional() @IsBoolean() canTrain?: boolean;
  @IsOptional() @IsBoolean() canPublishHighlight?: boolean;
  @IsOptional() @IsBoolean() canShareWithScout?: boolean;

  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsOptional() @IsUUID() evidenceId?: string;
  /** e.g. { "deny": ["canPublishHighlight"] }. An unrecognised shape denies. */
  @IsOptional() @IsObject() restrictions?: Record<string, unknown>;
}

export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(2000) reason!: string;
}

export class CreateSourceDto {
  @IsUUID() partnerId!: string;
  @IsOptional() @IsUUID() channelId?: string;
  @IsOptional() @IsString() @MaxLength(200) externalVideoId?: string;
  @IsOptional() @IsString() @MaxLength(2048) url?: string;
  @IsOptional() @IsString() @MaxLength(500) title?: string;
  @IsOptional() @IsISO8601() publishedAt?: string;
  @IsOptional() @IsInt() @Min(1) durationSeconds?: number;
  // ScoreBoard stores text IDs, including legacy fixture IDs that are not UUIDs.
  // The service checks the referenced match instead of guessing its ID format.
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) sbMatchId?: string;
  // ScoreBoard ids are text; not every competition's is a UUID (docs/vision/74, /96).
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) sbCompetitionId?: string;
  /** Not always the partner. A club can grant access to footage it does not own. */
  @IsOptional() @IsString() @MaxLength(200) rightsOwnerName?: string;
  @IsIn(SOURCE_QUALITY_RANKS as unknown as string[]) sourceQualityRank!: string;
  @IsOptional() @IsBoolean() originalAvailable?: boolean;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class ImportSourceRowDto {
  @IsOptional() @IsString() @MaxLength(2048) url?: string;
  @IsOptional() @IsString() @MaxLength(200) externalVideoId?: string;
  @IsOptional() @IsString() @MaxLength(500) title?: string;
  @IsOptional() @IsIn(SOURCE_QUALITY_RANKS as unknown as string[]) sourceQualityRank?: string;
  @IsOptional() @IsInt() @Min(1) durationSeconds?: number;
}

export class ImportSourcesDto {
  @IsUUID() partnerId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000)
  @ValidateNested({ each: true }) @Type(() => ImportSourceRowDto)
  rows!: ImportSourceRowDto[];
}

export class AuthorizeAcquisitionDto {
  @IsIn(ACQUISITION_METHODS as unknown as string[]) acquisitionMethod!: string;
  /** Required: "the partner agreed" is not a record anyone can defend later. */
  @IsUUID() signatoryId!: string;
}

export class IssueUploadGrantDto {
  @IsOptional() @IsInt() @Min(1) @Max(720) expiresInHours?: number;
  @IsOptional() @IsInt() @Min(1) maxBytes?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(10) allowedMimeTypes?: string[];
}
