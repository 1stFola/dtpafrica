/*
 * The Edge API, same origin only. The session cookie is HttpOnly, so this code never sees
 * it; every state-changing call adds X-FairPlay-Request, which the Edge requires of cookie
 * requests so that a page on another origin cannot submit one.
 */

export type Refusal = { statusCode: number; error: string; message: string; remediation?: string };

export class ApiError extends Error {
  constructor(public status: number, public body: Refusal | null) {
    super(body?.message ?? `HTTP ${status}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-FairPlay-Request": "1" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let parsed: Refusal | null = null;
    try {
      parsed = (await response.json()) as Refusal;
    } catch {
      parsed = null;
    }
    throw new ApiError(response.status, parsed);
  }
  return (await response.json()) as T;
}

export const get = <T>(path: string) => call<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => call<T>("POST", path, body ?? {});
export const patch = <T>(path: string, body: unknown, version: number) =>
  call<T>("PATCH", path, body, { "If-Match": String(version) });

// ── shapes the console reads ───────────────────────────────────────────────

export type AuthStatus = {
  bundleLoaded: boolean;
  dev: boolean | null;
  expiresUtc: string | null;
  sessionLabel: string | null;
  problem: string | null;
  device: string;
  secure: boolean;
};

export type Me = {
  userId: string;
  email: string | null;
  name: string;
  kind: "operator" | "device";
  permissions: string[];
  devBundle: boolean;
  idleMinutes: number;
};

export type Alert = { id: string; kind: string; source: string | null; severity: "info" | "warning" | "critical"; opened_utc: string };

export type SourceView = {
  name: string;
  label: string;
  role: "ground" | "drone" | "programme";
  required: boolean;
  publishing: boolean | null;
  recording: boolean;
  mediaServerUp: boolean | null;
  codecProps: { codec?: string; width?: number; height?: number }[];
  tracks: string[];
  lastFinalSegment: { id: string; end_utc: string | null; sha256: string | null } | null;
  openAlerts: Alert[];
};

export type ClockState = {
  edgeUtc: string;
  ntpState: string;
  recentSteps: { edge_utc: string; step_ms: number }[];
  cloudOffsetMs: number | null;
};

export type Health = {
  status: "ok" | "degraded" | "critical" | "starting";
  device: string;
  mediaServer: { up: boolean | null; error: string | null };
  disk: { freeBytes: number; state: string };
  clock: ClockState;
  cloud: { connected: boolean; note: string };
  bundle: { loaded: boolean; dev: boolean | null; expiresUtc: string | null };
  openAlerts: Alert[];
};

export type MatchSession = { id: string; label: string; match_ref: string | null; mode: "shadow" | "post_match"; created_utc: string; ended_utc: string | null };

export type PeriodMark = { id: string; period: string; edge: "start" | "end"; edge_utc: string };

export type CalibrationRow = {
  source: string;
  role: string;
  offsetMs: number;
  uncertaintyMs: number;
  flags: string[];
  calibration: { id: string; method: string; created_utc: string; reference_utc: string; observed_ingest_utc: string } | null;
};

export type SessionDetail = MatchSession & { periods: PeriodMark[]; calibration: CalibrationRow[]; clock: ClockState };

export type Incident = {
  id: string;
  session_id: string;
  event_utc: string;
  basis: string;
  pre_roll_ms: number;
  post_roll_ms: number;
  category: string;
  note: string | null;
  state: "flagged";
  version: number;
  created_by: string;
  created_utc: string;
};

export type SourceWindow = {
  source: string;
  startIngestUtc: string;
  durationMs: number;
  eventAtMs: number;
  offsetMs: number;
  uncertaintyMs: number;
  calibrationId: string | null;
  coveredMs: number;
  state: "ok" | "no_footage" | "gap" | "stale_after_reconnect" | "uncalibrated" | "uncertainty_high";
  flags: string[];
  playbackPath: string;
};

export type IncidentWindows = { incidentId: string; eventUtc: string; perSource: SourceWindow[]; clock: ClockState; note: string };

export type SyncTest = { atUtc: string; windows: SourceWindow[]; aligned: boolean; alignmentUncertaintyMs: number | null; statement: string };

export type ReplaySummary = { samples: number; playable: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null };
