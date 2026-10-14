import { IsString, MaxLength } from "class-validator";

export class MergeTeamsDto {
  /** The duplicate: deleted (same competition) or renamed to match (different ones). */
  @IsString()
  @MaxLength(64)
  sourceTeamId!: string;

  /** The team that is kept. */
  @IsString()
  @MaxLength(64)
  targetTeamId!: string;
}
