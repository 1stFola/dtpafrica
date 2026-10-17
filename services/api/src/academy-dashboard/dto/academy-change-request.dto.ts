import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { IsHttpUrl, NormalizeWebsiteUrl } from "../../shared/http-url";

export class AcademyProfileChangeRequestDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1800)
  @Max(2100)
  foundedYear?: number;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @NormalizeWebsiteUrl()
  @IsString()
  @IsHttpUrl()
  websiteUrl?: string;
}

export class AcademyPlayerChangeRequestDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  publicationUrls?: string[];
}

export class ReviewAcademyChangeRequestDto {
  @IsOptional()
  @IsString()
  adminNotes?: string;
}
