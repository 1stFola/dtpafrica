import { describe, expect, it } from "vitest";
import { assertJwtSecrets, jwtSecret, jwtSecretProblem } from "./jwt-secrets";

const ADMIN = "a".repeat(64);
const ACADEMY = "b".repeat(64);
const API_KEY = "operator-api-key-that-is-also-quite-long-0123456789";

const prod = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: "production",
  ADMIN_API_KEY: API_KEY,
  ADMIN_JWT_SECRET: ADMIN,
  ACADEMY_JWT_SECRET: ACADEMY,
  ...extra,
});

describe("in production", () => {
  it("uses the dedicated secrets when they are sound", () => {
    expect(jwtSecret("ADMIN_JWT_SECRET", prod())).toBe(ADMIN);
    expect(jwtSecret("ACADEMY_JWT_SECRET", prod())).toBe(ACADEMY);
    expect(() => assertJwtSecrets(prod())).not.toThrow();
  });

  it("refuses to fall back to ADMIN_API_KEY or a built-in string when a secret is unset", () => {
    const env = prod({ ADMIN_JWT_SECRET: undefined });
    expect(() => jwtSecret("ADMIN_JWT_SECRET", env)).toThrow(/ADMIN_JWT_SECRET is not set/);
    expect(() => jwtSecret("ACADEMY_JWT_SECRET", prod({ ACADEMY_JWT_SECRET: "  " }))).toThrow(
      /ACADEMY_JWT_SECRET is not set/
    );
  });

  it("refuses a short secret", () => {
    expect(jwtSecretProblem("ADMIN_JWT_SECRET", prod({ ADMIN_JWT_SECRET: "change-me-admin-jwt-secret" }))).toMatch(
      /shorter than 32/
    );
  });

  it("refuses a secret that is the operator API key", () => {
    expect(jwtSecretProblem("ADMIN_JWT_SECRET", prod({ ADMIN_JWT_SECRET: API_KEY }))).toMatch(/same as ADMIN_API_KEY/);
  });

  it("refuses one key for both kinds of session", () => {
    expect(jwtSecretProblem("ACADEMY_JWT_SECRET", prod({ ACADEMY_JWT_SECRET: ADMIN }))).toMatch(
      /same as ADMIN_JWT_SECRET/
    );
  });

  it("names every problem at start-up, not just the first", () => {
    const env = prod({ ADMIN_JWT_SECRET: undefined, ACADEMY_JWT_SECRET: undefined });
    expect(() => assertJwtSecrets(env)).toThrow(/ADMIN_JWT_SECRET is not set.*ACADEMY_JWT_SECRET is not set/);
  });
});

describe("outside production", () => {
  it("uses the variable when set", () => {
    expect(jwtSecret("ADMIN_JWT_SECRET", { NODE_ENV: "development", ADMIN_JWT_SECRET: "short" })).toBe("short");
  });

  it("falls back to a development value, never to ADMIN_API_KEY", () => {
    const env = { NODE_ENV: "test", ADMIN_API_KEY: API_KEY };
    expect(jwtSecret("ADMIN_JWT_SECRET", env)).not.toBe(API_KEY);
    expect(jwtSecret("ACADEMY_JWT_SECRET", env)).not.toBe(API_KEY);
    expect(jwtSecret("ADMIN_JWT_SECRET", env)).not.toBe(jwtSecret("ACADEMY_JWT_SECRET", env));
    expect(() => assertJwtSecrets(env)).not.toThrow();
  });
});
