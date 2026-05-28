import { IsInt, IsOptional, IsString, IsUrl, Min } from "class-validator";

export class CreateAdminHighlightDto {
  @IsString()
  matchId!: string;

  @IsString()
  title!: string;

  @IsUrl()
  youtubeUrl!: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  timelineMinute?: number;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;
}
