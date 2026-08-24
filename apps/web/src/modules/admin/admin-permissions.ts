export type AdminSession = {
  ok: boolean;
  method: "api_key" | "jwt";
  roleSlug: string | null;
  roleName: string | null;
  permissions: string[];
  userId?: string;
  email?: string;
  displayName?: string;
  /** Set when the account is scoped to a single competition. */
  competitionId?: string | null;
  competitionName?: string | null;
};

/**
 * Where an account lands after login. Contracted recorders have no dashboard
 * permission, so sending them to /admin would show them an empty shell.
 */
export function adminLandingPath(session: {
  method: AdminSession["method"];
  permissions: string[];
}): string {
  if (session.method === "api_key") return "/admin";
  if (session.permissions.includes("admin.stats.read")) return "/admin";
  if (
    session.permissions.includes("scoreboard.stats.record") ||
    session.permissions.includes("scoreboard.stats.approve")
  ) {
    return "/admin/match-stats";
  }
  return "/admin";
}

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
  /** Set only for competition-scoped roles (contracted match recorders). */
  competitionId?: string | null;
  competitionName?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

/** Nav/route permission requirements for admin UI */
export const ADMIN_NAV_PERMISSIONS: Record<string, string | string[] | undefined> = {
  "/admin": "admin.stats.read",
  "/admin/inbox": "inbox.read",
  "/admin/players": "players.read",
  /* Fixtures had no entry, so it was visible to everyone — including contracted
     recorders, who should only ever see their own match sheets. */
  "/admin/fixtures": "scoreboard.read",
  "/admin/match-stats": ["scoreboard.stats.record", "scoreboard.stats.approve"],
  "/admin/training": ["scoreboard.stats.record", "scoreboard.stats.approve"],
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
