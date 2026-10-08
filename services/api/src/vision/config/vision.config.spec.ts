import { describe, expect, it } from "vitest";
import { VisionConfigError, loadVisionConfig } from "./vision.config";

const R2_ENV = {
  VISION_ENABLED: "true",
  VISION_STORAGE_BACKEND: "r2",
  VISION_R2_ACCOUNT_ID: "acct",
  VISION_R2_ACCESS_KEY_ID: "key",
  VISION_R2_SECRET_ACCESS_KEY: "secret",
  VISION_R2_BUCKET_MASTER: "dtp-staging-vision-master",
  VISION_R2_BUCKET_DERIVED: "dtp-staging-vision-derived",
  VISION_R2_BUCKET_MODELS: "dtp-staging-vision-models",
  VISION_R2_BUCKET_CLIPS: "dtp-staging-vision-clips",
} satisfies NodeJS.ProcessEnv;

describe("Vision is off unless it is switched on", () => {
  // Deploying this module to the existing box must change nothing until someone
  // enables it.
  it("defaults to disabled with an in-memory store and no credentials needed", () => {
    const config = loadVisionConfig({});
    expect(config.enabled).toBe(false);
    expect(config.storage.backend).toBe("memory");
  });

  it("requires nothing to boot while disabled", () => {
    expect(() => loadVisionConfig({})).not.toThrow();
  });
});

describe("configuration is validated at boot, not at first use", () => {
  it("fails loudly when R2 credentials are missing", () => {
    expect(() => loadVisionConfig({ VISION_ENABLED: "true", VISION_STORAGE_BACKEND: "r2" })).toThrow(
      VisionConfigError
    );
  });

  it("names every missing setting at once rather than one per restart", () => {
    let message = "";
    try {
      loadVisionConfig({ VISION_ENABLED: "true", VISION_STORAGE_BACKEND: "r2" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("VISION_R2_ACCESS_KEY_ID");
    expect(message).toContain("VISION_R2_SECRET_ACCESS_KEY");
    expect(message).toContain("VISION_R2_BUCKET_MASTER");
    expect(message).toContain("VISION_R2_BUCKET_CLIPS");
  });

  it("accepts a complete R2 configuration", () => {
    const config = loadVisionConfig(R2_ENV);
    expect(config.storage.backend).toBe("r2");
    expect(config.storage.endpoint).toBe("https://acct.r2.cloudflarestorage.com");
    expect(config.storage.buckets.master).toBe("dtp-staging-vision-master");
  });

  it("prefers an explicit endpoint over one derived from the account id", () => {
    const config = loadVisionConfig({ ...R2_ENV, VISION_R2_ENDPOINT: "https://custom.example" });
    expect(config.storage.endpoint).toBe("https://custom.example");
  });

  it("treats an empty VISION_STORAGE_BACKEND as unset, as the staging compose file passes it", () => {
    const off = loadVisionConfig({ VISION_STORAGE_BACKEND: "", VISION_ENABLED: "", VISION_COMPUTE_PROVIDER: "" });
    expect(off.enabled).toBe(false);
    expect(off.storage.backend).toBe("memory");
    expect(off.compute.defaultProvider).toBe("mock");
    const on = loadVisionConfig({ ...R2_ENV, VISION_STORAGE_BACKEND: "" });
    expect(on.storage.backend).toBe("r2");
  });

  it("rejects an unknown storage backend", () => {
    expect(() => loadVisionConfig({ ...R2_ENV, VISION_STORAGE_BACKEND: "s3" })).toThrow(
      VisionConfigError
    );
  });
});

// Deployment has been bitten by string-vs-integer env binding before — see the
// SMTP_PORT note in infra/DEPLOYMENT.md — so numeric settings parse strictly.
describe("numeric settings", () => {
  it("refuses a non-numeric value instead of silently coercing it", () => {
    expect(() => loadVisionConfig({ VISION_UPLOAD_PART_BYTES: '"16777216"' })).toThrow(
      /must be a whole number/
    );
  });

  it("refuses a part size below the 5 MiB multipart minimum", () => {
    expect(() => loadVisionConfig({ VISION_UPLOAD_PART_BYTES: "1024" })).toThrow(/between/);
  });

  it("uses the documented defaults when unset", () => {
    const config = loadVisionConfig({});
    expect(config.upload.partBytes).toBe(16 * 1024 * 1024);
    expect(config.upload.sessionTtlHours).toBe(168);
    expect(config.upload.partUrlTtlSeconds).toBe(900);
    expect(config.playback.urlTtlSeconds).toBe(300);
  });

  it("keeps playback URLs short-lived, so an issued URL is not a standing grant", () => {
    expect(() => loadVisionConfig({ VISION_SIGNED_URL_TTL_PLAYBACK_SECONDS: "86400" })).toThrow(
      /between 30 and 3600/
    );
  });

  it("accepts an overridden part size within range", () => {
    expect(loadVisionConfig({ VISION_UPLOAD_PART_BYTES: "33554432" }).upload.partBytes).toBe(
      33554432
    );
  });
});

describe("policy defaults", () => {
  // O1 in docs/vision/13-OPEN-QUESTIONS.md: these are counsel's numbers to
  // confirm, so they are configuration rather than constants.
  it("carries the documented takedown and data-subject defaults", () => {
    const { policy } = loadVisionConfig({});
    expect(policy.takedownUnpublishImmediate).toBe(true);
    expect(policy.takedownDeleteWithinDays).toBe(7);
    expect(policy.dataSubjectAckWithinDays).toBe(7);
    expect(policy.dataSubjectCompleteWithinDays).toBe(30);
    expect(policy.derivedMediaRetentionMonths).toBe(24);
  });

  it("lets counsel change them by configuration, not by a code change", () => {
    const { policy } = loadVisionConfig({
      VISION_TAKEDOWN_DELETE_WITHIN_DAYS: "3",
      VISION_DSR_COMPLETE_WITHIN_DAYS: "14",
    });
    expect(policy.takedownDeleteWithinDays).toBe(3);
    expect(policy.dataSubjectCompleteWithinDays).toBe(14);
  });
});

describe("job defaults", () => {
  it("always has a budget, because an idle pod is the commonest overspend", () => {
    const { jobs } = loadVisionConfig({});
    expect(jobs.defaultBudgetSeconds).toBeGreaterThan(0);
    expect(jobs.defaultBudgetUsdCents).toBeGreaterThan(0);
  });

  it("reaps a job after the configured number of missed heartbeats", () => {
    const { jobs } = loadVisionConfig({});
    expect(jobs.missedHeartbeatsBeforeExpiry).toBe(3);
    expect(jobs.heartbeatIntervalSeconds).toBe(30);
  });
});

describe("the URL a hosted worker calls back to", () => {
  const load = (value?: string) => loadVisionConfig(value === undefined ? {} : { VISION_HOSTED_WORKER_CALLBACK_URL: value }).compute.hostedWorkerCallbackUrl;
  it("is unset by default and when blank, so a deploy without the key still boots", () => {
    expect(load()).toBeNull(); expect(load("")).toBeNull(); expect(load("  ")).toBeNull();
  });
  it("accepts https, or http to this machine, ending in the worker path, and normalises it", () => {
    expect(load("https://api.dtp.africa/api/v1/vision/worker/")).toBe("https://api.dtp.africa/api/v1/vision/worker");
    expect(load("http://localhost:3000/api/v1/vision/worker")).toBe("http://localhost:3000/api/v1/vision/worker");
  });
  it.each([
    "/api/v1/vision/worker",
    "http://api:3000/api/v1/vision/worker",
    "http://api.dtp.africa/api/v1/vision/worker",
    "https://api.dtp.africa",
    "https://api.dtp.africa/api/v1/vision",
    "https://api.dtp.africa/api/v1/vision/worker?x=1",
    "https://user:pass@api.dtp.africa/api/v1/vision/worker",
    "ftp://api.dtp.africa/api/v1/vision/worker",
  ])("refuses at boot: %s", (value) => {
    expect(() => load(value)).toThrow(/VISION_HOSTED_WORKER_CALLBACK_URL/);
  });
});
