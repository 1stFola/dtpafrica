import { IsBoolean, IsOptional } from "class-validator";

export class UpdateContactMessageReadDto {
  @IsOptional()
  @IsBoolean()
  read?: boolean;
}

export class UpdateContactMessageArchiveDto {
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}
