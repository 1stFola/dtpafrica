import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from "class-validator";
import type { MarketDemandLevel, VerificationLevel } from "@dtp/engines";

export class GenerateValuationDto {
  @IsUUID()
  playerId!: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(45)
  age?: number;

  @IsOptional()
  @IsString()
  positionPrimary?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  competitionTier?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  matchesPlayed?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  goals?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  assists?: number;

  @IsOptional()
  @IsNumber()
  performanceScore?: number;

  @IsOptional()
  @IsNumber()
  athleticScore?: number;

  @IsOptional()
  @IsBoolean()
  verifiedFootage?: boolean;

  @IsOptional()
  @IsBoolean()
  scoutReports?: boolean;

  @IsOptional()
  @IsBoolean()
  tournamentExposure?: boolean;

  @IsOptional()
  @IsBoolean()
  socialVisibility?: boolean;

  @IsOptional()
  @IsBoolean()
  youthNationalTeam?: boolean;

  @IsOptional()
  @IsBoolean()
  clubInterestRumors?: boolean;

  @IsOptional()
  @IsBoolean()
  hasProfessionalContract?: boolean;

  @IsOptional()
  @IsString()
  verificationLevel?: VerificationLevel;

  @IsOptional()
  @IsString()
  marketDemand?: MarketDemandLevel;
}
