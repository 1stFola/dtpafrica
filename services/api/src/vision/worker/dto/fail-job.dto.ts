import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class FailJobDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  detail?: string;

  /** Default true. False is for a failure that retrying cannot fix. */
  @IsOptional()
  @IsBoolean()
  retryable?: boolean;
}
