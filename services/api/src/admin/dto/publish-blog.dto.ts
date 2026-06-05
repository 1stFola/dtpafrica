import { IsBoolean } from "class-validator";

export class PublishBlogDto {
  @IsBoolean()
  isPublished!: boolean;
}
