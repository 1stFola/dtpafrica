import { IsObject } from "class-validator";

export class PatchAdsConfigDto {
  @IsObject()
  slots!: Record<string, unknown>;
}
