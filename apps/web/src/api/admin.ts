const STORAGE_KEY = "dtp_admin_api_key";

export function getAdminApiKey(): string | null {
  return sessionStorage.getItem(STORAGE_KEY);
}

export function setAdminApiKey(key: string) {
  sessionStorage.setItem(STORAGE_KEY, key);
}

export function clearAdminApiKey() {
  sessionStorage.removeItem(STORAGE_KEY);
}

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
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-admin-api-key": key } : {}),
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
  return adminFetch<{ ok: boolean }>("/admin/session");
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
  slug: string | null;
  isFeatured: boolean;
  isPublic: boolean;
  registrationStatus: string;
  nationality: string | null;
  age: number | null;
  overallRating: number | null;
  offensiveRating: number | null;
  defensiveRating: number | null;
  updatedAt: string;
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
  ball_touches?: number;
  total_distance?: number;
  sprint_distance?: number;
  accelerations?: number;
  decelerations?: number;
  top_speed?: number;
  sprints?: number;
  intense_turns?: number;
  avg_turn_entry?: number;
  avg_turn_exit?: number;
  left_turns?: number;
  right_turns?: number;
  back_turns?: number;
  kicking_power?: number;
  distance_with_ball?: number;
  top_speed_with_ball?: number;
  intense_turns_with_ball?: number;
};

export type CalibrationPlayerInfo = {
  fullName: string;
  gender?: string;
  dateOfBirth?: string;
  position: string;
  benchmarkRegion?: string;
  benchmarkAgeBand?: string;
  nationality?: string;
  heightFt?: string;
  weightKg?: number;
  currentClub?: string;
  photoUrl?: string;
  videoUrl?: string;
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
  nearestBenchmark: Record<string, unknown>;
  alternativeBenchmarks: Record<string, unknown>[];
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
  city: string | null;
  country: string | null;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminAcademyInput = {
  name: string;
  slug?: string;
  city?: string;
  country?: string;
  description?: string;
  logoUrl?: string;
  websiteUrl?: string;
  isPublished?: boolean;
};

export const adminApi = {
  stats: () => adminFetch<AdminStats>("/admin/stats"),
  players: (q?: string, status?: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    const qs = params.toString();
    return adminFetch<AdminPlayerRow[]>(`/admin/players${qs ? `?${qs}` : ""}`);
  },
  updatePlayer: (id: string, body: Partial<AdminPlayerRow>) =>
    adminFetch(`/admin/players/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
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
  academyList: () => adminFetch<AdminAcademy[]>("/admin/academies"),
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
  calibrationContext: (playerId: string) =>
    adminFetch<CalibrationContext>(`/admin/calibration/players/${playerId}`),
  calibrationPreview: (body: {
    playerId?: string;
    player: CalibrationPlayerInfo;
    metrics: LegacyMatchMetrics;
  }) =>
    adminFetch<CalibrationRunResult>("/admin/calibration/preview", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createCalibratedPlayer: (body: {
    player: CalibrationPlayerInfo;
    metrics: LegacyMatchMetrics;
  }) =>
    adminFetch<CalibrationRunResult & { player: { id: string; slug: string | null; displayName: string } }>(
      "/admin/calibration/players",
      { method: "POST", body: JSON.stringify(body) }
    ),
  calibratePlayer: (
    id: string,
    body?: { player?: CalibrationPlayerInfo; metrics?: LegacyMatchMetrics; save?: boolean }
  ) =>
    adminFetch<CalibrationRunResult>(`/admin/players/${id}/calibrate`, {
      method: "POST",
      body: JSON.stringify(body ?? { save: true }),
    }),
};
