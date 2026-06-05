import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from "class-validator";
import type { CompetitionFormat } from "@dtp/engines";

const FORMATS: CompetitionFormat[] = [
  "STANDARD_LEAGUE",
  "KNOCKOUT_CUP",
  "HYBRID_CHAMPIONS_LEAGUE",
  "SINGLE_FRIENDLY_MATCH",
  "JAGABAN_CUP_STANDARD",
  "COMBINATION_TOURNAMENT",
  "CHALLENGE_LADDER",
];

export class CreateCompetitionTeamDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  shortName?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  groupKey?: string;
}

export class CreateCompetitionFromTemplateDto {
  @IsString()
  name!: string;

  @IsString()
  season!: string;

  @IsString()
  formatType!: CompetitionFormat;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  formatConfig?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  teams?: CreateCompetitionTeamDto[];

  @IsOptional()
  @IsBoolean()
  generateFixtures?: boolean;

  @IsOptional()
  @IsString()
  cloneFromCompetitionId?: string;
}

export function isCompetitionFormat(v: string): v is CompetitionFormat {
  return (FORMATS as string[]).includes(v);
}
