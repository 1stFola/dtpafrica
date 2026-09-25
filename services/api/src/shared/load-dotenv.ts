import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

/**
 * Loads the API's `.env` files into `process.env`.
 *
 * Both candidate paths are tried so the same call works whether the process was
 * started from the repo root (`pnpm dev:api`) or from `services/api`
 * (`pnpm --filter @dtp/api …`).
 *
 * Standalone scripts must call this explicitly. Anything that constructs a
 * `PrismaClient` appears to work without it, because Prisma loads `.env` itself
 * as a side effect — which is a trap: a script that only reads plain
 * configuration silently sees an empty environment.
 */
export function loadApiEnv(cwd = process.cwd()): string[] {
  const loaded: string[] = [];
  for (const envPath of [join(cwd, ".env"), join(cwd, "services/api/.env")]) {
    if (existsSync(envPath)) {
      loadEnvFile(envPath);
      loaded.push(envPath);
    }
  }
  return loaded;
}
