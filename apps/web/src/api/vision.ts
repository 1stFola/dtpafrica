import { adminFetch } from "./admin";

/**
 * Vision Engine API client.
 *
 * Phase 0 exposes one read-only endpoint. Ingestion, jobs and review arrive in
 * Phase 1 — see docs/vision/07-API-CONTRACTS.md.
 */

export type VisionResourceClass = "cpu_small" | "gpu_24gb" | "gpu_48gb" | "gpu_80gb";

export type VisionProviderCapabilities = {
  providerId: string;
  resourceClasses: VisionResourceClass[];
  maxConcurrentWorkers: number;
  /** False for providers that may only run throwaway experiments. */
  productionApproved: boolean;
};

export type VisionStatus = {
  phase: string;
  enabled: boolean;
  contractVersion: string;
  storage: {
    backend: string;
    buckets: Record<string, string | null>;
    /** Whether credentials are present — never the credentials themselves. */
    credentialsConfigured: boolean;
  };
  upload: {
    partBytes: number;
    sessionTtlHours: number;
    partUrlTtlSeconds: number;
  };
  playback: { urlTtlSeconds: number };
  jobs: {
    heartbeatIntervalSeconds: number;
    missedHeartbeatsBeforeExpiry: number;
    workerTokenTtlHours: number;
    defaultBudgetSeconds: number;
    defaultBudgetUsdCents: number;
  };
  compute: {
    defaultProvider: string;
    workerImage: string;
    monthlyBudgetUsdCents: number;
    providers: VisionProviderCapabilities[];
  };
  policy: {
    takedownUnpublishImmediate: boolean;
    takedownDeleteWithinDays: number;
    dataSubjectAckWithinDays: number;
    dataSubjectCompleteWithinDays: number;
    derivedMediaRetentionMonths: number;
  };
};

export function fetchVisionStatus() {
  return adminFetch<VisionStatus>("/vision/status");
}

// ── Partner source catalog ──────────────────────────────────────────────────

export type VisionRightsDecision =
  | { allowed: true; scopeId: string; grantLevel: string; expiresAt: string | null }
  | { allowed: false; reason: string; detail: string; remediation: string };

export type VisionScopeKey =
  | "canAnalyze"
  | "canTrain"
  | "canPublishHighlight"
  | "canShareWithScout";

export type VisionPartner = {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  isActive: boolean;
  _count: { videoRecords: number; evidence: number; signatories: number };
};

export type VisionSourceRow = {
  id: string;
  title: string | null;
  url: string | null;
  sourceQualityRank: string;
  acquisitionStatus: string;
  acquisitionMethod: string | null;
  rightsOwnerName: string | null;
  originalAvailable: boolean;
  createdAt: string;
  partner: { id: string; name: string };
  sbMatch: { id: string; slug: string | null } | null;
  sbCompetition: { id: string; name: string } | null;
  _count: { videoAssets: number };
};

export type VisionRightsScopeRow = {
  id: string;
  grantLevel: string;
  canAnalyze: boolean;
  canTrain: boolean;
  canPublishHighlight: boolean;
  canShareWithScout: boolean;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
};

export type VisionEvidenceRow = {
  id: string;
  kind: string;
  objectKey: string;
  documentDate: string | null;
  createdAt: string;
};

export type VisionSignatoryRow = {
  id: string;
  name: string;
  role: string;
  activeFrom: string;
  activeTo: string | null;
};

export type VisionSourceDetail = {
  source: VisionSourceRow & {
    notes: string | null;
    acquisitionAuthorizedAt: string | null;
    partner: VisionPartner & {
      evidence: VisionEvidenceRow[];
      signatories: VisionSignatoryRow[];
      rightsScopes: VisionRightsScopeRow[];
    };
    rightsScopes: VisionRightsScopeRow[];
    authorizedBy: VisionSignatoryRow | null;
    videoAssets: {
      id: string;
      ingestState: string;
      ingestError: string | null;
      durationMs: number | null;
      videoCodec: string | null;
      duplicateClusterId: string | null;
      createdAt: string;
    }[];
    uploadGrants: {
      id: string;
      expiresAt: string;
      usedAt: string | null;
      revokedAt: string | null;
      createdAt: string;
    }[];
  };
  decisions: Record<VisionScopeKey, VisionRightsDecision>;
  preference: number | null;
};

export function fetchVisionPartners() {
  return adminFetch<{ partners: VisionPartner[] }>("/vision/partners");
}

export function fetchVisionSources(filters: {
  partnerId?: string;
  acquisitionStatus?: string;
  q?: string;
}) {
  const params = new URLSearchParams();
  if (filters.partnerId) params.set("partnerId", filters.partnerId);
  if (filters.acquisitionStatus) params.set("acquisitionStatus", filters.acquisitionStatus);
  if (filters.q) params.set("q", filters.q);
  const query = params.toString();
  return adminFetch<{ sources: VisionSourceRow[] }>(`/vision/sources${query ? `?${query}` : ""}`);
}

export function fetchVisionSource(id: string) {
  return adminFetch<VisionSourceDetail>(`/vision/sources/${id}`);
}

export function fetchVisionSourceImpact(id: string) {
  return adminFetch<{
    assets: number;
    variants: number;
    jobs: number;
    duplicateClusters: number;
    datasetVersions: { id: string; label: string; frozen: boolean }[];
    liveScopes: number;
    note: string;
  }>(`/vision/sources/${id}/impact`);
}

export function grantVisionScope(body: Partial<Record<VisionScopeKey, boolean>> & {
  partnerId?: string;
  sourceVideoRecordId?: string;
  evidenceId?: string;
  expiresAt?: string;
}) {
  return adminFetch<VisionRightsScopeRow>("/vision/rights/scopes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function revokeVisionScope(scopeId: string, reason: string) {
  return adminFetch<VisionRightsScopeRow>(`/vision/rights/scopes/${scopeId}/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function authorizeVisionAcquisition(
  sourceId: string,
  body: { acquisitionMethod: string; signatoryId: string }
) {
  return adminFetch<VisionSourceRow>(`/vision/sources/${sourceId}/authorize-acquisition`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function issueVisionUploadGrant(
  sourceId: string,
  body: { expiresInHours?: number } = {}
) {
  return adminFetch<{
    grantId: string;
    /** Shown once. Only the hash is stored server-side. */
    token: string;
    expiresAt: string;
    maxBytes: number;
    allowedMimeTypes: string[];
  }>(`/vision/sources/${sourceId}/upload-grant`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
