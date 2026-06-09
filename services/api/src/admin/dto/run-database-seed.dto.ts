import { IsIn, IsOptional } from "class-validator";

export class RunDatabaseSeedDto {
  @IsOptional()
  @IsIn(["incremental", "full"])
  mode?: "incremental" | "full";
}
