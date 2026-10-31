import { adminFetch } from "./admin";

/**
 * FairPlay's cloud routes (services/api/src/fairplay/). The API decides who may see what on
 * every request; these screens only decide what to offer, from `GET /fairplay/me`.
 */

export type FairPlayMe = { kind: "staff" | "organiser"; competitions: string[] | null; permissions: string[] };

export type FairPlayDevice = {
  id: string; label: string; edgeDeviceId: string | null; state: "awaiting_pairing" | "paired" | "retired";
  createdAt: string; createdByEmail: string | null; registeredAt: string | null; lastSeenAt: string | null;
  retiredAt: string | null; tokenExpiresAt: string; sessions: number;
};

export type MatchSnapshot = { matchId: string; competition: string; home: string; away: string; kickoffAt: string | null; venue: string | null; roundLabel: string | null };

export type FairPlaySessionRow = {
  id: string; matchId: string | null; competitionId: string; label: string; mode: string; match: MatchSnapshot;
  device: string | null; createdAt: string; lastSyncAt: string | null; endedAt: string | null; incidents: number; evidence: number;
};

export type FairPlayMember = { adminUserId: string; email: string; name: string | null; active: boolean; permissions: string[];
  pinSet: boolean; pinSetAt: string | null; isMe: boolean };

export type FairPlaySession = {
  id: string; matchId: string | null; competitionId: string; label: string; mode: string; angleMode: string; match: MatchSnapshot;
  createdAt: string; edgeCreatedAt: string | null; endedAt: string | null; lastSyncAt: string | null;
  device?: { id: string; label: string; lastSeenAt: string | null; retiredAt: string | null };
  members?: FairPlayMember[];
};

export type FairPlayCandidate = { id: string; email: string; name: string | null; role: string | null; permissions: string[] };

export type FairPlaySyncState = {
  lastSyncAt: string | null; records: Record<string, number>;
  auditChain: { status: "ok" | "break" | "unverified"; entries: number; lastSeq: number | null }[];
  refused: { idempotencyKey: string; status: string; message: string | null; receivedAt: string }[];
};

export type ReportEvidence = {
  id: string; source: string; coverage: string; windowStartUtc: string; windowDurationMs: number; sha256: string; manifestSha256: string;
  footageKind: string; released: boolean; withheldBecause: string | null; stored: string; deleteAfter: string | null; deletedAt: string | null;
};

export type ReportIncident = {
  id: string; category: string; eventUtc: string; period: string | null; matchMinute: number | null; matchSecond: number | null;
  state: string; version: number; note?: string | null; playerRef?: string | null; reopenedCount?: number;
  scoreboardEvent: { id?: string; type?: string; minute?: number; sheetEventId?: string; unresolved?: boolean } | null;
  finding: { result: string | null; statement: string | null; onFieldDecision: string | null; factualNotes: string | null;
    reviewer: string; completedAt: string | null; authorityMode: string } | null;
  evidence: ReportEvidence[];
};

export type FairPlayReport = {
  schema: string; notice: string; generatedAt: string;
  session: { id: string; label: string; mode: string; angleMode: string; match: MatchSnapshot; matchStillExists: boolean;
    edgeCreatedAt: string | null; endedAt: string | null; lastSyncAt: string | null };
  incidents: ReportIncident[];
};

export type FairPlayUsage = {
  backend: string; bucket: string | null; objects: number; bytes: number; deletedObjects: number; withdrawnObjects?: number; retentionDays: number;
  thisMonth: { uploads: number; reads: number; classAOperations: number; classBOperations: number };
  estimatedMonthlyUsd: number; note: string;
};

/** A player's or a parent's request (decisions.md D11). An Edge admin's job. */
export type FairPlayRequestRow = {
  id: string; competitionId: string; playerRef: string; requesterName: string; relationship: string; reference: string | null;
  state: "open" | "completed" | "refused"; outcomeNote: string | null; createdByEmail: string | null; createdAt: string;
  closedAt: string | null; closedByEmail: string | null; withdrawals?: number;
};

export type FairPlayWithdrawal = {
  id: string; evidenceId: string; requestId: string | null; origin: "cloud" | "edge"; reason: string; requester: string;
  clipSha256: string; clipBytes: number; withdrawnBy: string | null; withdrawnAt: string; edgeConfirmedAt: string | null;
};

export type RequestEvidence = {
  id: string; source: string; sha256: string; bytes: number; windowStartUtc: string; windowDurationMs: number; footageKind: string;
  withdrawn: { id: string; at: string; edgeConfirmedAt: string | null } | null; heldOnEdge: string | null;
  inCloud: { kind: string; state: string; deleteAfter: string | null; deletedAt: string | null; deleteReason: string | null }[];
};

export type RequestIncident = {
  id: string; sessionId: string; match: MatchSnapshot; eventUtc: string; period: string | null; matchMinute: number | null;
  matchSecond: number | null; category: string; state: string; playerRef: string; note: string | null;
  finding: { result: string | null; onFieldDecision: string | null; factualNotes: string | null; completedAt: string | null } | null;
  evidence: RequestEvidence[];
};

export type FairPlayRequest = Omit<FairPlayRequestRow, "withdrawals"> & { incidents: RequestIncident[]; withdrawals: FairPlayWithdrawal[] };

export const RELATIONSHIPS: Record<string, string> = {
  player: "The player",
  parent_or_guardian: "Parent or guardian",
  representative: "Representative (club, school, lawyer)",
};

export const VENUE_PERMISSIONS = [
  "fairplay.incident.operate",
  "fairplay.incident.review",
  "fairplay.session.manage",
  "fairplay.edge.admin",
  "fairplay.evidence.view_original",
  "fairplay.evidence.export",
] as const;

export const fairplayApi = {
  me: () => adminFetch<FairPlayMe>("/fairplay/me"),
  devices: () => adminFetch<FairPlayDevice[]>("/fairplay/devices"),
  createDevice: (label: string) =>
    adminFetch<{ id: string; label: string; bootstrapToken: string; bootstrapExpiresAt: string }>("/fairplay/devices", { method: "POST", body: JSON.stringify({ label }) }),
  retireDevice: (id: string) => adminFetch(`/fairplay/devices/${id}/retire`, { method: "POST" }),
  rePairDevice: (id: string, reason: string) =>
    adminFetch<{ id: string; label: string; bootstrapToken: string; bootstrapExpiresAt: string }>(`/fairplay/devices/${id}/re-pair`, { method: "POST", body: JSON.stringify({ reason }) }),
  sessions: (matchId?: string) => adminFetch<FairPlaySessionRow[]>(`/fairplay/sessions${matchId ? `?matchId=${encodeURIComponent(matchId)}` : ""}`),
  session: (id: string) => adminFetch<FairPlaySession>(`/fairplay/sessions/${id}`),
  createSession: (input: { matchId: string; deviceId: string; label?: string; mode?: string; members: { adminUserId: string; permissions: string[] }[] }) =>
    adminFetch<FairPlaySession>("/fairplay/sessions", { method: "POST", body: JSON.stringify(input) }),
  candidates: (matchId: string) => adminFetch<FairPlayCandidate[]>(`/fairplay/member-candidates?matchId=${encodeURIComponent(matchId)}`),
  setMembers: (id: string, members: { adminUserId: string; permissions: string[] }[]) =>
    adminFetch<FairPlaySession>(`/fairplay/sessions/${id}/members`, { method: "PUT", body: JSON.stringify({ members }) }),
  setMyPin: (id: string, pin: string) => adminFetch<{ pinSetAt: string }>(`/fairplay/sessions/${id}/members/me/pin`, { method: "PUT", body: JSON.stringify({ pin }) }),
  syncState: (id: string) => adminFetch<FairPlaySyncState>(`/fairplay/sessions/${id}/sync`),
  report: (id: string) => adminFetch<FairPlayReport>(`/fairplay/sessions/${id}/report`),
  readUrl: (evidenceId: string, kind: "clip" | "manifest", reason?: string) =>
    adminFetch<{ url: string; expiresAt: string; sha256: string; bytes: number }>(`/fairplay/evidence/${evidenceId}/read-url`,
      { method: "POST", body: JSON.stringify({ kind, reason }) }),
  usage: () => adminFetch<FairPlayUsage>("/fairplay/usage"),
  requests: () => adminFetch<FairPlayRequestRow[]>("/fairplay/requests"),
  createRequest: (input: { competitionId: string; playerRef: string; requesterName: string; relationship: string; reference?: string }) =>
    adminFetch<FairPlayRequest>("/fairplay/requests", { method: "POST", body: JSON.stringify(input) }),
  request: (id: string) => adminFetch<FairPlayRequest>(`/fairplay/requests/${id}`),
  held: (id: string) => adminFetch<Record<string, unknown>>(`/fairplay/requests/${id}/held`),
  withdraw: (id: string, evidenceId: string, reason: string) =>
    adminFetch<FairPlayWithdrawal & { objectsRemoved: number }>(`/fairplay/requests/${id}/withdrawals`,
      { method: "POST", body: JSON.stringify({ evidenceId, reason }) }),
  closeRequest: (id: string, outcome: "completed" | "refused", note: string) =>
    adminFetch<FairPlayRequest>(`/fairplay/requests/${id}/close`, { method: "POST", body: JSON.stringify({ outcome, note }) }),
};
