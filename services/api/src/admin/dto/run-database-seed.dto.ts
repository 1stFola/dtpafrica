import { IsIn, IsOptional } from "class-validator";

/**
 * `mode` is retained only so existing clients that still post
 * `{ "mode": "incremental" }` keep validating under the global whitelist pipe.
 * "full" is deliberately not accepted: a request for a destructive seed is
 * rejected with 400 rather than silently downgraded.
 */
export class RunDatabaseSeedDto {
  @IsOptional()
  @IsIn(["incremental"])
  mode?: "incremental";
}
