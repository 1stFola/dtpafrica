import { IsInt, IsOptional, IsString, Min } from "class-validator";
import { IsImageMediaUrl } from "../validators/is-image-media-url.validator";
import { IsVideoMediaUrl } from "../validators/is-video-media-url.validator";

export class CreateAdminHighlightDto {
  @IsString()
  matchId!: string;

  @IsString()
  title!: string;

  @IsVideoMediaUrl()
  youtubeUrl!: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  timelineMinute?: number;

  @IsOptional()
  @IsImageMediaUrl()
  thumbnailUrl?: string;
}
