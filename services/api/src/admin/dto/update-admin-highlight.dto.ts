import { IsIn, IsOptional, IsString, Matches, ValidateIf } from "class-validator";
import { HIGHLIGHT_DURATION_REGEX } from "./highlight-duration";
import { HIGHLIGHT_MEDIA_TYPES } from "./create-admin-highlight.dto";
import { IsImageMediaUrl } from "../validators/is-image-media-url.validator";
import { IsVideoMediaUrl } from "../validators/is-video-media-url.validator";

export class UpdateAdminHighlightDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsIn(HIGHLIGHT_MEDIA_TYPES)
  type?: "video" | "photo";

  @ValidateIf((dto: UpdateAdminHighlightDto) => !dto.type || dto.type === "video")
  @IsOptional()
  @IsVideoMediaUrl()
  youtubeUrl?: string;

  @ValidateIf((dto: UpdateAdminHighlightDto) => dto.type === "photo")
  @IsOptional()
  @IsImageMediaUrl()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(HIGHLIGHT_DURATION_REGEX, {
    message: "Duration must be MM:SS (e.g. 03:45)",
  })
  duration?: string;

  @IsOptional()
  @IsString()
  competitionId?: string;
}
