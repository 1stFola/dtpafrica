import type { BucketId } from "@dtp/vision-contracts";

/**
 * Vision configuration, validated once at boot.
 *
 * A missing or malformed setting fails startup loudly rather than at the first
 * upload. Credentials come from the existing AWS Secrets Manager path
 * (`dtp/{env}/vision`) — see infra/DEPLOYMENT.md.
 */

export type VisionStorageConfig = {
  backend: "r2" | "memory";
  accountId: string | null;
  endpoint: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  region: string;
  buckets: Record<BucketId, string>;
};

export type VisionConfig = {
  enabled: boolean;
  storage: VisionStorageConfig;
  upload: {
    partBytes: number;
    sessionTtlHours: number;
    partUrlTtlSeconds: number;
  };
  playback: {
    urlTtlSeconds: number;
  };
  jobs: {
    /** Missing this many heartbeat intervals reaps the job. */
    heartbeatIntervalSeconds: number;
    missedHeartbeatsBeforeExpiry: number;
    workerTokenTtlHours: number;
    defaultBudgetSeconds: number;
    defaultBudgetUsdCents: number;
  };
  compute: {
    defaultProvider: string;
    workerImage: string;
    /**
     * The absolute URL a hosted worker calls back to, ending in `/api/v1/vision/worker`.
     * Null until set; a provider that launches capacity is refused without it, because a
     * pod on someone else's network cannot resolve the relative path the box's worker uses.
     */
    hostedWorkerCallbackUrl: string | null;
    /** Refuses to launch new capacity past this, per month. */
    monthlyBudgetUsdCents: number;
  };
  /** Policy defaults from docs/vision/03-RIGHTS-AND-GOVERNANCE.md, pending
   * counsel confirmation (open item O1). Config, not constants, so confirming
   * them is a config change rather than a redesign. */
  policy: {
    takedownUnpublishImmediate: boolean;
    takedownDeleteWithinDays: number;
    dataSubjectAckWithinDays: number;
    dataSubjectCompleteWithinDays: number;
    derivedMediaRetentionMonths: number;
  };
};

export class VisionConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid Vision configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "VisionConfigError";
  }
}

const DEFAULTS = {
  partBytes: 16 * 1024 * 1024,
  sessionTtlHours: 168,
  partUrlTtlSeconds: 900,
  playbackTtlSeconds: 300,
  heartbeatIntervalSeconds: 30,
  missedHeartbeats: 3,
  workerTokenTtlHours: 12,
  budgetSeconds: 7200,
  budgetUsdCents: 500,
  monthlyBudgetUsdCents: 20_000,
  workerImage: "dtp-vision-engine:0.1.0",
  takedownDeleteWithinDays: 7,
  dataSubjectAckWithinDays: 7,
  dataSubjectCompleteWithinDays: 30,
  derivedMediaRetentionMonths: 24,
} as const;

function intFromEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  problems: string[],
  { min = 1, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {}
): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  // Deployment has been bitten by string-vs-integer env binding before (see
  // SMTP_PORT in infra/DEPLOYMENT.md), so parse strictly and say so loudly.
  if (!/^\d+$/.test(raw.trim())) {
    problems.push(`${key} must be a whole number, got ${JSON.stringify(raw)}`);
    return fallback;
  }
  const value = Number(raw.trim());
  if (value < min || value > max) {
    problems.push(`${key} must be between ${min} and ${max}, got ${value}`);
    return fallback;
  }
  return value;
}

function boolFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

export const WORKER_CALLBACK_PATH = "/api/v1/vision/worker";

/**
 * `VISION_HOSTED_WORKER_CALLBACK_URL`: https, or http only to this machine, because the
 * bootstrap token travels in it; and ending in the worker path, which the worker's own
 * bootstrap requires. Not `VISION_WORKER_CALLBACK_URL`: that is the box's worker's
 * setting, a name on the compose network no pod can reach.
 */
function callbackUrlFromEnv(env: NodeJS.ProcessEnv, problems: string[]): string | null {
  const raw = env.VISION_HOSTED_WORKER_CALLBACK_URL?.trim();
  if (!raw) return null;
  let url: URL | null = null;
  try { url = new URL(raw); } catch { /* reported below */ }
  const local = url !== null && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const path = url?.pathname.replace(/\/+$/, "");
  if (!url || (url.protocol !== "https:" && !(url.protocol === "http:" && local)) || path !== WORKER_CALLBACK_PATH || url.search || url.hash || url.username || url.password) {
    problems.push(`VISION_HOSTED_WORKER_CALLBACK_URL must be an https URL ending in ${WORKER_CALLBACK_PATH}, with no query or credentials; got ${JSON.stringify(raw)}`);
    return null;
  }
  return `${url.origin}${WORKER_CALLBACK_PATH}`;
}

/**
 * Builds and validates the Vision config.
 *
 * Vision is off unless `VISION_ENABLED` is set, so deploying this module to the
 * existing box changes nothing until someone turns it on.
 */
export function loadVisionConfig(env: NodeJS.ProcessEnv = process.env): VisionConfig {
  const problems: string[] = [];
  const enabled = boolFromEnv(env, "VISION_ENABLED", false);

  // An empty value is "unset": the staging compose file passes every VISION_* key
  // through as `${VAR:-}`, which yields "" when the secret has no such key, and ""
  // must mean the same as absent or a deploy without the keys cannot boot.
  const backendRaw = env.VISION_STORAGE_BACKEND?.trim() || (enabled ? "r2" : "memory");
  if (backendRaw !== "r2" && backendRaw !== "memory") {
    problems.push(`VISION_STORAGE_BACKEND must be "r2" or "memory", got ${JSON.stringify(backendRaw)}`);
  }
  const backend = backendRaw === "r2" ? "r2" : "memory";

  const buckets: Record<BucketId, string> = {
    master: env.VISION_R2_BUCKET_MASTER?.trim() || "",
    derived: env.VISION_R2_BUCKET_DERIVED?.trim() || "",
    models: env.VISION_R2_BUCKET_MODELS?.trim() || "",
    clips: env.VISION_R2_BUCKET_CLIPS?.trim() || "",
  };

  const accountId = env.VISION_R2_ACCOUNT_ID?.trim() || null;
  const explicitEndpoint = env.VISION_R2_ENDPOINT?.trim() || null;
  const endpoint =
    explicitEndpoint ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);

  if (backend === "r2") {
    if (!endpoint) {
      problems.push("VISION_R2_ENDPOINT or VISION_R2_ACCOUNT_ID is required when the backend is r2");
    }
    if (!env.VISION_R2_ACCESS_KEY_ID?.trim()) problems.push("VISION_R2_ACCESS_KEY_ID is required");
    if (!env.VISION_R2_SECRET_ACCESS_KEY?.trim()) {
      problems.push("VISION_R2_SECRET_ACCESS_KEY is required");
    }
    for (const [id, name] of Object.entries(buckets)) {
      if (!name) problems.push(`VISION_R2_BUCKET_${id.toUpperCase()} is required`);
    }
  }

  const config: VisionConfig = {
    enabled,
    storage: {
      backend,
      accountId,
      endpoint,
      accessKeyId: env.VISION_R2_ACCESS_KEY_ID?.trim() || null,
      secretAccessKey: env.VISION_R2_SECRET_ACCESS_KEY?.trim() || null,
      // R2 ignores region but the S3 protocol requires one.
      region: env.VISION_R2_REGION?.trim() || "auto",
      buckets,
    },
    upload: {
      partBytes: intFromEnv(env, "VISION_UPLOAD_PART_BYTES", DEFAULTS.partBytes, problems, {
        min: 5 * 1024 * 1024,
        max: 512 * 1024 * 1024,
      }),
      sessionTtlHours: intFromEnv(
        env,
        "VISION_UPLOAD_SESSION_TTL_HOURS",
        DEFAULTS.sessionTtlHours,
        problems,
        { min: 1, max: 720 }
      ),
      partUrlTtlSeconds: intFromEnv(
        env,
        "VISION_SIGNED_URL_TTL_PART_SECONDS",
        DEFAULTS.partUrlTtlSeconds,
        problems,
        { min: 60, max: 604800 }
      ),
    },
    playback: {
      urlTtlSeconds: intFromEnv(
        env,
        "VISION_SIGNED_URL_TTL_PLAYBACK_SECONDS",
        DEFAULTS.playbackTtlSeconds,
        problems,
        { min: 30, max: 3600 }
      ),
    },
    jobs: {
      heartbeatIntervalSeconds: intFromEnv(
        env,
        "VISION_JOB_HEARTBEAT_SECONDS",
        DEFAULTS.heartbeatIntervalSeconds,
        problems,
        { min: 5, max: 600 }
      ),
      missedHeartbeatsBeforeExpiry: intFromEnv(
        env,
        "VISION_JOB_MISSED_HEARTBEATS",
        DEFAULTS.missedHeartbeats,
        problems,
        { min: 2, max: 20 }
      ),
      workerTokenTtlHours: intFromEnv(
        env,
        "VISION_WORKER_TOKEN_TTL_HOURS",
        DEFAULTS.workerTokenTtlHours,
        problems,
        { min: 1, max: 72 }
      ),
      defaultBudgetSeconds: intFromEnv(
        env,
        "VISION_JOB_BUDGET_SECONDS",
        DEFAULTS.budgetSeconds,
        problems,
        { min: 60, max: 604800 }
      ),
      defaultBudgetUsdCents: intFromEnv(
        env,
        "VISION_JOB_BUDGET_USD_CENTS",
        DEFAULTS.budgetUsdCents,
        problems,
        { min: 1 }
      ),
    },
    compute: {
      defaultProvider: env.VISION_COMPUTE_PROVIDER?.trim() || "mock",
      workerImage: env.VISION_WORKER_IMAGE?.trim() || DEFAULTS.workerImage,
      hostedWorkerCallbackUrl: callbackUrlFromEnv(env, problems),
      monthlyBudgetUsdCents: intFromEnv(
        env,
        "VISION_MONTHLY_BUDGET_USD_CENTS",
        DEFAULTS.monthlyBudgetUsdCents,
        problems,
        { min: 1 }
      ),
    },
    policy: {
      takedownUnpublishImmediate: true,
      takedownDeleteWithinDays: intFromEnv(
        env,
        "VISION_TAKEDOWN_DELETE_WITHIN_DAYS",
        DEFAULTS.takedownDeleteWithinDays,
        problems,
        { min: 1, max: 90 }
      ),
      dataSubjectAckWithinDays: intFromEnv(
        env,
        "VISION_DSR_ACK_WITHIN_DAYS",
        DEFAULTS.dataSubjectAckWithinDays,
        problems,
        { min: 1, max: 30 }
      ),
      dataSubjectCompleteWithinDays: intFromEnv(
        env,
        "VISION_DSR_COMPLETE_WITHIN_DAYS",
        DEFAULTS.dataSubjectCompleteWithinDays,
        problems,
        { min: 1, max: 90 }
      ),
      derivedMediaRetentionMonths: intFromEnv(
        env,
        "VISION_DERIVED_RETENTION_MONTHS",
        DEFAULTS.derivedMediaRetentionMonths,
        problems,
        { min: 1, max: 240 }
      ),
    },
  };

  if (problems.length) throw new VisionConfigError(problems);
  return config;
}

export const VISION_CONFIG = Symbol("VISION_CONFIG");
