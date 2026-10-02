import { ConflictException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VisionJobsService } from "./vision-jobs.service";

/**
 * What enqueue resolves on the worker's behalf.
 *
 * A worker sees a presigned URL and a job id. It cannot ask which model the operator
 * meant, and it cannot ask a URL what a trimmed proxy's source offset is -- so both
 * are resolved here and written into the job, where the gate (vision:modelcheck)
 * then reads them back off the row. These tests hold the shape of that write.
 */

const ASSET = "aaaa1111-2222-4333-8444-555566667777";
const MODEL_VERSION = "55556666-7777-4888-9999-aaaabbbbcccc";

const mockPrisma = {
  visionVideoAsset: { findUnique: vi.fn() },
  visionJob: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  visionJobEvent: { create: vi.fn() },
  visionVideoVariant: { findFirst: vi.fn() },
};
const mockRights = { canAnalyze: vi.fn() };
const mockAudit = { record: vi.fn() };
const mockQueue = { enqueue: vi.fn(), cancel: vi.fn() };
const mockModels = { resolveForJob: vi.fn() };
const config = { jobs: { defaultBudgetSeconds: 3600, defaultBudgetUsdCents: 500 } };

let service: VisionJobsService;

function enqueued() {
  return mockQueue.enqueue.mock.calls.at(-1)![0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({
    id: ASSET,
    sbMatchId: "match-1",
    ingestState: "ready",
  });
  // Every prerequisite stage has succeeded unless a test says otherwise.
  mockPrisma.visionJob.findMany.mockResolvedValue([
    { type: "probe" },
    { type: "fingerprint" },
    { type: "transcode" },
  ]);
  mockPrisma.visionVideoVariant.findFirst.mockResolvedValue({ fps: 25, sourceOffsetMs: 9000 });
  mockRights.canAnalyze.mockResolvedValue({ allowed: true });
  mockQueue.enqueue.mockImplementation(({ id }: { id: string }) => Promise.resolve({ id }));
  mockModels.resolveForJob.mockResolvedValue(null);
  mockAudit.record.mockResolvedValue(undefined);
  service = new VisionJobsService(
    mockPrisma as never,
    mockRights as never,
    mockAudit as never,
    mockQueue as never,
    config as never,
    mockModels as never
  );
});

describe("a model-bound job carries the version it must run", () => {
  it("writes the resolved version onto the job and into the audit record", async () => {
    mockModels.resolveForJob.mockResolvedValue({ id: MODEL_VERSION, task: "detect" });

    await service.enqueueForAsset({ type: "detect", videoAssetId: ASSET });

    expect(mockModels.resolveForJob).toHaveBeenCalledWith("detect", undefined);
    expect(enqueued().modelVersionId).toBe(MODEL_VERSION);
    expect(mockAudit.record.mock.calls[0]![0].data.modelVersionId).toBe(MODEL_VERSION);
  });

  it("forwards an explicit version to the registry rather than deciding itself", async () => {
    mockModels.resolveForJob.mockResolvedValue({ id: MODEL_VERSION, task: "detect" });
    await service.enqueueForAsset({ type: "detect", videoAssetId: ASSET, modelVersionId: MODEL_VERSION });
    expect(mockModels.resolveForJob).toHaveBeenCalledWith("detect", MODEL_VERSION);
  });

  it("queues nothing when the registry refuses", async () => {
    mockModels.resolveForJob.mockRejectedValue(
      new ConflictException({ statusCode: 409, error: "NoProductionModel" })
    );
    await expect(service.enqueueForAsset({ type: "detect", videoAssetId: ASSET })).rejects.toMatchObject({
      response: { error: "NoProductionModel" },
    });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });

  it("leaves the version null for a stage that runs no model", async () => {
    await service.enqueueForAsset({ type: "probe", videoAssetId: ASSET });
    expect(enqueued().modelVersionId).toBeNull();
  });
});

describe("a stage downstream of transcode carries the proxy's clock", () => {
  it("copies frame rate and source offset from the variant row", async () => {
    await service.enqueueForAsset({ type: "detect", videoAssetId: ASSET });
    expect(enqueued().inputSpec.proxy).toEqual({ fps: 25, sourceOffsetMs: 9000 });
    expect(mockPrisma.visionVideoVariant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { videoAssetId: ASSET, kind: "proxy" } })
    );
  });

  it("does not let the caller forge the clock, but keeps their other parameters", async () => {
    await service.enqueueForAsset({
      type: "detect",
      videoAssetId: ASSET,
      params: { sampleFps: 1, proxy: { fps: 1, sourceOffsetMs: 0 } },
    });
    expect(enqueued().inputSpec).toEqual({
      videoAssetId: ASSET,
      sampleFps: 1,
      proxy: { fps: 25, sourceOffsetMs: 9000 },
    });
  });

  it("does so for clip as well, which also reads the proxy", async () => {
    await service.enqueueForAsset({ type: "clip", videoAssetId: ASSET });
    expect(enqueued().inputSpec.proxy).toEqual({ fps: 25, sourceOffsetMs: 9000 });
  });

  it("does not look for a proxy before one can exist", async () => {
    await service.enqueueForAsset({ type: "probe", videoAssetId: ASSET });
    await service.enqueueForAsset({ type: "fingerprint", videoAssetId: ASSET });
    expect(mockPrisma.visionVideoVariant.findFirst).not.toHaveBeenCalled();
    expect(enqueued().inputSpec.proxy).toBeUndefined();
  });

  it("refuses when transcode succeeded but no proxy row exists", async () => {
    mockPrisma.visionVideoVariant.findFirst.mockResolvedValue(null);
    await expect(service.enqueueForAsset({ type: "detect", videoAssetId: ASSET })).rejects.toMatchObject({
      response: { error: "ProxyMissing" },
    });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });

  it.each([null, 0])("refuses a proxy whose frame rate is %s rather than guessing one", async (fps) => {
    mockPrisma.visionVideoVariant.findFirst.mockResolvedValue({ fps, sourceOffsetMs: 0 });
    await expect(service.enqueueForAsset({ type: "detect", videoAssetId: ASSET })).rejects.toMatchObject({
      response: { error: "ProxyWithoutFps" },
    });
  });
});

describe("the gates that were already there still come first", () => {
  it("still refuses before the prerequisites have succeeded, without touching the registry", async () => {
    mockPrisma.visionJob.findMany.mockResolvedValue([{ type: "probe" }]);
    await expect(service.enqueueForAsset({ type: "detect", videoAssetId: ASSET })).rejects.toThrow(
      /needs transcode/
    );
    expect(mockModels.resolveForJob).not.toHaveBeenCalled();
    expect(mockPrisma.visionVideoVariant.findFirst).not.toHaveBeenCalled();
  });

  it("still refuses when analysis rights are not granted", async () => {
    mockRights.canAnalyze.mockResolvedValue({ allowed: false, reason: "no_scope" });
    await expect(service.enqueueForAsset({ type: "detect", videoAssetId: ASSET })).rejects.toMatchObject({
      response: { error: "RightsDenied" },
    });
    expect(mockModels.resolveForJob).not.toHaveBeenCalled();
  });
});

/**
 * A track job links one detect artifact. Which one is decided here, declared on the
 * job, and refused at the door when it cannot be linked -- a pod should not spin up
 * to discover that 2fps detections are too sparse.
 */
describe("a track job is given the detect artifact it will link", () => {
  const TRACKER = "55556666-7777-4888-9999-aaaabbbbcccc";
  const DETECTOR = "55556666-7777-4888-9999-aaaabbbbdddd";
  const succeededDetect = (over: Record<string, unknown> = {}) => ({
    id: "job-d",
    modelVersionId: DETECTOR,
    progress: { artifacts: [{ key: "inference/job-d/1/detections.json", bucket: "derived", role: "detections" }], summary: { sampleFps: 25 } },
    ...over,
  });

  beforeEach(() => {
    mockPrisma.visionJob.findMany.mockResolvedValue([{ type: "probe" }, { type: "fingerprint" }, { type: "transcode" }, { type: "detect" }]);
    mockModels.resolveForJob.mockResolvedValue({ id: TRACKER, task: "track" });
    mockPrisma.visionJob.findFirst.mockResolvedValue(succeededDetect());
  });

  it("declares the latest succeeded detect artifact and the proxy clock", async () => {
    await service.enqueueForAsset({ type: "track", videoAssetId: ASSET });
    const spec = enqueued().inputSpec;
    expect(spec.detections).toEqual({ jobId: "job-d", key: "inference/job-d/1/detections.json", modelVersionId: DETECTOR, sampleFps: 25 });
    expect(spec.readKeys).toEqual([{ bucket: "derived", key: "inference/job-d/1/detections.json" }]);
    // track follows detect follows transcode: it reads the proxy, so it gets the clock.
    expect(spec.proxy).toEqual({ fps: 25, sourceOffsetMs: 9000 });
    expect(enqueued().modelVersionId).toBe(TRACKER);
    expect(mockPrisma.visionJob.findFirst.mock.calls[0]![0].where).toMatchObject({ type: "detect", state: "succeeded", videoAssetId: ASSET });
  });

  it("uses the detect job the caller names", async () => {
    await service.enqueueForAsset({ type: "track", videoAssetId: ASSET, params: { detectJobId: "job-x" } });
    expect(mockPrisma.visionJob.findFirst.mock.calls[0]![0].where).toMatchObject({ id: "job-x" });
  });

  it("refuses when no succeeded detect job carries an artifact", async () => {
    mockPrisma.visionJob.findFirst.mockResolvedValue(null);
    await expect(service.enqueueForAsset({ type: "track", videoAssetId: ASSET })).rejects.toMatchObject({
      response: { error: "DetectionsMissing" },
    });
    mockPrisma.visionJob.findFirst.mockResolvedValue(succeededDetect({ progress: { artifacts: [] } }));
    await expect(service.enqueueForAsset({ type: "track", videoAssetId: ASSET })).rejects.toMatchObject({
      response: { error: "DetectionsMissing" },
    });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });

  it("refuses detections sampled too sparsely to link", async () => {
    mockPrisma.visionJob.findFirst.mockResolvedValue(succeededDetect({ progress: { artifacts: [{ key: "k", bucket: "derived", role: "detections" }], summary: { sampleFps: 2 } } }));
    await expect(service.enqueueForAsset({ type: "track", videoAssetId: ASSET })).rejects.toMatchObject({
      response: { error: "DetectionsTooSparse" },
    });
  });

  it("does not let a caller forge the declared inputs", async () => {
    await service.enqueueForAsset({
      type: "track",
      videoAssetId: ASSET,
      params: { readKeys: [{ bucket: "master", key: "originals/x" }], detections: { key: "forged" } },
    });
    expect(enqueued().inputSpec.readKeys).toEqual([{ bucket: "derived", key: "inference/job-d/1/detections.json" }]);
    expect(enqueued().inputSpec.detections.key).toBe("inference/job-d/1/detections.json");
  });
});
