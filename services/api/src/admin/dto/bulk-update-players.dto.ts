import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ArrayMinSize,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class BulkPlayerUpdatesDto {
  @IsOptional()
  @IsString()
  academyId?: string | null;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsString()
  positionPrimary?: string;
}

export class BulkUpdatePlayersDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];

  @IsOptional()
  @IsBoolean()
  delete?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => BulkPlayerUpdatesDto)
  updates?: BulkPlayerUpdatesDto;
}
