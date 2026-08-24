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
   * Set for contracted match recorders scoped to a single competition. Null or
   * absent means unscoped, which is how every internal role behaves.
   */
  competitionId?: string | null;
  competitionName?: string | null;
};

export function hasPermission(ctx: AdminAuthContext, slug: string): boolean {
  if (ctx.method === "api_key") return true;
  return ctx.permissions.includes(slug);
}

export function hasAnyPermission(ctx: AdminAuthContext, slugs: string[]): boolean {
  if (ctx.method === "api_key") return true;
  if (slugs.length === 0) return true;
  return slugs.some((slug) => ctx.permissions.includes(slug));
}
