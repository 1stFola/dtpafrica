import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Min } from "class-validator";
import {
  VISION_JOB_TYPES,
  VISION_RESOURCE_CLASSES,
  type VisionJobType,
  type VisionResourceClass,
} from "@dtp/vision-contracts";

export class EnqueueJobDto {
  @IsIn(VISION_JOB_TYPES as unknown as string[])
  type!: VisionJobType;

  @IsUUID()
  videoAssetId!: string;

  /** Overrides the default class for this job type. Rarely needed. */
  @IsOptional()
  @IsIn(VISION_RESOURCE_CLASSES as unknown as string[])
  resourceClass?: VisionResourceClass;

  @IsOptional()
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(60)
  budgetSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  budgetUsdCents?: number;
}

export class CancelJobDto {
  @IsString()
  reason!: string;
}

export class ProvisionWorkerDto {
  @IsIn(VISION_RESOURCE_CLASSES as unknown as string[])
  resourceClass!: VisionResourceClass;

  /** Defaults to the configured provider. */
  @IsOptional()
  @IsString()
  providerId?: string;
}
