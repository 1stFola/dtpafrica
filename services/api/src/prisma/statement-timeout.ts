/**
 * A ceiling on any one SQL statement the running API sends.
 *
 * Without one, a query that goes wrong (a missing index, a lock queue, a runaway join)
 * runs until it finishes, holding a pooled connection and the t3.small's CPU, which
 * Postgres shares with the API and the site. Postgres cancels a statement over
 * `statement_timeout`; Prisma surfaces that as an error on that one request.
 *
 * Applied to the API's own client only (PrismaService), through the connection string's
 * `options` parameter, which Postgres reads at connection start, so every pooled
 * connection gets it. The migrations (`prisma migrate deploy`, which reads DATABASE_URL
 * itself), the seed and repair scripts, and the gates all build their own clients and are
 * not limited: a migration may legitimately rewrite a large table.
 *
 * A minute, by default: far beyond any query a page makes, and above the slowest admin
 * import, which runs as many statements inside one transaction (that has its own limit).
 * DATABASE_STATEMENT_TIMEOUT_MS overrides; 0 turns it off.
 */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 60_000;

export function statementTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DATABASE_STATEMENT_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_STATEMENT_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`DATABASE_STATEMENT_TIMEOUT_MS must be a whole number of milliseconds (0 disables), got "${raw}"`);
  }
  return value;
}

/**
 * The connection string with `-c statement_timeout=<ms>` in its `options`. Anything
 * already in `options` is kept; a statement_timeout already there wins, since someone set
 * it on purpose. Undefined in, undefined out: Prisma then reads DATABASE_URL as before.
 */
export function withStatementTimeout(url: string | undefined, timeoutMs: number): string | undefined {
  if (!url || timeoutMs === 0) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not something URL can read; leave it for Prisma to report in its own words.
    return url;
  }
  const existing = parsed.searchParams.get("options") ?? "";
  if (/statement_timeout/.test(existing)) return url;
  const options = [existing.trim(), `-c statement_timeout=${timeoutMs}`].filter(Boolean).join(" ");
  parsed.searchParams.set("options", options);
  return parsed.toString();
}

/** What PrismaService connects with. */
export function apiDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return withStatementTimeout(env.DATABASE_URL, statementTimeoutMs(env));
}
