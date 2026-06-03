import { IsBoolean } from "class-validator";

export class PublishHighlightDto {
  @IsBoolean()
  isPublished!: boolean;
}
