import { IsBoolean, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateBenchmarkDto {
  @IsString()
  playerName!: string;

  @IsString()
  position!: string;

  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() clubStyle?: string;
  @IsOptional() @IsString() tacticalArchetype?: string;
  @IsOptional() @IsString() dominantFoot?: string;
  @IsOptional() @IsNumber() gegenpressScore?: number;
  @IsOptional() @IsNumber() tikiTakaScore?: number;
  @IsOptional() @IsNumber() counterAttackScore?: number;
  @IsOptional() @IsNumber() totalFootballScore?: number;
  @IsOptional() @IsNumber() highLineScore?: number;
  @IsOptional() @IsNumber() wingerScore?: number;
  @IsOptional() @IsNumber() lowBlockScore?: number;
  @IsOptional() @IsString() bestSystemFit?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
