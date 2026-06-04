import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";

export class UpsertAcademyDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @IsOptional()
  @IsIn(["Premium", "Basic"])
  subscriptionTier?: "Premium" | "Basic";

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPlayers?: number;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsString()
  loginUsername?: string;

  @IsOptional()
  @IsString()
  password?: string;
}
