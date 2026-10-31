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
/** A state change on a versioned incident: the Edge refuses it (409) if someone else got there first. */
export const transition = <T>(path: string, version: number, body?: unknown) =>
  call<T>("POST", path, body ?? {}, { "If-Match": String(version) });
/** A create the Edge makes at most once per key, so a retried or doubled request makes one record. */
export const createOnce = <T>(path: string, body: unknown, key: string = newKey()) =>
  call<T>("POST", path, body, { "Idempotency-Key": key });

/** 32 random hex characters. getRandomValues works on any origin; randomUUID needs a secure one. */
export function newKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** POST that answers with a file (the export package): saved through a temporary link. */
export async function download(path: string): Promise<string> {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "X-FairPlay-Request": "1" } });
  if (!response.ok) {
    let parsed: Refusal | null = null;
    try {
      parsed = (await response.json()) as Refusal;
    } catch {
      parsed = null;
    }
    throw new ApiError(response.status, parsed);
  }
  const name = /filename="?([^";]+)"?/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "evidence.zip";
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return response.headers.get("x-package-sha256") ?? "";
}

// ── shapes the console reads ───────────────────────────────────────────────

export type AuthStatus = {
  bundleLoaded: boolean;
  dev: boolean | null;
  expiresUtc: string | null;
  /** In outline only (F19): none installed, expired, or not valid. */
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

/** The kernel's answer, read by the Edge (timesync.py): synced, drifting, unsynced or unknown. */
export type ClockSync = { state: string; maxErrorMs: number | null; estErrorMs: number | null; source: string; boundMs?: number;
  settling?: boolean; forSeconds?: number };

export type ClockState = {
  edgeUtc: string;
  ntpState: string;
  sync?: ClockSync | null;
  recentSteps: { edge_utc: string; step_ms: number }[];
  cloudOffsetMs: number | null;
};

export type Health = {
  status: "ok" | "degraded" | "critical" | "starting";
  device: string;
  mediaServer: { up: boolean | null; error: string | null };
  disk: { freeBytes: number; state: string; minutesToHardLimit: number | null; minutesToFull: number | null };
  clock: ClockState;
  cloud: OutboxStatus;
  audit: { seq: number; entry_hash: string; at_utc: string } | null;
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

export type IncidentState = "flagged" | "reviewing" | "reviewed" | "archived";

export type Incident = {
  id: string;
  session_id: string;
  match_id: string | null;
  event_utc: string;
  basis: string;
  pre_roll_ms: number;
  post_roll_ms: number;
  category: string;
  note: string | null;
  period: string | null;
  match_minute: number | null;
  match_second: number | null;
  sheet_event_id: string | null;
  player_ref: string | null;
  state: IncidentState;
  version: number;
  current_review_id: string | null;
  reopened_count: number;
  created_by: string;
  created_utc: string;
};

export const RESULTS = ["supports_original", "supports_alternative", "inconclusive", "footage_unavailable"] as const;
export type Result = (typeof RESULTS)[number];

export type Review = {
  id: string;
  incident_version: number;
  reviewer_name: string;
  state: "open" | "completed" | "superseded";
  authority_mode: "shadow";
  on_field_decision: string | null;
  result: Result | null;
  factual_notes: string | null;
  evidence_ids: string[] | null;
  footage_states: Record<string, string> | null;
  started_utc: string;
  completed_at: string | null;
  superseded_reason: string | null;
};

export type Job = {
  id: string;
  source: string;
  state: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  error_code: string | null;
  error: string | null;
  evidence_id: string | null;
  window_start_utc: string;
  window_duration_ms: number;
  requested_name: string;
  created_utc: string;
};

export type Evidence = {
  id: string;
  source: string;
  state: "ready" | "approved";
  footage_kind: "synthetic" | "real";
  coverage: "full" | "partial";
  covered_ms: number;
  duration_ms: number | null;
  window_duration_ms: number;
  sha256: string;
  manifest_sha256: string;
  bytes: number;
  source_segment_ids: string[];
  approved_name: string | null;
  created_utc: string;
  release?: { allowed: boolean; reason: string };
};

export type Rights = {
  id: string | null;
  footage_kind: "synthetic" | "real";
  status: "not_recorded" | "internal_review_only" | "external_release_permitted";
  minors_present: "yes" | "no" | "unknown";
  basis: string | null;
  consent_reference: string | null;
  recorded_name: string | null;
  created_utc: string | null;
};

export type IncidentDetail = Incident & { reviews: Review[]; evidence: Evidence[]; jobs: Job[]; rights: Rights };

export type AuditEntry = {
  seq: number;
  at_utc: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  detail: Record<string, unknown>;
  entry_hash: string;
};

export type OutboxStatus = {
  configured: boolean;
  pending: number;
  sent: number;
  parked: number;
  oldestPendingUtc: string | null;
  lastError: string | null;
  note: string | null;
};

export type ReportSession = { id: string; label: string; match_ref: string | null; mode: string };

export type Report = {
  session: ReportSession;
  authorityMode: "shadow";
  note: string;
  incidents: {
    incidentId: string;
    period: string | null;
    matchMinute: number | null;
    matchSecond: number | null;
    category: string;
    finding: { result: Result; factual_notes: string; on_field_decision: string | null; completed_at: string; reviewer_name: string } | null;
    evidence: { id: string; source: string; sha256: string; bytes: number; duration_ms: number; coverage: string; footage_kind: string }[];
  }[];
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
