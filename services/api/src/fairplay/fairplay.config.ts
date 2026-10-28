/**
 * FairPlay's cloud settings, validated once at boot (docs/fairplay/phase-4-cloud.md).
 *
 * Storage has its own bucket and its own R2 token, scoped to that bucket only: Vision's
 * key reaches Vision's buckets and must never reach evidence, and evidence must never be
 * reachable from Vision's training or highlight paths (ADR-0006, ADR-0007). Until the
 * bucket exists the backend is `off`: everything but the evidence routes works, and those
 * refuse with a reason.
 */

export type FairPlayStorageConfig = {
  backend: "r2" | "off";
  endpoint: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  region: string;
  bucket: string | null;
};

export type FairPlayConfig = {
  storage: FairPlayStorageConfig;
  /** Ed25519 private key (PKCS#8 PEM) that signs venue credential bundles. */
  bundleSigningKeyPem: string | null;
  bundleTtlHours: number;
  bootstrapTokenTtlHours: number;
  deviceTokenTtlDays: number;
  uploadUrlTtlSeconds: number;
  readUrlTtlSeconds: number;
  /** D10: evidence in R2 is deleted this many days after the finding. */
  evidenceRetentionDays: number;
  /** Largest clip the Edge may upload. A 310 s window at 2.5 Mbit/s is about 100 MB. */
  maxClipBytes: number;
  maxManifestBytes: number;
  /** R2 list prices, in US dollars, for the usage estimate only. Recheck before the bucket. */
  prices: { storagePerGbMonth: number; classAPerMillion: number; classBPerMillion: number };
};

export class FairPlayConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid FairPlay configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "FairPlayConfigError";
  }
}

export const FAIRPLAY_CONFIG = Symbol("FAIRPLAY_CONFIG");

function positive(env: NodeJS.ProcessEnv, name: string, fallback: number, problems: string[]): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    problems.push(`${name} must be a positive number, not "${raw}"`);
    return fallback;
  }
  return value;
}

export function loadFairPlayConfig(env: NodeJS.ProcessEnv = process.env): FairPlayConfig {
  const problems: string[] = [];
  const backend = (env.FAIRPLAY_STORAGE_BACKEND?.trim() || "off") as FairPlayStorageConfig["backend"];
  if (backend !== "r2" && backend !== "off") problems.push(`FAIRPLAY_STORAGE_BACKEND must be r2 or off, not "${backend}"`);
  const storage: FairPlayStorageConfig = {
    backend,
    endpoint: env.FAIRPLAY_R2_ENDPOINT?.trim() || null,
    accessKeyId: env.FAIRPLAY_R2_ACCESS_KEY_ID?.trim() || null,
    secretAccessKey: env.FAIRPLAY_R2_SECRET_ACCESS_KEY?.trim() || null,
    region: env.FAIRPLAY_R2_REGION?.trim() || "auto",
    bucket: env.FAIRPLAY_R2_BUCKET?.trim() || null,
  };
  if (backend === "r2") {
    for (const [name, value] of [["FAIRPLAY_R2_ENDPOINT", storage.endpoint], ["FAIRPLAY_R2_ACCESS_KEY_ID", storage.accessKeyId],
      ["FAIRPLAY_R2_SECRET_ACCESS_KEY", storage.secretAccessKey], ["FAIRPLAY_R2_BUCKET", storage.bucket]] as const) {
      if (!value) problems.push(`${name} is required when FAIRPLAY_STORAGE_BACKEND=r2`);
    }
    if (storage.bucket && /^vision|-(master|derived|models|clips)$/.test(storage.bucket)) {
      problems.push(`FAIRPLAY_R2_BUCKET "${storage.bucket}" looks like a Vision bucket; evidence has its own`);
    }
  }
  // Secrets Manager and .env files both carry a PEM more safely with literal "\n".
  const pem = env.FAIRPLAY_BUNDLE_SIGNING_KEY?.trim().replace(/\\n/g, "\n") || null;
  if (pem && !pem.includes("BEGIN PRIVATE KEY")) problems.push("FAIRPLAY_BUNDLE_SIGNING_KEY must be a PKCS#8 PEM private key");

  const config: FairPlayConfig = {
    storage,
    bundleSigningKeyPem: pem,
    bundleTtlHours: positive(env, "FAIRPLAY_BUNDLE_TTL_HOURS", 36, problems),
    bootstrapTokenTtlHours: positive(env, "FAIRPLAY_BOOTSTRAP_TOKEN_TTL_HOURS", 24, problems),
    deviceTokenTtlDays: positive(env, "FAIRPLAY_DEVICE_TOKEN_TTL_DAYS", 365, problems),
    uploadUrlTtlSeconds: positive(env, "FAIRPLAY_UPLOAD_URL_TTL_SECONDS", 900, problems),
    readUrlTtlSeconds: Math.min(300, positive(env, "FAIRPLAY_READ_URL_TTL_SECONDS", 300, problems)),
    evidenceRetentionDays: positive(env, "FAIRPLAY_EVIDENCE_RETENTION_DAYS", 90, problems),
    maxClipBytes: positive(env, "FAIRPLAY_MAX_CLIP_BYTES", 512 * 1024 * 1024, problems),
    maxManifestBytes: 1024 * 1024,
    prices: { storagePerGbMonth: 0.015, classAPerMillion: 4.5, classBPerMillion: 0.36 },
  };
  if (problems.length) throw new FairPlayConfigError(problems);
  return config;
}
