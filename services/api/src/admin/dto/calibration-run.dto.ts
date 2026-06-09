import { Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
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

  /** Override tier-based benchmark auto-selection (0–5). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  primaryBenchmarkIndex?: number;
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

  /** Override tier-based benchmark auto-selection (0–5). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  primaryBenchmarkIndex?: number;
}

export class CreateCalibratedPlayerDto {
  @ValidateNested()
  @Type(() => CalibrationPlayerInfoDto)
  player!: CalibrationPlayerInfoDto;

  @ValidateNested()
  @Type(() => LegacyMatchMetricsDto)
  metrics!: LegacyMatchMetricsDto;

  /** Override tier-based benchmark auto-selection (0–5). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  primaryBenchmarkIndex?: number;
}

/** @deprecated use LegacyMatchMetricsDto in new requests */
export { CalibrationMetricsDto };
