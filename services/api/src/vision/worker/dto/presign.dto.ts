import { IsString, MaxLength, MinLength } from "class-validator";

export class PresignDto {
  /** Full object key. Validated against the job's own output prefix. */
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  contentType!: string;
}
