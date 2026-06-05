import { IsOptional, IsString, Matches } from "class-validator";
import { HIGHLIGHT_DURATION_REGEX } from "./highlight-duration";
import { IsVideoMediaUrl } from "../validators/is-video-media-url.validator";

export class UpdateAdminHighlightDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsVideoMediaUrl()
  youtubeUrl?: string;

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
