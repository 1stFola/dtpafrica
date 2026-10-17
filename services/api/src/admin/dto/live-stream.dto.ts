import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { IsYoutubeUrl } from "../validators/is-youtube-url.validator";

/** A live stream card on the public Live Games page; see `SbLiveStream`. */
export class CreateLiveStreamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsYoutubeUrl()
  youtubeUrl!: string;

  /** The fixture this broadcast covers, if any. Empty string clears it. */
  @IsOptional()
  @IsString()
  matchId?: string;

  /** The competition this broadcast covers, if any. Empty string clears it. */
  @IsOptional()
  @IsString()
  competitionId?: string;

  /** Lower comes first on the page. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class UpdateLiveStreamDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsYoutubeUrl()
  youtubeUrl?: string;

  @IsOptional()
  @IsString()
  matchId?: string;

  @IsOptional()
  @IsString()
  competitionId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}
