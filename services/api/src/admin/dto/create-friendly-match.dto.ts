import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

/**
 * A quick friendly fixture.
 *
 * Deliberately shorter than CreateAdminMatchDto: a friendly has no competition
 * to pick, no stage, no matchday and no knockout round. The two teams, when it
 * kicks off, and optionally where — that is the whole fixture.
 */
export class CreateFriendlyMatchDto {
  @IsString()
  homeTeamId!: string;

  @IsString()
  awayTeamId!: string;

  /** Calendar date in WAT, YYYY-MM-DD. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "kickoffDate must be YYYY-MM-DD" })
  kickoffDate!: string;

  /** Kickoff clock time in WAT, HH:mm (24h). */
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: "kickoffTime must be HH:mm" })
  kickoffTime!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  venue?: string;

  /** Free-text occasion, e.g. "Pre-season friendly". Defaults to "Friendly". */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  roundLabel?: string;
}
