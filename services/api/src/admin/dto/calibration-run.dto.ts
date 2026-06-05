import { Type } from "class-transformer";
import {
  IsBoolean,
  IsOptional,
  IsUUID,
  ValidateNested,
} from "class-validator";
import { CalibrationMetricsDto } from "./calibration-metrics.dto";
import {
  CalibrationPlayerInfoDto,
  LegacyMatchMetricsDto,
} from "./calibration-player-info.dto";

export class CalibrationPreviewDto {
  @IsOptional()
  @IsUUID()
  playerId?: string;

  @ValidateNested()
  @Type(() => CalibrationPlayerInfoDto)
  player!: CalibrationPlayerInfoDto;

  @ValidateNested()
  @Type(() => LegacyMatchMetricsDto)
  metrics!: LegacyMatchMetricsDto;
}

export class CalibratePlayerDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CalibrationPlayerInfoDto)
  player?: CalibrationPlayerInfoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LegacyMatchMetricsDto)
  metrics?: LegacyMatchMetricsDto;

  @IsOptional()
  @IsBoolean()
  save?: boolean;
}

export class CreateCalibratedPlayerDto {
  @ValidateNested()
  @Type(() => CalibrationPlayerInfoDto)
  player!: CalibrationPlayerInfoDto;

  @ValidateNested()
  @Type(() => LegacyMatchMetricsDto)
  metrics!: LegacyMatchMetricsDto;
}

/** @deprecated use LegacyMatchMetricsDto in new requests */
export { CalibrationMetricsDto };
