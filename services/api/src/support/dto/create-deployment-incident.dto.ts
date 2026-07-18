import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateDeploymentIncidentDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  githubRunUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  branch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  commitSha?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  failingStep?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  productionHost?: string;

  @IsString()
  @MinLength(20)
  @MaxLength(12000)
  logExcerpt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
