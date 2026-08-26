import { IsArray, IsBoolean, IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class AdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class UpdateRolePermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

export class CreateAdminUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  name?: string;

  /** Optional: one is generated and returned once when omitted. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsString()
  roleSlug!: string;

  /**
   * Competitions a Match Recorder may work in. Ignored when `allCompetitions`
   * is set, since that already grants everything.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  competitionIds?: string[];

  /** Grants every competition, present and future. */
  @IsOptional()
  @IsBoolean()
  allCompetitions?: boolean;
}

export class UpdateAdminUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsString()
  roleSlug?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Replaces the account's competitions wholesale. Omit to leave unchanged. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  competitionIds?: string[];

  /** Grants every competition, present and future. */
  @IsOptional()
  @IsBoolean()
  allCompetitions?: boolean;
}

export class ResetPasswordDto {
  /** Omit to have a strong password generated and returned once. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
