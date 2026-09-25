import { Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class JobArtifactDto {
  /** Full object key. Re-validated against the job's output prefix on arrival. */
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  key!: string;

  @IsString()
  @MaxLength(64)
  bucket!: string;

  @IsInt()
  @Min(0)
  bytes!: number;

  @IsString()
  @MaxLength(255)
  contentType!: string;

  /** What this artifact is — "detections", "proxy", "weights". */
  @IsString()
  @MaxLength(64)
  role!: string;
}

export class JobCostDto {
  @IsOptional() @IsNumber() @Min(0) gpuSeconds?: number;
  @IsOptional() @IsNumber() @Min(0) cpuSeconds?: number;
  @IsOptional() @IsNumber() @Min(0) wallClockSeconds?: number;
  @IsOptional() @IsInt() @Min(0) bytesRead?: number;
  @IsOptional() @IsInt() @Min(0) bytesWritten?: number;
  @IsOptional() @IsInt() @Min(0) classAOperations?: number;
  @IsOptional() @IsInt() @Min(0) classBOperations?: number;
  @IsOptional() @IsInt() @Min(0) thirdPartyApiCostUsdCents?: number;
}

export class CompleteJobDto {
  /**
   * Retry-safe completion. A worker that completed, lost its network and retried
   * sends the same key and gets the original outcome instead of double-applying.
   */
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  idempotencyKey!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobArtifactDto)
  artifacts?: JobArtifactDto[];

  /** Small structured result. Bulk output stays in object storage. */
  @IsOptional()
  @IsObject()
  summary?: Record<string, unknown>;

  /** Image tag actually used, for reproducibility. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  workerImage?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modelVersionIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => JobCostDto)
  cost?: JobCostDto;
}
