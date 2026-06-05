import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class CreatePlayerDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsString()
  positionPrimary!: string;

  @IsOptional()
  @IsString()
  positionSecondary?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(250)
  heightCm?: number;

  @IsOptional()
  @IsString()
  dominantFoot?: string;
}
