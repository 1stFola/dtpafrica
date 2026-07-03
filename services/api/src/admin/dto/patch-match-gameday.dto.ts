import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class PatchMatchGamedayDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  venue?: string;

  /** Calendar date in WAT, YYYY-MM-DD. Must be sent with kickoffTime. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "kickoffDate must be YYYY-MM-DD" })
  kickoffDate?: string;

  /** Kickoff clock time in WAT, HH:mm (24h). Must be sent with kickoffDate. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: "kickoffTime must be HH:mm" })
  kickoffTime?: string;

  /** Full ISO-8601 datetime (alternative to kickoffDate + kickoffTime). */
  @IsOptional()
  @IsString()
  kickoffAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  roundLabel?: string;
}
