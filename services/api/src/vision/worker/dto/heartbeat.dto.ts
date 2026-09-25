import { IsObject, IsOptional } from "class-validator";

export class HeartbeatDto {
  @IsOptional()
  @IsObject()
  progress?: Record<string, unknown>;
}
