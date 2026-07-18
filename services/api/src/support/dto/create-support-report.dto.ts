import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export const SUPPORT_AUDIENCES = [
  "internal_admin",
  "club",
  "scoreboard_operator",
  "scout",
  "academy",
] as const;

export const SUPPORT_CATEGORIES = [
  "scoreboard_ops",
  "player_data",
  "calibration",
  "tracker_ocr",
  "media_highlights",
  "content_admin",
  "deployment",
  "access_permissions",
  "other",
] as const;

export const SUPPORT_SEVERITIES = ["low", "medium", "high", "critical"] as const;

export class CreateSupportReportDto {
  @IsOptional()
  @IsString()
  @IsIn([...SUPPORT_AUDIENCES])
  audience?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reporterName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  reporterEmail?: string;

  @IsString()
  @IsIn([...SUPPORT_CATEGORIES])
  category!: string;

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORT_SEVERITIES])
  severity?: string;

  @IsString()
  @MinLength(4)
  @MaxLength(160)
  subject!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  pageUrl?: string;
}
