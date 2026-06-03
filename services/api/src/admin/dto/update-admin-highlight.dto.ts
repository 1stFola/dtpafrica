import { IsOptional, IsString, IsUrl, Matches } from "class-validator";
import { HIGHLIGHT_DURATION_REGEX } from "./highlight-duration";

export class UpdateAdminHighlightDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsUrl()
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
