import { Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString,
  IsUUID, Max, MaxLength, Min, MinLength, ValidateNested,
} from "class-validator";
import { DATASET_GROUPING_LEVELS, type DatasetGroupingLevel } from "../split-policy";

export class SplitPolicyDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) train?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) val?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) test?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) gold?: number;

  /**
   * Broadest grouping first. Validated against a closed list because a typo here
   * would silently fall through to per-asset grouping — which leaks, quietly, and
   * produces a benchmark that looks fine.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(DATASET_GROUPING_LEVELS as unknown as string[], { each: true })
  // Narrow, and honestly so: `@IsIn` rejects anything outside the list before this
  // reaches the service, so the type matches what actually arrives.
  groupBy?: DatasetGroupingLevel[];

  /** Changing the seed reshuffles every split, so it is explicit, never generated. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) seed?: string;
}

export class CreateDatasetVersionDto {
  @IsString() @MinLength(2) @MaxLength(200) label!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsUUID() labelSchemaVersionId?: string;
  @IsOptional() @ValidateNested() @Type(() => SplitPolicyDto) splitPolicy?: SplitPolicyDto;
}

export class AddMembersDto {
  /**
   * Capped so one request cannot hold a transaction open across an entire corpus.
   * Larger imports page.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID("4", { each: true })
  videoAssetIds!: string[];
}
