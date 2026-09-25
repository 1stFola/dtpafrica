import { ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { OUTPUT_BUCKET_BY_JOB_TYPE, visionKeys } from "@dtp/vision-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadVisionConfig } from "../config/vision.config";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import { VisionWorkerController } from "./worker.controller";
import { VisionWorkerGuard, type WorkerRequest } from "./vision-worker.guard";

/**
 * The Phase 1 security gate: a worker cannot choose where its output lands.
 *
 * It holds no storage credential, so every write goes through a presign request
 * that the control plane validates against the job's own output prefix. That is
 * what stops a compromised or buggy worker reaching the master bucket, which
 * holds irreplaceable source media and has no version history to recover from.
 */

const JOB = "11112222-3333-4444-5555-666677778888";
const WORKER = "aaaabbbb-cccc-dddd-eeee-ffff00001111";
const OTHER_WORKER = "99998888-7777-6666-5555-444433332222";
const PREFIX = visionKeys.inferencePrefix(JOB, 1);

const mockPrisma = {
  visionJob: { findUnique: vi.fn() },
  visionJobCost: { upsert: vi.fn() },
};

const mockQueue = {
  claim: vi.fn(),
  markRunning: vi.fn(),
  heartbeat: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
};

const mockTokens = { register: vi.fn(), verify: vi.fn(), retire: vi.fn(), mintBootstrap: vi.fn() };

/** The applier is exercised in stage-results.spec.ts; here it only needs to exist. */
const mockStageResults = {
  apply: vi.fn().mockResolvedValue({ applied: true, detail: "" }),
  markIngestFailed: vi.fn(),
};

let store: InMemoryObjectStore;
let controller: VisionWorkerController;

function request(workerId = WORKER, classes = ["cpu_small" as const]): WorkerRequest {
  return {
    headers: {},
    workerAuth: { workerId, resourceClasses: classes, providerId: "mock" },
  };
}

/** A job this worker legitimately holds and is still running. */
function heldJob(overrides: Record<string, unknown> = {}) {
  return {
    type: "transcode",
    state: "running",
    workerId: WORKER,
    outputPrefix: PREFIX,
    attemptNumber: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store = new InMemoryObjectStore();
  controller = new VisionWorkerController(
    mockPrisma as never,
    mockTokens as never,
    mockStageResults as never,
    mockQueue as never,
    store,
    loadVisionConfig({})
  );
});

describe("presign confines a worker to its own output prefix", () => {
  it("issues a URL for a key inside the prefix", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue(heldJob());

    const res = await controller.presign(request(), JOB, {
      key: `${PREFIX}detections.parquet`,
      contentType: "application/octet-stream",
    });

    expect(res.bucket).toBe(OUTPUT_BUCKET_BY_JOB_TYPE.transcode);
    expect(res.key).toBe(`${PREFIX}detections.parquet`);
    expect(store.issuedUrls.at(-1)).toMatchObject({ method: "PUT", bucket: "derived" });
  });

  // The attack this whole design exists to stop.
  it("refuses a key that traverses out to the master bucket", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue(heldJob());

    await expect(
      controller.presign(request(), JOB, {
        key: `${PREFIX}../../../originals/victim/source.mp4`,
        contentType: "video/mp4",
      })
    ).rejects.toThrow(ForbiddenException);
    expect(store.issuedUrls).toHaveLength(0);
  });

  it("refuses a sibling attempt's prefix", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue(heldJob());

    await expect(
      controller.presign(request(), JOB, {
        key: `${visionKeys.inferencePrefix(JOB, 2)}detections.parquet`,
        contentType: "application/octet-stream",
      })
    ).rejects.toThrow(ForbiddenException);
  });

  it("refuses another job's prefix", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue(heldJob());

    await expect(
      controller.presign(request(), JOB, {
        key: `${visionKeys.inferencePrefix("00000000-0000-0000-0000-000000000000", 1)}x.parquet`,
        contentType: "application/octet-stream",
      })
    ).rejects.toThrow(ForbiddenException);
  });

  it("refuses the bare prefix itself", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue(heldJob());
    await expect(
      controller.presign(request(), JOB, { key: PREFIX, contentType: "text/plain" })
    ).rejects.toThrow(ForbiddenException);
  });

  it("refuses a worker that does not hold the job", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue(heldJob({ workerId: OTHER_WORKER }));

    await expect(
      controller.presign(request(), JOB, {
        key: `${PREFIX}detections.parquet`,
        contentType: "application/octet-stream",
      })
    ).rejects.toThrow(ForbiddenException);
  });

  it.each(["succeeded", "failed", "cancelled", "queued"])(
    "refuses a write once the job is %s",
    async (state) => {
      mockPrisma.visionJob.findUnique.mockResolvedValue(heldJob({ state }));
      await expect(
        controller.presign(request(), JOB, {
          key: `${PREFIX}late.parquet`,
          contentType: "application/octet-stream",
        })
      ).rejects.toThrow(ForbiddenException);
    }
  );

  it("404s an unknown job rather than leaking whether it exists elsewhere", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue(null);
    await expect(
      controller.presign(request(), JOB, { key: `${PREFIX}x`, contentType: "text/plain" })
    ).rejects.toThrow(NotFoundException);
  });

  // Routing, not security, but the cost consequence is real: clip output must not
  // land in the derived bucket and vice versa.
  it("routes output to the bucket the job type declares", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue(heldJob({ type: "clip" }));
    const res = await controller.presign(request(), JOB, {
      key: `${PREFIX}clip.mp4`,
      contentType: "video/mp4",
    });
    expect(res.bucket).toBe("clips");
  });
});

describe("completion re-validates what the worker claims it wrote", () => {
  beforeEach(() => {
    mockPrisma.visionJob.findUnique.mockResolvedValue({ outputPrefix: PREFIX, type: "transcode" });
    mockQueue.succeed.mockResolvedValue({ alreadyApplied: false });
  });

  it("accepts artifacts inside the prefix", async () => {
    const res = await controller.complete(request(), JOB, {
      idempotencyKey: "complete-attempt-1",
      artifacts: [
        { key: `${PREFIX}proxy.mp4`, bucket: "derived", bytes: 10, contentType: "video/mp4", role: "proxy" },
      ],
    });
    expect(res.ok).toBe(true);
    expect(mockQueue.succeed).toHaveBeenCalledOnce();
  });

  // A worker reporting an artifact it was never allowed to write is broken or
  // lying. Either way the claim must not be recorded.
  it("refuses an artifact outside the prefix and records nothing", async () => {
    await expect(
      controller.complete(request(), JOB, {
        idempotencyKey: "complete-attempt-1",
        artifacts: [
          {
            key: "originals/victim/source.mp4",
            bucket: "master",
            bytes: 10,
            contentType: "video/mp4",
            role: "proxy",
          },
        ],
      })
    ).rejects.toThrow(ForbiddenException);
    expect(mockQueue.succeed).not.toHaveBeenCalled();
  });

  it("is retry-safe: a repeat with the same key does not double-apply", async () => {
    mockQueue.succeed.mockResolvedValue({ alreadyApplied: true });
    const res = await controller.complete(request(), JOB, { idempotencyKey: "complete-attempt-1" });
    expect(res.alreadyApplied).toBe(true);
    expect(mockPrisma.visionJobCost.upsert).not.toHaveBeenCalled();
  });

  it("records cost only on the first application", async () => {
    await controller.complete(request(), JOB, {
      idempotencyKey: "complete-attempt-1",
      cost: { gpuSeconds: 12, cpuSeconds: 30, wallClockSeconds: 40 },
    });
    expect(mockPrisma.visionJobCost.upsert).toHaveBeenCalledOnce();
  });
});

describe("a worker may only claim what it registered for", () => {
  it("refuses a CPU worker asking for GPU work", async () => {
    await expect(
      controller.claim(request(WORKER, ["cpu_small"]), { resourceClasses: ["gpu_48gb"] })
    ).rejects.toThrow(ForbiddenException);
    expect(mockQueue.claim).not.toHaveBeenCalled();
  });

  it("defaults to the classes it registered for", async () => {
    mockQueue.claim.mockResolvedValue(null);
    await controller.claim(request(WORKER, ["cpu_small"]), {});
    expect(mockQueue.claim).toHaveBeenCalledWith(WORKER, ["cpu_small"]);
  });

  it("returns no job rather than an error when the queue is empty", async () => {
    mockQueue.claim.mockResolvedValue(null);
    const res = await controller.claim(request(), {});
    expect(res.job).toBeNull();
  });

  it("rejects a worker running an incompatible contract version", async () => {
    await expect(
      controller.claim(request(), { contractVersion: "0.0.1" })
    ).rejects.toThrow(/Contract mismatch/);
  });

  it("hands over a provider-neutral job spec", async () => {
    mockQueue.claim.mockResolvedValue({
      id: JOB,
      type: "transcode",
      resourceClass: "cpu_small",
      attemptNumber: 1,
      inputSpec: { videoAssetId: "asset-1" },
      outputPrefix: PREFIX,
      budgetSeconds: 3600,
      budgetUsdCents: 200,
      videoAssetId: "asset-1",
      datasetVersionId: null,
      modelVersionId: null,
    });

    const res = await controller.claim(request(), {});
    const serialised = JSON.stringify(res.job).toLowerCase();
    for (const vendor of ["runpod", "lambda", "cloudflare", "aws"]) {
      expect(serialised).not.toContain(vendor);
    }
    expect(mockQueue.markRunning).toHaveBeenCalledWith(JOB, WORKER);
  });
});

describe("the worker guard is a separate stack from admin auth", () => {
  it("refuses a request with no worker token", async () => {
    const guard = new VisionWorkerGuard(mockTokens as never);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    };
    await expect(guard.canActivate(ctx as never)).rejects.toThrow(UnauthorizedException);
  });

  // A proxy or client that helpfully forwards an admin bearer token must not
  // accidentally satisfy worker auth.
  it("ignores an Authorization header entirely", async () => {
    const guard = new VisionWorkerGuard(mockTokens as never);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: "Bearer an-admin-jwt" } }),
      }),
    };
    await expect(guard.canActivate(ctx as never)).rejects.toThrow(UnauthorizedException);
    expect(mockTokens.verify).not.toHaveBeenCalled();
  });

  it("accepts its own header and attaches the identity", async () => {
    mockTokens.verify.mockResolvedValue({
      workerId: WORKER,
      resourceClasses: ["cpu_small"],
      providerId: "mock",
    });
    const guard = new VisionWorkerGuard(mockTokens as never);
    const req: Record<string, unknown> = { headers: { "x-vision-worker-token": "tok" } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) };

    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);
    expect(req.workerAuth).toMatchObject({ workerId: WORKER });
  });
});
