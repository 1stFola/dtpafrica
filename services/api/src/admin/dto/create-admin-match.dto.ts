import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from "class-validator";
import type { MatchSlugLeg } from "../../scoreboard/match-slug";

const MATCH_STATUSES = ["scheduled", "postponed"] as const;
const KNOCKOUT_ROUNDS = ["R32", "R16", "QF", "SF", "F"] as const;
const LEGS: MatchSlugLeg[] = ["first_leg", "second_leg"];

export class CreateAdminMatchDto {
  @IsString()
  competitionId!: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(64)
  stageKey?: string;

  @IsOptional()
  @IsIn(KNOCKOUT_ROUNDS)
  knockoutRound?: (typeof KNOCKOUT_ROUNDS)[number];

  @IsOptional()
  @IsIn(LEGS)
  leg?: MatchSlugLeg;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  roundLabel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  matchday?: number;

  @IsOptional()
  @IsIn(MATCH_STATUSES)
  status?: (typeof MATCH_STATUSES)[number];
}
