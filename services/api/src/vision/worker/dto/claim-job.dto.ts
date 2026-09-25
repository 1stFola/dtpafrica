import { IsArray, IsIn, IsOptional, IsString } from "class-validator";
import { VISION_RESOURCE_CLASSES, type VisionResourceClass } from "@dtp/vision-contracts";

export class ClaimJobDto {
  /** Omitted means "whatever I was registered for". */
  @IsOptional()
  @IsArray()
  @IsIn(VISION_RESOURCE_CLASSES as unknown as string[], { each: true })
  resourceClasses?: VisionResourceClass[];

  /** Sent so a worker running an incompatible image fails fast and loudly. */
  @IsOptional()
  @IsString()
  contractVersion?: string;
}
