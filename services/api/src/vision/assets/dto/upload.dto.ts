import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class BeginUploadDto {
  @IsUUID()
  sourceVideoRecordId!: string;

  @IsString()
  @MaxLength(255)
  mimeType!: string;

  /** Advisory. Used to flag a size mismatch on completion, not to enforce one. */
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedBytes?: number;

  /** Constrained tightly: it becomes part of an immutable object key. */
  @IsOptional()
  @Matches(/^[a-z0-9]{1,8}$/i, { message: "extension must be 1-8 alphanumeric characters" })
  extension?: string;
}

export class SignPartsDto {
  /**
   * Batched so a resuming client asks once for its gaps rather than once per part.
   * Capped because each entry costs a signature.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(10_000, { each: true })
  partNumbers!: number[];
}

export class CompletedPartDto {
  @IsInt()
  @Min(1)
  partNumber!: number;

  @IsString()
  @MaxLength(255)
  etag!: string;
}

export class CompleteUploadDto {
  /**
   * What the client believes it uploaded. Advisory: the server prefers what the
   * store actually holds, because a client can die before reporting its last part.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts?: CompletedPartDto[];

  /** Default true: probe and fingerprint start themselves. */
  @IsOptional()
  @IsBoolean()
  enqueueIngest?: boolean;
}
