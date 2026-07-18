export type PermissionDef = {
  slug: string;
  resource: string;
  action: string;
  description: string;
};

/** Canonical admin permission slugs — keep in sync with seed-rbac.ts */
export const ADMIN_PERMISSIONS: PermissionDef[] = [
  { slug: "admin.session.read", resource: "admin", action: "session.read", description: "Verify admin session" },
  { slug: "admin.stats.read", resource: "admin", action: "stats.read", description: "View dashboard stats" },
  { slug: "admin.roles.manage", resource: "admin", action: "roles.manage", description: "Manage roles and permissions" },
  { slug: "admin.users.manage", resource: "admin", action: "users.manage", description: "Manage admin users" },
  { slug: "players.read", resource: "players", action: "read", description: "View players" },
  { slug: "players.write", resource: "players", action: "write", description: "Edit players" },
  { slug: "players.calibrate", resource: "players", action: "calibrate", description: "Run player calibration" },
  { slug: "calibration.run", resource: "calibration", action: "run", description: "Preview calibration runs" },
  { slug: "calibration.create", resource: "calibration", action: "create", description: "Create players from calibration" },
  { slug: "scoreboard.read", resource: "scoreboard", action: "read", description: "View scoreboard data" },
  { slug: "scoreboard.matches.write", resource: "scoreboard", action: "matches.write", description: "Manage matches and events" },
  { slug: "scoreboard.competitions.write", resource: "scoreboard", action: "competitions.write", description: "Manage competitions and teams" },
  { slug: "scoreboard.highlights.write", resource: "scoreboard", action: "highlights.write", description: "Manage highlights" },
  { slug: "content.read", resource: "content", action: "read", description: "View static content" },
  { slug: "content.write", resource: "content", action: "write", description: "Edit static content" },
  { slug: "blog.read", resource: "blog", action: "read", description: "View blog posts" },
  { slug: "blog.write", resource: "blog", action: "write", description: "Manage blog posts" },
  { slug: "homepage.write", resource: "homepage", action: "write", description: "Edit homepage settings" },
  { slug: "ads.write", resource: "ads", action: "write", description: "Manage ad slots" },
  { slug: "academies.read", resource: "academies", action: "read", description: "View academies" },
  { slug: "academies.write", resource: "academies", action: "write", description: "Manage academies" },
  { slug: "inbox.read", resource: "inbox", action: "read", description: "View contact inbox" },
  { slug: "inbox.write", resource: "inbox", action: "write", description: "Manage contact messages" },
  { slug: "database.seed", resource: "database", action: "seed", description: "Run database seed" },
  { slug: "ops.support.read", resource: "ops_support", action: "read", description: "View support diagnostics and reports" },
  { slug: "ops.support.write", resource: "ops_support", action: "write", description: "Triage support reports" },
];

export const ALL_PERMISSION_SLUGS = ADMIN_PERMISSIONS.map((p) => p.slug);

export const READ_ONLY_PERMISSION_SLUGS = ADMIN_PERMISSIONS.filter(
  (p) => p.action === "read" || p.slug === "admin.session.read"
).map((p) => p.slug);

export const SCOREBOARD_OPS_PERMISSION_SLUGS = [
  "admin.session.read",
  "admin.stats.read",
  "players.read",
  "scoreboard.read",
  "scoreboard.matches.write",
  "scoreboard.competitions.write",
  "scoreboard.highlights.write",
  "ops.support.read",
];

export const CALIBRATION_EDITOR_PERMISSION_SLUGS = [
  "admin.session.read",
  "admin.stats.read",
  "players.read",
  "players.calibrate",
  "calibration.run",
  "calibration.create",
  "ops.support.read",
];

export type DefaultRoleDef = {
  slug: string;
  name: string;
  description: string;
  permissionSlugs: string[] | "all";
};

export const DEFAULT_ROLES: DefaultRoleDef[] = [
  {
    slug: "super_admin",
    name: "Super Admin",
    description: "Full access to all admin features",
    permissionSlugs: "all",
  },
  {
    slug: "scoreboard_ops",
    name: "Scoreboard Ops",
    description: "Manage competitions, matches, and highlights",
    permissionSlugs: SCOREBOARD_OPS_PERMISSION_SLUGS,
  },
  {
    slug: "calibration_editor",
    name: "Calibration Editor",
    description: "Run calibration and create calibrated players",
    permissionSlugs: CALIBRATION_EDITOR_PERMISSION_SLUGS,
  },
  {
    slug: "read_only",
    name: "Read Only",
    description: "View admin data without making changes",
    permissionSlugs: READ_ONLY_PERMISSION_SLUGS,
  },
];
