import { cachedFetch, invalidateCachePrefix } from "./fetch-cache";

const STORAGE_KEY = "dtp_admin_api_key";
const TOKEN_STORAGE_KEY = "dtp_admin_jwt";

const ADMIN_PLAYERS_CACHE_TTL_MS = 45_000;
const ADMIN_ACADEMIES_CACHE_TTL_MS = 120_000;

function playersQueryKey(query: AdminPlayerListQuery): string {
  const params = new URLSearchParams();
  if (query.id) params.set("id", query.id);
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.academyId) params.set("academyId", query.academyId);
  if (query.position) params.set("position", query.position);
  if (query.featured) params.set("featured", query.featured);
  if (query.hasMedia) params.set("hasMedia", query.hasMedia);
  if (query.sort) params.set("sort", query.sort);
  if (query.sortDir) params.set("sortDir", query.sortDir);
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));
  return params.toString();
}

function invalidateAdminPlayersCache() {
  invalidateCachePrefix("admin:players:");
}

export function getAdminApiKey(): string | null {
  return sessionStorage.getItem(STORAGE_KEY);
}

export function setAdminApiKey(key: string) {
  sessionStorage.setItem(STORAGE_KEY, key);
}

export function clearAdminApiKey() {
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getAdminJwt(): string | null {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setAdminJwt(token: string) {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
  sessionStorage.removeItem(STORAGE_KEY);
}

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

export class AdminApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function adminFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const key = getAdminApiKey();
  const jwt = getAdminJwt();
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-admin-api-key": key } : {}),
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new AdminApiError(text || res.statusText, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function verifyAdminSession() {
  return adminFetch<AdminSession>("/admin/auth/session");
}

export function adminLoginWithPassword(email: string, password: string) {
  return adminFetch<{ token: string; session: AdminSession }>("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export type AdminStats = {
  players: number;
  pendingRegistrations: number;
  featuredPlayers: number;
  publicProfiles: number;
  blogDrafts: number;
  blogPublished: number;
  contactUnread: number;
  contactArchived: number;
  academyPublished: number;
};

export type AdminPlayerRow = {
  id: string;
  displayName: string;
  positionPrimary: string;
  positionFull: string | null;
  playingPhilosophies: string[] | null;
  slug: string | null;
  isFeatured: boolean;
  isPublic: boolean;
  registrationStatus: string;
  nationality: string | null;
  age: number | null;
  overallRating: number | null;
  offensiveRating: number | null;
  defensiveRating: number | null;
  academyId: string | null;
  videoUrl: string | null;
  playerPhotoUrl: string | null;
  academy: { id: string; name: string; slug: string } | null;
  updatedAt: string;
  createdAt: string;
};

export type AdminPlayerListQuery = {
  id?: string;
  q?: string;
  status?: string;
  academyId?: string;
  position?: string;
  featured?: "true" | "false" | "";
  hasMedia?: "video" | "photo" | "any" | "none" | "";
  sort?: "name" | "date" | "rating";
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export type AdminPlayerListPage = {
  items: AdminPlayerRow[];
  total: number;
  offset: number;
  limit: number;
};

export type BulkPlayerUpdates = {
  academyId?: string | null;
  isFeatured?: boolean;
  positionPrimary?: string;
};

export type PlayerQuickEditContext = {
  id: string;
  displayName: string;
  slug: string;
  heightCm: number | null;
  preferredFoot: string | null;
  positionPrimary: string;
  estimatedPlayerValue: string | null;
  videoUrls: string[];
  photoUrls: string[];
  publicationUrls: string[];
  updatedAt?: string;
};

export type PlayerQuickEditInput = {
  heightCm: string;
  preferredFoot: string;
  positionPrimary: string;
  estimatedPlayerValue: string;
  videoUrls: string[];
  photoUrls: string[];
  publicationUrls: string[];
};

export type CalibrationMetrics = {
  minutesPlayed: number;
  ballTouches: number;
  totalDistanceMiles: number;
  sprintDistanceYards: number;
  firstStepAccelerations: number;
  intenseAccelerations: number;
  kickingPowerMph?: number | null;
  topSpeedMph?: number | null;
  sprints: number;
  intenseTurns: number;
  avgTurnEntrySpeedMph?: number | null;
  avgTurnExitSpeedMph?: number | null;
  leftTurns: number;
  rightTurns: number;
  backTurns: number;
  distanceWithBallYards: number;
  topSpeedWithBallMph?: number | null;
  intenseTurnsWithBall: number;
};

export type LegacyMatchMetrics = {
  duration?: number;
  total_distance?: number;
  sprint_distance?: number;
  sprints?: number;
  top_speed?: number;
  first_step_accelerations?: number;
  intense_accelerations?: number;
  intense_turns?: number;
  avg_turn_entry?: number;
  avg_turn_exit?: number;
  turn_efficiency?: number;
  left_turns?: number;
  right_turns?: number;
  back_turns?: number;
  ball_touches?: number;
  possession_duration_seconds?: number;
  one_touch_possessions_percentage?: number;
  multi_touch_possessions__percentage?: number;
  quick_release_score?: number;
  distance_with_ball?: number;
  top_speed_with_ball?: number;
  intense_turns_with_ball?: number;
  kicking_power?: number;
  release_inside_foot_percentage?: number;
  release_laces_percentage?: number;
  release_other_footzone_percentage?: number;
  left_foot_touch_percentage?: number;
  left_foot_release_percentage?: number;
  left_foot_receive_percentage?: number;
  left_foot_kicking_power_mph?: number;
  right_foot_touch_percentage?: number;
  right_foot_release_percentage?: number;
  right_foot_receive_percentage?: number;
  right_foot_kicking_power_mph?: number;
};

export type CalibrationPlayerInfo = {
  fullName: string;
  gender?: string;
  dateOfBirth?: string;
  position: string;
  preferredFoot?: string;
  benchmarkRegion?: string;
  benchmarkAgeBand?: string;
  nationality?: string;
  heightFt?: string;
  weightKg?: number;
  currentClub?: string;
  photoUrl?: string;
  videoUrl?: string;
};

export type CalibrationBenchmarkProfile = {
  full_name?: string;
  archetype?: string;
  development_stage?: string;
  age?: number;
  overall_rating?: number;
  __similarity?: number;
  pace?: number;
  passing?: number;
  dribbling?: number;
  finishing?: number;
  offensive_score?: number;
  defensive_score?: number;
  [key: string]: unknown;
};

export type CalibrationContext = {
  player: CalibrationPlayerInfo & {
    id: string;
    overallRating: number | null;
    offensiveRating: number | null;
    defensiveRating: number | null;
  };
  metrics: LegacyMatchMetrics | null;
};

export type CalibrationRunResult = {
  playerId: string | null;
  displayName: string;
  positionPrimary: string;
  saved: boolean;
  meta: Record<string, unknown>;
  raw: Record<string, number>;
  calibrated: Record<string, number>;
  rawSummary: { offensive_score: number; defensive_score: number; overall_rating: number };
  calibratedSummary: {
    offensive_score: number;
    defensive_score: number;
    overall_rating: number;
  };
  nearestBenchmark: CalibrationBenchmarkProfile;
  alternativeBenchmarks: CalibrationBenchmarkProfile[];
  rankedCandidates: CalibrationBenchmarkProfile[];
  primaryBenchmarkIndex: number;
  filterInfo: { poolSize: number };
};

export type AdminBlogPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  coverImageUrl: string | null;
  isPublished: boolean;
  publishedAt: string;
  updatedAt: string;
};

export type AdminStaticContent = {
  key: string;
  value: string;
  updatedAt: string;
};

export type AdminAdBannerFormat = "leaderboard" | "square" | "mobile-banner" | "inline";

import type { AdSlotKey } from "../config/adConfig";

export type AdminAdSlotKey = AdSlotKey;

export type AdminAdSlotConfig = {
  enabled: boolean;
  slotId: string;
  format: AdminAdBannerFormat;
  fallbackImageUrl: string;
  destinationUrl: string;
  label?: string;
  placementNotes?: string;
};

export type AdminAdsConfig = {
  slots: Record<AdminAdSlotKey, AdminAdSlotConfig>;
  updatedAt: string | null;
};

export type AdminContactMessage = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string | null;
  message: string;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type AdminAcademy = {
  id: string;
  slug: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  subscriptionTier: "Premium" | "Basic" | null;
  maxPlayers: number | null;
  loginUsername: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminSeedPhaseError = {
  phase: string;
  message: string;
};

export type AdminSeedResult = {
  ok: boolean;
  mode: "incremental" | "full";
  durationMs: number;
  seedPlayerId: string;
  counts: {
    players: number;
    academies: number;
    competitions: number;
    blogPosts: number;
    legacyPlayers: number;
    legacyAcademies: number;
    legacyAcademyLinks: number;
    staticContentKeys: number;
  };
  legacySampleSlugs: string[];
  errors: AdminSeedPhaseError[];
  completedAt: string;
};

export type AdminSeedStatus = {
  running: boolean;
  startedAt: string | null;
  lastRun: AdminSeedResult | null;
};

export type SupportPlaybookEntry = {
  key: string;
  title: string;
  category: string;
  tier: "tier_1_known" | "tier_2_assisted" | "tier_3_human";
  severity: "low" | "medium" | "high" | "critical";
  symptoms: string[];
  diagnostics: string[];
  recommendation: string;
  playbookPath: string;
};

export type SupportReport = {
  id: string;
  audience: string;
  reporterName: string | null;
  reporterEmail: string | null;
  category: string;
  severity: string;
  status: string;
  subject: string;
  description: string;
  pageUrl: string | null;
  recommendationKey: string | null;
  recommendation: SupportPlaybookEntry | null;
  adminNotes: string | null;
  resolutionSummary: string | null;
  playbookOutcome: "not_reviewed" | "confirmed" | "updated" | "new_entry_needed";
  playbookProposal: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type SupportTriagePacket = {
  report: SupportReport;
  generatedAt: string;
  mode: "recommend_only";
  recommendedTier: SupportPlaybookEntry["tier"];
  escalationRequired: boolean;
  likelyCause: string;
  evidence: Array<{
    label: string;
    value: string | number;
    status: "ok" | "warning" | "critical";
  }>;
  diagnosticChecklist: string[];
  recommendedActions: string[];
  similarReports: SupportReport[];
  humanApprovalRequiredFor: string[];
  learningLoopPrompt: string;
};

export type SupportDiagnostics = {
  generatedAt: string;
  supportMode: "recommend_only";
  signals: Array<{
    key: string;
    label: string;
    value: string | number;
    status: "ok" | "warning" | "critical";
    recommendation: string;
  }>;
  recentReports: SupportReport[];
  playbook: SupportPlaybookEntry[];
};

export type SupportReviewQueue = {
  generatedAt: string;
  mode: "recommend_only";
  learningQueue: SupportReport[];
  repeatedPatterns: Array<{
    category: string;
    recommendationKey: string | null;
    recommendation: SupportPlaybookEntry | null;
    total: number;
    openCount: number;
    criticalCount: number;
    latestAt: string;
    suggestedReview: string;
  }>;
  routingRules: Array<{
    category: string;
    owner: string;
    escalation: string;
    humanApprovalRequiredFor: string[];
  }>;
};

export type SupportSummary = {
  ready: boolean;
  open: number;
  critical: number;
  latestCreatedAt: string | null;
  setupRequired?: string;
};

export type CreateSupportReportInput = {
  audience?: string;
  reporterName?: string;
  reporterEmail?: string;
  category: string;
  severity?: string;
  subject: string;
  description: string;
  pageUrl?: string;
};

export async function createSupportReport(body: CreateSupportReportInput) {
  const res = await fetch("/api/v1/support/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new AdminApiError(text || res.statusText, res.status);
  }
  return res.json() as Promise<{
    ok: boolean;
    report: SupportReport;
    recommendation: SupportPlaybookEntry;
  }>;
}

export type AdminAcademyInput = {
  name: string;
  slug?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  city?: string;
  country?: string;
  description?: string;
  logoUrl?: string;
  websiteUrl?: string;
  subscriptionTier?: "Premium" | "Basic" | "";
  maxPlayers?: number | "";
  isPublished?: boolean;
  loginUsername?: string;
  /** Plain text; hashed server-side. Leave blank on edit to keep existing password. */
  password?: string;
};

export const adminApi = {
  stats: () => adminFetch<AdminStats>("/admin/stats"),
  players: (query: AdminPlayerListQuery = {}) => {
    const qs = playersQueryKey(query);
    return cachedFetch(
      `admin:players:${qs}`,
      ADMIN_PLAYERS_CACHE_TTL_MS,
      () => adminFetch<AdminPlayerListPage>(`/admin/players${qs ? `?${qs}` : ""}`)
    );
  },
  bulkUpdatePlayers: (ids: string[], updates: BulkPlayerUpdates) =>
    adminFetch<{ updated: number; ids: string[] }>("/admin/players/bulk", {
      method: "PATCH",
      body: JSON.stringify({ ids, updates }),
    }).then((result) => {
      invalidateAdminPlayersCache();
      return result;
    }),
  previewPlayerSlug: (name: string, excludeId?: string) => {
    const params = new URLSearchParams({ name });
    if (excludeId) params.set("excludeId", excludeId);
    return adminFetch<{ slug: string; available: boolean }>(
      `/admin/players/slug-preview?${params.toString()}`
    );
  },
  updatePlayer: (
    id: string,
    body: Partial<AdminPlayerRow> & {
      displayName?: string;
      playingPhilosophies?: string[];
    }
  ) =>
    adminFetch(`/admin/players/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then((result) => {
      invalidateAdminPlayersCache();
      return result;
    }),
  getPlayerQuickEdit: (id: string) =>
    adminFetch<PlayerQuickEditContext>(`/admin/players/${id}/quick-edit`),
  quickEditPlayer: (
    id: string,
    body: {
      heightCm?: number;
      preferredFoot?: string;
      positionPrimary?: string;
      estimatedPlayerValue?: string;
      videoUrls?: string[];
      photoUrls?: string[];
      publicationUrls?: string[];
    }
  ) =>
    adminFetch<PlayerQuickEditContext>(`/admin/players/${id}/quick-edit`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then((result) => {
      invalidateAdminPlayersCache();
      return result;
    }),
  inbox: (status?: string, q?: string) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    const qs = params.toString();
    return adminFetch<AdminContactMessage[]>(`/admin/inbox${qs ? `?${qs}` : ""}`);
  },
  inboxGet: (id: string) =>
    adminFetch<AdminContactMessage>(`/admin/inbox/${id}`),
  inboxRead: (id: string, read: boolean) =>
    adminFetch<AdminContactMessage>(`/admin/inbox/${id}/read`, {
      method: "PATCH",
      body: JSON.stringify({ read }),
    }),
  inboxArchive: (id: string, archived: boolean) =>
    adminFetch<AdminContactMessage>(`/admin/inbox/${id}/archive`, {
      method: "PATCH",
      body: JSON.stringify({ archived }),
    }),
  inboxDelete: (id: string) =>
    adminFetch(`/admin/inbox/${id}`, { method: "DELETE" }),
  academyList: () =>
    cachedFetch("admin:academies", ADMIN_ACADEMIES_CACHE_TTL_MS, () =>
      adminFetch<AdminAcademy[]>("/admin/academies")
    ),
  academyGet: (id: string) =>
    adminFetch<AdminAcademy>(`/admin/academies/${id}`),
  academyCreate: (body: AdminAcademyInput) =>
    adminFetch<AdminAcademy>("/admin/academies", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  academyUpdate: (id: string, body: AdminAcademyInput) =>
    adminFetch<AdminAcademy>(`/admin/academies/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  academyDelete: (id: string) =>
    adminFetch(`/admin/academies/${id}`, { method: "DELETE" }),
  blogList: () => adminFetch<AdminBlogPost[]>("/admin/blog"),
  blogGet: (id: string) => adminFetch<AdminBlogPost>(`/admin/blog/${id}`),
  blogCreate: (body: {
    title: string;
    slug?: string;
    excerpt?: string;
    body: string;
    isPublished?: boolean;
  }) =>
    adminFetch<AdminBlogPost>("/admin/blog", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  blogUpdate: (
    id: string,
    body: {
      title: string;
      slug?: string;
      excerpt?: string;
      body: string;
      isPublished?: boolean;
    }
  ) =>
    adminFetch<AdminBlogPost>(`/admin/blog/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  blogPublish: (id: string, isPublished: boolean) =>
    adminFetch(`/admin/blog/${id}/publish`, {
      method: "PATCH",
      body: JSON.stringify({ isPublished }),
    }),
  blogDelete: (id: string) =>
    adminFetch(`/admin/blog/${id}`, { method: "DELETE" }),
  contentList: () => adminFetch<AdminStaticContent[]>("/admin/content"),
  contentUpsert: (key: string, value: string) =>
    adminFetch<AdminStaticContent>(`/admin/content/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
  adsGet: () => adminFetch<AdminAdsConfig>("/admin/ads"),
  adsPatch: (slots: Record<AdminAdSlotKey, AdminAdSlotConfig>) =>
    adminFetch<AdminAdsConfig>("/admin/ads", {
      method: "PATCH",
      body: JSON.stringify({ slots }),
    }),
  calibrationContext: (playerId: string) =>
    adminFetch<CalibrationContext>(`/admin/calibration/players/${playerId}`),
  calibrationPreview: (body: {
    playerId?: string;
    player: CalibrationPlayerInfo;
    metrics: LegacyMatchMetrics;
    primaryBenchmarkIndex?: number;
  }) =>
    adminFetch<CalibrationRunResult>("/admin/calibration/preview", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createCalibratedPlayer: (body: {
    player: CalibrationPlayerInfo;
    metrics: LegacyMatchMetrics;
    primaryBenchmarkIndex?: number;
  }) =>
    adminFetch<CalibrationRunResult & { player: { id: string; slug: string | null; displayName: string } }>(
      "/admin/calibration/players",
      { method: "POST", body: JSON.stringify(body) }
    ).then((result) => {
      invalidateAdminPlayersCache();
      return result;
    }),
  calibratePlayer: (
    id: string,
    body?: {
      player?: CalibrationPlayerInfo;
      metrics?: LegacyMatchMetrics;
      save?: boolean;
      primaryBenchmarkIndex?: number;
    }
  ) =>
    adminFetch<CalibrationRunResult>(`/admin/players/${id}/calibrate`, {
      method: "POST",
      body: JSON.stringify(body ?? { save: true }),
    }).then((result) => {
      invalidateAdminPlayersCache();
      return result;
    }),
  databaseSeedStatus: () =>
    adminFetch<AdminSeedStatus>("/admin/database/seed/status"),
  runDatabaseSeed: (mode: "incremental" | "full" = "incremental") =>
    adminFetch<AdminSeedResult>("/admin/database/seed", {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
  supportDiagnostics: () => adminFetch<SupportDiagnostics>("/admin/support/diagnostics"),
  supportSummary: () => adminFetch<SupportSummary>("/admin/support/summary"),
  supportReviewQueue: () => adminFetch<SupportReviewQueue>("/admin/support/review"),
  supportReports: (
    query: { status?: string; category?: string; q?: string; limit?: number } = {}
  ) => {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.category) params.set("category", query.category);
    if (query.q) params.set("q", query.q);
    if (query.limit != null) params.set("limit", String(query.limit));
    const qs = params.toString();
    return adminFetch<SupportReport[]>(`/admin/support/reports${qs ? `?${qs}` : ""}`);
  },
  updateSupportReport: (
    id: string,
    body: {
      status?: string;
      adminNotes?: string;
      resolutionSummary?: string;
      playbookOutcome?: SupportReport["playbookOutcome"];
      playbookProposal?: string;
    }
  ) =>
    adminFetch<SupportReport>(`/admin/support/reports/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  supportReportTriage: (id: string) =>
    adminFetch<SupportTriagePacket>(`/admin/support/reports/${id}/triage`),
  rbacPermissions: () => adminFetch<AdminPermission[]>("/admin/rbac/permissions"),
  rbacRoles: () => adminFetch<AdminRole[]>("/admin/rbac/roles"),
  rbacRole: (slug: string) => adminFetch<AdminRole>(`/admin/rbac/roles/${slug}`),
  rbacUpdateRolePermissions: (slug: string, permissions: string[]) =>
    adminFetch<AdminRole>(`/admin/rbac/roles/${slug}/permissions`, {
      method: "PATCH",
      body: JSON.stringify({ permissions }),
    }),
  rbacUsers: () => adminFetch<AdminUser[]>("/admin/rbac/users"),
  rbacCreateUser: (body: {
    email: string;
    name?: string;
    password: string;
    roleSlug: string;
  }) =>
    adminFetch<AdminUser>("/admin/rbac/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  rbacUpdateUser: (
    id: string,
    body: {
      email?: string;
      name?: string;
      password?: string;
      roleSlug?: string;
      isActive?: boolean;
    }
  ) =>
    adminFetch<AdminUser>(`/admin/rbac/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
