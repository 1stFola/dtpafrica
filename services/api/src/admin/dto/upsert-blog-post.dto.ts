import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class UpsertBlogPostDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
