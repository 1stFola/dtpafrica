export type AdminAuthMethod = "api_key" | "jwt";

export type AdminAuthContext = {
  method: AdminAuthMethod;
  roleSlug: string | null;
  roleName: string | null;
  permissions: string[];
  userId?: string;
  email?: string;
  displayName?: string;
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
