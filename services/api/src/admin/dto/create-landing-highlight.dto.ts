import { IsString, Matches } from "class-validator";
import { HIGHLIGHT_DURATION_REGEX } from "./highlight-duration";
import { IsVideoMediaUrl } from "../validators/is-video-media-url.validator";

/** Landing-page highlight (competition-scoped video card). */
export class CreateLandingHighlightDto {
  @IsString()
  title!: string;

  @IsVideoMediaUrl()
  youtubeUrl!: string;

  @IsString()
  @Matches(HIGHLIGHT_DURATION_REGEX, {
    message: "Duration must be MM:SS (e.g. 03:45)",
  })
  duration!: string;

  @IsString()
  competitionId!: string;
}
