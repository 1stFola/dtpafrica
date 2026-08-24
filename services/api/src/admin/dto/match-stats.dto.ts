import { IsArray, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

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

  /** Match clock state (half length, current half, added time). */
  @IsOptional()
  @IsObject()
  clock?: Record<string, unknown>;

  /** Kit colours chosen for each side, as hex. */
  @IsOptional()
  @IsObject()
  kits?: Record<string, unknown>;
}

export class SendBackMatchStatsDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
