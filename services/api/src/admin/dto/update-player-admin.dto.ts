import { IsBoolean, IsOptional, IsString, IsIn } from "class-validator";

export class UpdatePlayerAdminDto {
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(["pending", "approved", "rejected"])
  registrationStatus?: string;

  @IsOptional()
  @IsString()
  biography?: string;

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}
