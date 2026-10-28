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
  { slug: "scoreboard.fixtures.read", resource: "scoreboard", action: "fixtures.read", description: "View admin fixtures calendar" },
  { slug: "scoreboard.matches.write", resource: "scoreboard", action: "matches.write", description: "Manage fixtures, scores, rosters, and match events" },
  { slug: "scoreboard.competitions.write", resource: "scoreboard", action: "competitions.write", description: "Create competitions from templates and manage competition setup" },
  { slug: "scoreboard.records.manage", resource: "scoreboard_records", action: "manage", description: "Manage master records: competitions, teams, squad directory, name QA, and seed imports" },
  { slug: "scoreboard.highlights.write", resource: "scoreboard", action: "highlights.write", description: "Manage highlights" },
  { slug: "scoreboard.live.write", resource: "scoreboard", action: "live.write", description: "Manage live streams on the Live Games page" },
  { slug: "scoreboard.stats.record", resource: "scoreboard", action: "stats.record", description: "Record live match statistics pitch-side" },
  { slug: "scoreboard.stats.approve", resource: "scoreboard", action: "stats.approve", description: "Approve or send back submitted match statistics" },
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
  // —— Vision Engine (docs/vision/) ——
  { slug: "vision.read", resource: "vision", action: "read", description: "View Vision sources, assets, jobs and evidence" },
  { slug: "vision.sources.write", resource: "vision", action: "sources.write", description: "Register and edit partner source records" },
  { slug: "vision.rights.manage", resource: "vision", action: "rights.manage", description: "Attach rights evidence, grant and revoke scopes, authorize acquisition" },
  { slug: "vision.assets.upload", resource: "vision", action: "assets.upload", description: "Initiate and finalize footage uploads" },
  { slug: "vision.jobs.run", resource: "vision", action: "jobs.run", description: "Queue, retry and cancel Vision jobs" },
  { slug: "vision.annotate", resource: "vision", action: "annotate", description: "Label frames, tracks, identities and events" },
  { slug: "vision.review", resource: "vision", action: "review", description: "Approve, reject and correct Vision predictions" },
  { slug: "vision.datasets.manage", resource: "vision", action: "datasets.manage", description: "Build, split and freeze dataset versions" },
  { slug: "vision.models.train", resource: "vision", action: "models.train", description: "Train and benchmark models, request promotion" },
  { slug: "vision.models.promote", resource: "vision", action: "models.promote", description: "Promote or roll back a model version" },
  { slug: "vision.publish", resource: "vision", action: "publish", description: "Publish approved evidence, clips and events" },
  { slug: "vision.media.raw.read", resource: "vision", action: "media.raw.read", description: "Access raw source footage, including youth footage" },
  { slug: "vision.evidence.search", resource: "vision", action: "evidence.search", description: "Search approved evidence" },
  { slug: "vision.audit.read", resource: "vision", action: "audit.read", description: "Read the Vision audit trail: who did what, including who read raw footage" },
  // —— FairPlay shadow review (docs/fairplay/) ——
  { slug: "fairplay.session.manage", resource: "fairplay", action: "session.manage", description: "Provision FairPlay sessions for a match and choose who may act at the venue" },
  { slug: "fairplay.edge.admin", resource: "fairplay", action: "edge.admin", description: "Register, pair and retire FairPlay Edge devices" },
  { slug: "fairplay.incident.operate", resource: "fairplay", action: "incident.operate", description: "Flag incidents, mark calibrations and request clips at the venue" },
  { slug: "fairplay.incident.review", resource: "fairplay", action: "incident.review", description: "Record shadow-review findings at the venue and read them here" },
  { slug: "fairplay.evidence.view_original", resource: "fairplay", action: "evidence.view_original", description: "Watch original venue recordings (venue only; every viewing is audited)" },
  { slug: "fairplay.evidence.export", resource: "fairplay", action: "evidence.export", description: "Approve and export FairPlay evidence, and read it here" },
  { slug: "fairplay.report.view", resource: "fairplay", action: "report.view", description: "Read FairPlay reports and released evidence for assigned competitions" },
];

/**
 * Vision Engine roles. Two omissions are deliberate:
 *
 *   - `vision_ml_engineer` does NOT get `vision.models.promote`. Promotion needs
 *     a second pair of eyes — the requester holds `models.train`, the approver
 *     holds `models.promote`, and they may not be the same account.
 *   - `vision_annotator` does NOT get `vision.media.raw.read`. Annotators work
 *     from sampled frames and assigned clips, never the raw youth-footage
 *     corpus.
 *
 * See docs/vision/04-DATA-MODEL.md and docs/vision/10-EVALUATION-AND-GATES.md.
 */
export const VISION_PERMISSION_SLUGS = ADMIN_PERMISSIONS.filter((p) =>
  p.slug.startsWith("vision.")
).map((p) => p.slug);

export const VISION_ADMIN_PERMISSION_SLUGS = [
  "admin.session.read",
  "admin.stats.read",
  ...VISION_PERMISSION_SLUGS,
];

export const VISION_ANNOTATOR_PERMISSION_SLUGS = [
  "admin.session.read",
  "vision.read",
  "vision.annotate",
];

export const VISION_REVIEWER_PERMISSION_SLUGS = [
  "admin.session.read",
  "vision.read",
  "vision.review",
  "vision.publish",
  "vision.media.raw.read",
];

export const VISION_ML_ENGINEER_PERMISSION_SLUGS = [
  "admin.session.read",
  "vision.read",
  "vision.jobs.run",
  "vision.datasets.manage",
  "vision.models.train",
];

export const VISION_SCOUT_READONLY_PERMISSION_SLUGS = [
  "admin.session.read",
  "vision.evidence.search",
];

/**
 * FairPlay roles. Nobody holds one until an admin assigns it (decisions.md D3).
 *
 *   - `fairplay_organiser_viewer` holds `fairplay.report.view` and nothing else, and must
 *     be scoped to named competitions: an organiser account with no competitions is
 *     refused, not treated as unscoped (fairplay/access.ts, decisions.md D4).
 *   - Nothing FairPlay grants a ScoreBoard permission: findings stay out of the recorder
 *     console and the official record (ADR-0001, ADR-0010).
 */
export const FAIRPLAY_PERMISSION_SLUGS = ADMIN_PERMISSIONS.filter((p) =>
  p.slug.startsWith("fairplay.")
).map((p) => p.slug);

export const FAIRPLAY_ADMIN_PERMISSION_SLUGS = ["admin.session.read", ...FAIRPLAY_PERMISSION_SLUGS];

export const FAIRPLAY_ASSESSOR_PERMISSION_SLUGS = [
  "admin.session.read",
  "fairplay.incident.operate",
  "fairplay.incident.review",
];

export const FAIRPLAY_OPERATOR_PERMISSION_SLUGS = [
  "admin.session.read",
  "fairplay.incident.operate",
];

export const FAIRPLAY_ORGANISER_VIEWER_PERMISSION_SLUGS = [
  "admin.session.read",
  "fairplay.report.view",
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
  "scoreboard.fixtures.read",
  "scoreboard.matches.write",
  "scoreboard.competitions.write",
  "scoreboard.highlights.write",
  "scoreboard.live.write",
  "scoreboard.stats.record",
  "scoreboard.stats.approve",
  "ops.support.read",
];

export const SCOREBOARD_RECORDS_MANAGER_PERMISSION_SLUGS = [
  "admin.session.read",
  "admin.stats.read",
  "players.read",
  "players.write",
  "scoreboard.read",
  "scoreboard.fixtures.read",
  "scoreboard.records.manage",
  "scoreboard.competitions.write",
  "ops.support.read",
];

/**
 * Contracted pitch-side staff: a stats sheet and nothing else.
 *
 * Deliberately without `scoreboard.read` and `admin.stats.read` — those unlock
 * Dashboard, Fixtures and ScoreBoard Operations, which are internal views.
 * The console reads its own fixture list through the match-stats endpoints,
 * scoped to the competition the recorder is assigned to.
 */
export const MATCH_RECORDER_PERMISSION_SLUGS = [
  "admin.session.read",
  "scoreboard.stats.record",
];

/** Match officials / supervisors: review and sign off, but do not tally. */
export const MATCH_SUPERVISOR_PERMISSION_SLUGS = [
  "admin.session.read",
  "scoreboard.stats.approve",
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
    description: "Run fixtures, rosters, scores, stats review, and highlights",
    permissionSlugs: SCOREBOARD_OPS_PERMISSION_SLUGS,
  },
  {
    slug: "scoreboard_records_manager",
    name: "ScoreBoard Records Manager",
    description: "Maintain master competitions, teams, squad records, name QA, and seed imports",
    permissionSlugs: SCOREBOARD_RECORDS_MANAGER_PERMISSION_SLUGS,
  },
  {
    slug: "calibration_editor",
    name: "Calibration Editor",
    description: "Run calibration and create calibrated players",
    permissionSlugs: CALIBRATION_EDITOR_PERMISSION_SLUGS,
  },
  {
    slug: "match_recorder",
    name: "Match Recorder",
    description: "Record live match statistics pitch-side and submit them for approval",
    permissionSlugs: MATCH_RECORDER_PERMISSION_SLUGS,
  },
  {
    slug: "match_supervisor",
    name: "Match Supervisor",
    description: "Review submitted match statistics, then approve or send them back",
    permissionSlugs: MATCH_SUPERVISOR_PERMISSION_SLUGS,
  },
  {
    slug: "read_only",
    name: "Read Only",
    description: "View admin data without making changes",
    permissionSlugs: READ_ONLY_PERMISSION_SLUGS,
  },
  {
    slug: "vision_admin",
    name: "Vision Admin",
    description: "Configure Vision sources, rights, jobs, models and publication policy",
    permissionSlugs: VISION_ADMIN_PERMISSION_SLUGS,
  },
  {
    slug: "vision_annotator",
    name: "Vision Annotator",
    description: "Label frames, tracks, identities and events; cannot publish or promote",
    permissionSlugs: VISION_ANNOTATOR_PERMISSION_SLUGS,
  },
  {
    slug: "vision_reviewer",
    name: "Vision Reviewer",
    description: "Approve or reject Vision evidence and publish what passes review",
    permissionSlugs: VISION_REVIEWER_PERMISSION_SLUGS,
  },
  {
    slug: "vision_ml_engineer",
    name: "Vision ML Engineer",
    description: "Build datasets, train and benchmark models, request promotion",
    permissionSlugs: VISION_ML_ENGINEER_PERMISSION_SLUGS,
  },
  {
    slug: "vision_scout_readonly",
    name: "Vision Scout (read only)",
    description: "Search approved Vision evidence; no raw footage or training data",
    permissionSlugs: VISION_SCOUT_READONLY_PERMISSION_SLUGS,
  },
  {
    slug: "fairplay_admin",
    name: "FairPlay Admin",
    description: "Pair Edge devices, provision shadow-review sessions, read findings and evidence",
    permissionSlugs: FAIRPLAY_ADMIN_PERMISSION_SLUGS,
  },
  {
    slug: "fairplay_assessor",
    name: "FairPlay Assessor",
    description: "Flag incidents and record shadow-review findings at the venue",
    permissionSlugs: FAIRPLAY_ASSESSOR_PERMISSION_SLUGS,
  },
  {
    slug: "fairplay_operator",
    name: "FairPlay Operator",
    description: "Flag incidents and mark calibrations at the venue; no findings",
    permissionSlugs: FAIRPLAY_OPERATOR_PERMISSION_SLUGS,
  },
  {
    slug: "fairplay_organiser_viewer",
    name: "FairPlay Organiser (view only)",
    description: "Read FairPlay reports and released evidence for assigned competitions only",
    permissionSlugs: FAIRPLAY_ORGANISER_VIEWER_PERMISSION_SLUGS,
  },
];
