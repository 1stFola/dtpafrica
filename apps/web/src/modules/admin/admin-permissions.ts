export type AdminSession = {
  ok: boolean;
  method: "api_key" | "jwt";
  roleSlug: string | null;
  roleName: string | null;
  permissions: string[];
  userId?: string;
  email?: string;
  displayName?: string;
};

export type AdminPermission = {
  slug: string;
  resource: string;
  action: string;
  description: string;
};

export type AdminRole = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  userCount: number;
  permissions: string[];
};

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  roleSlug: string | null;
  roleName: string | null;
  createdAt?: string;
  updatedAt?: string;
};

/** Nav/route permission requirements for admin UI */
export const ADMIN_NAV_PERMISSIONS: Record<string, string | string[] | undefined> = {
  "/admin": "admin.stats.read",
  "/admin/inbox": "inbox.read",
  "/admin/players": "players.read",
  "/admin/calibration": ["calibration.run", "players.calibrate"],
  "/admin/homepage": "homepage.write",
  "/admin/ads": "ads.write",
  "/admin/academies": "academies.read",
  "/admin/content": "content.read",
  "/admin/database": "database.seed",
  "/admin/ops-support": "ops.support.read",
  "/admin/blog": "blog.read",
  "/admin/scoreboard": "scoreboard.read",
  "/admin/settings/roles": "admin.roles.manage",
  "/admin/settings/users": "admin.users.manage",
};

export function canAccessNav(
  permissions: string[],
  method: AdminSession["method"],
  required?: string | string[]
): boolean {
  if (method === "api_key") return true;
  if (!required) return true;
  const slugs = Array.isArray(required) ? required : [required];
  return slugs.some((s) => permissions.includes(s));
}
