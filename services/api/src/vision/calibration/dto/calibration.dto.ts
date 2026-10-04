import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from "class-validator";

import { CAMERA_SEGMENT_KINDS, type CameraSegmentKind } from "@dtp/vision-contracts";

export class DeclareSegmentDto {
  /** Source milliseconds. */
  @IsInt()
  @Min(0)
  startMs!: number;

  @IsInt()
  @Min(1)
  endMs!: number;

  @IsIn(CAMERA_SEGMENT_KINDS as unknown as string[])
  kind!: CameraSegmentKind;
}

export class PitchDimensionsDto {
  @IsNumber()
  lengthM!: number;

  @IsNumber()
  widthM!: number;
}

export class CalibrationPointDto {
  @IsString()
  @MaxLength(64)
  landmark!: string;

  @IsNumber()
  px!: number;

  @IsNumber()
  py!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  frameIndex?: number;
}

export class CalibrateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => CalibrationPointDto)
  points!: CalibrationPointDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PitchDimensionsDto)
  pitch?: PitchDimensionsDto;
}
