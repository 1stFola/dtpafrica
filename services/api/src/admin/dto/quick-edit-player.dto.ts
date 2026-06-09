import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class QuickEditPlayerDto {
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(230)
  heightCm?: number;

  @IsOptional()
  @IsString()
  preferredFoot?: string;

  @IsOptional()
  @IsString()
  positionPrimary?: string;

  @IsOptional()
  @IsString()
  estimatedPlayerValue?: string;

  @IsOptional()
  @IsString()
  videoUrl?: string;

  /** One URL per line or comma-separated */
  @IsOptional()
  @IsString()
  photosUrl?: string;

  /** One URL per line or comma-separated */
  @IsOptional()
  @IsString()
  publicationsUrl?: string;
}
