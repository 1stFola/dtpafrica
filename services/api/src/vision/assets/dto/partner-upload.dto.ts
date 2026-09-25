import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from "class-validator";

/**
 * What a partner supplies. Deliberately the smallest possible surface: the grant
 * already fixes the source record, the size ceiling and the accepted types, so the
 * only decision left is which file.
 */
export class PartnerBeginUploadDto {
  @IsString()
  @MaxLength(255)
  mimeType!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedBytes?: number;

  @IsOptional()
  @Matches(/^[a-z0-9]{1,8}$/i, { message: "extension must be 1-8 alphanumeric characters" })
  extension?: string;
}
