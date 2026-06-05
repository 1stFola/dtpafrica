import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsIn,
  ArrayMaxSize,
} from "class-validator";

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

  @IsOptional()
  @IsString()
  positionPrimary?: string;

  @IsOptional()
  @IsString()
  positionFull?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  playingPhilosophies?: string[];
}
