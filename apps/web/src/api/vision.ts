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
