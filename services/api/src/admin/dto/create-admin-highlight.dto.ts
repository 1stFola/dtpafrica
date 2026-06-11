import { IsIn, IsInt, IsOptional, IsString, Min, ValidateIf } from "class-validator";
import { IsImageMediaUrl } from "../validators/is-image-media-url.validator";
import { IsVideoMediaUrl } from "../validators/is-video-media-url.validator";

export const HIGHLIGHT_MEDIA_TYPES = ["video", "photo"] as const;
export type HighlightMediaType = (typeof HIGHLIGHT_MEDIA_TYPES)[number];

export class CreateAdminHighlightDto {
  @IsString()
  matchId!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsIn(HIGHLIGHT_MEDIA_TYPES)
  type?: HighlightMediaType;

  @ValidateIf((dto: CreateAdminHighlightDto) => !dto.type || dto.type === "video")
  @IsVideoMediaUrl()
  youtubeUrl?: string;

  @ValidateIf((dto: CreateAdminHighlightDto) => dto.type === "photo")
  @IsImageMediaUrl()
  imageUrl?: string;

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
