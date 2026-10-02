import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf } from "class-validator";

export class SetSidesDto {
  @IsUUID()
  A!: string;

  @IsUUID()
  B!: string;
}

export class AssignIdentityDto {
  /** A roster slot of this match, or null (or absent) for *unknown*. */
  @ValidateIf((o) => o.matchSquadPlayerId !== null && o.matchSquadPlayerId !== undefined)
  @IsUUID()
  matchSquadPlayerId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  validFromMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  validToMs?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  propagateTo?: string[];

  @IsOptional()
  @IsBoolean()
  acceptSideMismatch?: boolean;
}

export class RejectIdentityDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}
