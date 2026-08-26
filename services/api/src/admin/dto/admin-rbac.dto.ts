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

  /** Scopes a Match Recorder to one competition. Empty or omitted = unscoped. */
  @IsOptional()
  @IsString()
  competitionId?: string | null;
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

  /** Pass an empty string to clear an existing competition scope. */
  @IsOptional()
  @IsString()
  competitionId?: string | null;
}

export class ResetPasswordDto {
  /** Omit to have a strong password generated and returned once. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
