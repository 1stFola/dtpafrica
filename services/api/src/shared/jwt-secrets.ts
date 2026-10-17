/**
 * The secrets admin and academy sessions are signed with.
 *
 * Each used to fall back to `ADMIN_API_KEY` and then to a string in this repository, and
 * staging set neither, so its session tokens were signed with a value anyone reading the code
 * could use to mint a super-admin token. In production each must now be its own value: set,
 * long enough to be a key rather than a password, and shared with neither the operator API key
 * nor the other session type. The API refuses to start otherwise (`assertJwtSecrets`, called
 * from main.ts) rather than signing with something weak.
 *
 * Outside production a fixed development value is still used when the variable is unset, so a
 * fresh checkout and the tests run without configuration.
 */

export type JwtSecretName = "ADMIN_JWT_SECRET" | "ACADEMY_JWT_SECRET";

export const MIN_JWT_SECRET_LENGTH = 32;

const DEV_FALLBACK: Record<JwtSecretName, string> = {
  ADMIN_JWT_SECRET: "dtp-dev-admin-jwt-not-for-production",
  ACADEMY_JWT_SECRET: "dtp-dev-academy-jwt-not-for-production",
};

const OTHER: Record<JwtSecretName, JwtSecretName> = {
  ADMIN_JWT_SECRET: "ACADEMY_JWT_SECRET",
  ACADEMY_JWT_SECRET: "ADMIN_JWT_SECRET",
};

const isProduction = (env: NodeJS.ProcessEnv) => env.NODE_ENV?.trim() === "production";

/** Why this secret cannot be used, or null when it can. */
export function jwtSecretProblem(name: JwtSecretName, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!isProduction(env)) return null;
  const value = env[name]?.trim();
  if (!value) return `${name} is not set. Production signs sessions with it and has no fallback.`;
  if (value.length < MIN_JWT_SECRET_LENGTH) {
    return `${name} is shorter than ${MIN_JWT_SECRET_LENGTH} characters. Generate one with \`openssl rand -hex 32\`.`;
  }
  if (value === env.ADMIN_API_KEY?.trim()) {
    return `${name} is the same as ADMIN_API_KEY. A session signing key must be its own value.`;
  }
  if (value === env[OTHER[name]]?.trim()) {
    return `${name} is the same as ${OTHER[name]}. Admin and academy sessions must not share a key.`;
  }
  return null;
}

export function jwtSecret(name: JwtSecretName, env: NodeJS.ProcessEnv = process.env): string {
  const problem = jwtSecretProblem(name, env);
  if (problem) throw new Error(problem);
  return env[name]?.trim() || DEV_FALLBACK[name];
}

/** Fails start-up with every problem at once, so one deploy shows all that needs fixing. */
export function assertJwtSecrets(env: NodeJS.ProcessEnv = process.env): void {
  const problems = (Object.keys(DEV_FALLBACK) as JwtSecretName[])
    .map((name) => jwtSecretProblem(name, env))
    .filter((problem): problem is string => problem !== null);
  if (problems.length) {
    throw new Error(`Refusing to start: ${problems.join(" ")}`);
  }
}
