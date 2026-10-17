import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  apiDatabaseUrl,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  statementTimeoutMs,
  withStatementTimeout,
} from "./statement-timeout";

const BASE = "postgresql://dtp:p%40ss@postgres:5432/dtp_africa";

describe("statementTimeoutMs", () => {
  it("is a minute unless set", () => {
    expect(DEFAULT_STATEMENT_TIMEOUT_MS).toBe(60_000);
    expect(statementTimeoutMs({})).toBe(60_000);
    expect(statementTimeoutMs({ DATABASE_STATEMENT_TIMEOUT_MS: " " })).toBe(60_000);
    expect(statementTimeoutMs({ DATABASE_STATEMENT_TIMEOUT_MS: "15000" })).toBe(15_000);
    expect(statementTimeoutMs({ DATABASE_STATEMENT_TIMEOUT_MS: "0" })).toBe(0);
  });

  it("refuses a value that is not whole milliseconds rather than guessing", () => {
    for (const bad of ["30s", "-1", "1.5"]) {
      expect(() => statementTimeoutMs({ DATABASE_STATEMENT_TIMEOUT_MS: bad })).toThrow(/whole number/);
    }
  });
});

describe("withStatementTimeout", () => {
  const options = (url: string | undefined) => new URL(url!).searchParams.get("options");

  it("adds the setting to the connection's startup options, keeping the credentials intact", () => {
    const url = withStatementTimeout(BASE, 60_000)!;
    expect(options(url)).toBe("-c statement_timeout=60000");
    const parsed = new URL(url);
    expect(decodeURIComponent(parsed.password)).toBe("p@ss");
    expect(parsed.pathname).toBe("/dtp_africa");
  });

  it("keeps other query parameters and other options", () => {
    const url = withStatementTimeout(`${BASE}?schema=public&options=-c%20search_path%3Dpublic`, 5000)!;
    expect(new URL(url).searchParams.get("schema")).toBe("public");
    expect(options(url)).toBe("-c search_path=public -c statement_timeout=5000");
  });

  it("leaves a statement_timeout someone already set", () => {
    const url = `${BASE}?options=-c%20statement_timeout%3D1000`;
    expect(withStatementTimeout(url, 60_000)).toBe(url);
  });

  it("changes nothing when disabled or when there is no URL", () => {
    expect(withStatementTimeout(BASE, 0)).toBe(BASE);
    expect(withStatementTimeout(undefined, 60_000)).toBeUndefined();
    expect(apiDatabaseUrl({})).toBeUndefined();
  });
});

/**
 * Against a real Postgres, given TEST_DATABASE_URL: CI's schema-migrations job sets it,
 * and locally `TEST_DATABASE_URL=<dev url> pnpm exec vitest run src/prisma`. Proves the
 * engine passes `options` through: Prisma documents few URL parameters, and one it
 * ignored would leave the whole setting a silent no-op.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!TEST_DATABASE_URL)("against Postgres", () => {
  it("cancels a statement that runs past the ceiling", async () => {
    const client = new PrismaClient({ datasourceUrl: withStatementTimeout(TEST_DATABASE_URL, 300) });
    try {
      const [row] = await client.$queryRawUnsafe<Array<{ statement_timeout: string }>>("SHOW statement_timeout");
      expect(row?.statement_timeout).toBe("300ms");
      await expect(client.$executeRawUnsafe("SELECT pg_sleep(2)")).rejects.toThrow(/statement timeout/);
    } finally {
      await client.$disconnect();
    }
  });
});
