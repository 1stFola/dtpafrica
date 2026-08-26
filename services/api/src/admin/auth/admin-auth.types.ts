export type AdminAuthMethod = "api_key" | "jwt";

export type AdminAuthContext = {
  method: AdminAuthMethod;
  roleSlug: string | null;
  roleName: string | null;
  permissions: string[];
  userId?: string;
  email?: string;
  displayName?: string;
  /**
   * Competitions a contracted match recorder may work in.
   *
   * Empty means unscoped — every internal role, and any recorder granted all
   * competitions. `scopedCompetitions` below is what callers should test, since
   * it distinguishes "no restriction" from "restricted to these".
   */
  competitionIds?: string[];
  competitionNames?: string[];
};

/**
 * The competitions this account is limited to, or null for no limit.
 *
 * One helper so every call site asks the question the same way: a null result
 * means see everything, and a list means see only these.
 */
export function scopedCompetitions(ctx: AdminAuthContext): string[] | null {
  if (ctx.method === "api_key") return null;
  const ids = ctx.competitionIds ?? [];
  return ids.length ? ids : null;
}

/** Prisma `where` fragment restricting a field to the account's competitions. */
export function competitionScopeWhere(
  ctx: AdminAuthContext,
  field = "competitionId"
): Record<string, unknown> {
  const ids = scopedCompetitions(ctx);
  return ids ? { [field]: { in: ids } } : {};
}

/** Whether this account may touch a given competition at all. */
export function canAccessCompetition(ctx: AdminAuthContext, competitionId: string): boolean {
  const ids = scopedCompetitions(ctx);
  return !ids || ids.includes(competitionId);
}

export function hasPermission(ctx: AdminAuthContext, slug: string): boolean {
  if (ctx.method === "api_key") return true;
  return ctx.permissions.includes(slug);
}

export function hasAnyPermission(ctx: AdminAuthContext, slugs: string[]): boolean {
  if (ctx.method === "api_key") return true;
  if (slugs.length === 0) return true;
  return slugs.some((slug) => ctx.permissions.includes(slug));
}
