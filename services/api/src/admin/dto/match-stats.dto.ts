import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class SaveMatchStatsDto {
  /**
   * Raw tallies keyed by stat. Validated loosely here and normalised in the
   * service, which is the single place that knows the stat vocabulary.
   */
  @IsObject()
  tallies!: Record<string, unknown>;

  /** Player events tapped on the Events tab, in recording order. */
  @IsOptional()
  @IsArray()
  events?: unknown[];

  /**
   * Events the recorder deleted since the last save that reached the server. The log is
   * merged by id, so an event missing from `events` is kept; deleting one has to be said.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  removedEventIds?: string[];

  /** Match clock state (half length, current half, added time). */
  @IsOptional()
  @IsObject()
  clock?: Record<string, unknown>;

  /** Kit colours chosen for each side, as hex. */
  @IsOptional()
  @IsObject()
  kits?: Record<string, unknown>;
}

/** A new kick-off for a stopped match, as a date and a West Africa Time. */
export class RescheduleStoppageDto {
  @IsString()
  @MaxLength(10)
  kickoffDate!: string;

  @IsString()
  @MaxLength(5)
  kickoffTime!: string;
}

export class SendBackMatchStatsDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
