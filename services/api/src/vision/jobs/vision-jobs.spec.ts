import { ConflictException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALIBRATION_FRAMES_CHUNK_ROLE, CALIBRATION_FRAMES_INDEX_ROLE, CALIBRATION_PROPAGATION_VERSION, visionKeys } from "@dtp/vision-contracts";
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
  visionCameraSegment: { findMany: vi.fn() },
  visionClockAnchor: { findMany: vi.fn() },
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

  it("drops a forged read list and asset id on a stage that declares no inputs of its own", async () => {
    // Before docs/vision/50 PR-3, params.readKeys on a detect job reached the worker as
    // a declared read list, letting it presign any derived or models object.
    await service.enqueueForAsset({
      type: "detect",
      videoAssetId: ASSET,
      params: {
        sampleFps: 1,
        videoAssetId: "someone-elses-asset",
        readKeys: [{ bucket: "models", key: "weights/x.pt" }],
        tracks: { jobId: "forged" },
      },
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
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([]);
  });

  it("declares the camera cuts: the start of every segment but the first", async () => {
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ startMs: 9000 }, { startMs: 70_200 }, { startMs: 70_200 }, { startMs: 189_000 }]);
    await service.enqueueForAsset({ type: "track", videoAssetId: ASSET });
    expect(enqueued().inputSpec.cuts).toEqual([70_200, 189_000]);
    expect(mockPrisma.visionCameraSegment.findMany.mock.calls[0]![0]).toMatchObject({ where: { videoAssetId: ASSET }, orderBy: { startMs: "asc" } });
  });

  it("declares no cuts for footage with one segment or none, and takes none from the caller", async () => {
    await service.enqueueForAsset({ type: "track", videoAssetId: ASSET, params: { cuts: [1, 2, 3] } });
    expect(enqueued().inputSpec).not.toHaveProperty("cuts");
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ startMs: 0 }]);
    await service.enqueueForAsset({ type: "track", videoAssetId: ASSET, params: { cuts: [1, 2, 3] } });
    expect(enqueued().inputSpec).not.toHaveProperty("cuts");
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

describe("ball trajectory inputs are pinned before CPU dispatch", () => {
  const hash = "a".repeat(64), proxyHash = "b".repeat(64), weights = "c".repeat(64);
  const detector = () => ({ id: "ball-detect", attemptNumber: 2, modelVersionId: MODEL_VERSION,
    progress: { artifacts: [{ key: "inference/ball-detect/2/detections.json", bucket: "derived", role: "detections" }],
      summary: { modelVersionId: MODEL_VERSION, sourceChecksum: hash, weightsSha256: weights, proxyChecksum: proxyHash, imageWidth: 1280, imageHeight: 720, proxyDurationMs: 240,
        sampleFps: 25, proxyFps: 25, sourceOffsetMs: 0 } } });
  beforeEach(() => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, sbMatchId: "match-1", ingestState: "ready", checksumSha256: hash, durationMs: 200 });
    mockPrisma.visionJob.findMany.mockResolvedValue([{ type: "detect" }]);
    mockPrisma.visionJob.findFirst.mockResolvedValue(detector());
    mockPrisma.visionVideoVariant.findFirst.mockResolvedValue({ fps: 25, sourceOffsetMs: 0 });
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: "camera", startMs: 0, endMs: 200, kind: "live_play" }]);
  });
  it("pins the original detection geometry, source, proxy, weights and segments and permits no caller-owned replacement", async () => {
    await service.enqueueForAsset({ type: "ball_trajectory", videoAssetId: ASSET, params: { detectJobId: "ball-detect", sourceChecksum: "forged", imageWidth: 99, proxyDurationMs: 999999, segments: [], readKeys: [{ bucket: "master", key: "forged" }] } });
    const job = enqueued();
    expect(job.resourceClass).toBe("cpu_small"); expect(job.modelVersionId).toBeNull();
    expect(job.inputSpec).toMatchObject({ sourceChecksum: hash, sourceDurationMs: 200, proxyChecksum: proxyHash, proxyDurationMs: 240, imageWidth: 1280, imageHeight: 720,
      detections: { jobId: "ball-detect", modelVersionId: MODEL_VERSION, weightsChecksum: weights, sampleFps: 25 },
      segments: [{ cameraSegmentId: "camera", kind: "live_play" }], readKeys: [{ bucket: "derived", key: "inference/ball-detect/2/detections.json" }] });
    expect(mockPrisma.visionJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { videoAssetId: ASSET, type: "detect", state: "succeeded", id: "ball-detect" } }));
  });
  it("refuses missing provenance, stale source, sparse detections and old attempt pointers", async () => {
    for (const change of ["missing", "source", "sparse", "attempt", "geometry"]) {
      const row = detector();
      if (change === "missing") row.progress.summary.weightsSha256 = "";
      if (change === "source") row.progress.summary.sourceChecksum = "d".repeat(64);
      if (change === "sparse") row.progress.summary.sampleFps = 2;
      if (change === "attempt") row.progress.artifacts[0]!.key = "inference/ball-detect/1/detections.json";
      if (change === "geometry") row.progress.summary.imageWidth = 0;
      mockPrisma.visionJob.findFirst.mockResolvedValue(row);
      await expect(service.enqueueForAsset({ type: "ball_trajectory", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: change === "sparse" ? "BallDetectionsTooSparse" : "BallDetectionsMissing" } });
    }
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });
  it("refuses GPU routing, invalid algorithm settings and overlapping camera windows", async () => {
    await expect(service.enqueueForAsset({ type: "ball_trajectory", videoAssetId: ASSET, resourceClass: "gpu_24gb" })).rejects.toMatchObject({ response: { error: "BallTrajectoryCpuOnly" } });
    for (const params of [{ trajectoryConfig: { minConfidence: NaN } }, { trajectoryConfig: { maxImageSpeedPerSecond: 0 } }, { trajectoryConfig: { unrecognised: true } }, { chunkMs: 1 }])
      await expect(service.enqueueForAsset({ type: "ball_trajectory", videoAssetId: ASSET, params })).rejects.toMatchObject({ response: { error: "InvalidBallTrajectoryConfig" } });
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: "a", startMs: 0, endMs: 160, kind: "live_play" }, { id: "b", startMs: 80, endMs: 200, kind: "live_play" }]);
    await expect(service.enqueueForAsset({ type: "ball_trajectory", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "InvalidBallCameraSegments" } });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });
  it("allows no camera declarations but never invents live play at enqueue", async () => {
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([]);
    await service.enqueueForAsset({ type: "ball_trajectory", videoAssetId: ASSET });
    expect(enqueued().inputSpec.segments).toEqual([]);
  });
  it("preflights the pinned detect run without a queue write, an audit row or an object key", async () => {
    const result = await service.ballTrajectoryPreflight(ASSET, "ball-detect");
    expect(result).toMatchObject({ videoAssetId: ASSET, ready: true, detectJobId: "ball-detect", detectorVersionId: MODEL_VERSION, cameraSegments: 1 });
    expect(JSON.stringify(result)).not.toMatch(/inference\/|readKeys|detections\.json/);
    expect(mockPrisma.visionJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { videoAssetId: ASSET, type: "detect", state: "succeeded", id: "ball-detect" } }));
    expect(mockQueue.enqueue).not.toHaveBeenCalled(); expect(mockAudit.record).not.toHaveBeenCalled();
  });
  it.each(["missing", "source", "sparse", "attempt", "geometry", "segments", "rights", "prerequisite", "unlinked", "unknown"])("preflight and enqueue share the first ball refusal: %s", async (change) => {
    const row = detector();
    if (change === "missing") row.progress.summary.weightsSha256 = "";
    if (change === "source") row.progress.summary.sourceChecksum = "d".repeat(64);
    if (change === "sparse") row.progress.summary.sampleFps = 2;
    if (change === "attempt") row.progress.artifacts[0]!.key = "inference/ball-detect/1/detections.json";
    if (change === "geometry") row.progress.summary.imageWidth = 0;
    mockPrisma.visionJob.findFirst.mockResolvedValue(row);
    if (change === "segments") mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: "a", startMs: 0, endMs: 160, kind: "live_play" }, { id: "b", startMs: 80, endMs: 200, kind: "live_play" }]);
    if (change === "rights") mockRights.canAnalyze.mockResolvedValue({ allowed: false, reason: "revoked", remediation: "Renew the licence." });
    if (change === "prerequisite") mockPrisma.visionJob.findMany.mockResolvedValue([]);
    if (change === "unlinked") mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, sbMatchId: null, checksumSha256: hash, durationMs: 200 });
    if (change === "unknown") mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(null);
    const result = await service.ballTrajectoryPreflight(ASSET);
    if (result.ready) throw new Error("Unexpected ready result");
    expect(result.blocker.remediation).not.toBe("");
    expect(result.blocker.error).toBe(({ missing: "BallDetectionsMissing", source: "BallDetectionsMissing", sparse: "BallDetectionsTooSparse", attempt: "BallDetectionsMissing", geometry: "BallDetectionsMissing", segments: "InvalidBallCameraSegments", rights: "RightsDenied", prerequisite: "PrerequisiteMissing", unlinked: "AssetNotLinked", unknown: "AssetUnknown" } as Record<string, string>)[change]);
    await expect(service.enqueueForAsset({ type: "ball_trajectory", videoAssetId: ASSET })).rejects.toMatchObject({ status: result.blocker.statusCode, response: { error: result.blocker.error, message: result.blocker.message } });
    expect(mockQueue.enqueue).not.toHaveBeenCalled(); expect(mockAudit.record).not.toHaveBeenCalled();
  });
  it("propagates a server failure and refuses an ambiguous selection before reading anything", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockRejectedValue(new Error("DB unavailable"));
    await expect(service.ballTrajectoryPreflight(ASSET)).rejects.toThrow("DB unavailable");
    mockPrisma.visionVideoAsset.findUnique.mockClear();
    for (const id of ["", " ", ["a", "b"], "a,b", "x".repeat(101)])
      await expect(service.ballTrajectoryPreflight(ASSET, id as never)).rejects.toMatchObject({ status: 400, response: { error: "InvalidPreflightSelection" } });
    expect(mockPrisma.visionVideoAsset.findUnique).not.toHaveBeenCalled();
  });
});

describe("camera motion is pinned to the current proxy's bytes", () => {
  const checksum = "A".repeat(64);
  const transcode = (over: Record<string, unknown> = {}) => ({ progress: { summary: { proxy: { key: "proxy.mp4", checksumSha256: checksum } }, artifacts: [{ key: "proxy.mp4", role: "proxy" }] }, ...over });
  beforeEach(() => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, sbMatchId: "match-1", ingestState: "ready", checksumSha256: "b".repeat(64), durationMs: 49706 });
    mockPrisma.visionJob.findMany.mockResolvedValue([{ type: "transcode" }]);
    mockPrisma.visionVideoVariant.findFirst.mockResolvedValue({ id: "proxy", objectKey: "proxy.mp4", fps: 25, sourceOffsetMs: 0 });
    mockPrisma.visionJob.findFirst.mockResolvedValue(transcode());
  });

  it("queues on CPU with the proxy checksum and the source's end, owned by the control plane", async () => {
    await service.enqueueForAsset({ type: "camera_motion", videoAssetId: ASSET, params: { proxyChecksum: "forged", sourceDurationMs: 1, chunkMs: 30000 } });
    const job = enqueued();
    expect(job.resourceClass).toBe("cpu_small");
    expect(job.modelVersionId).toBeNull();
    expect(job.inputSpec).toMatchObject({ proxyChecksum: "a".repeat(64), sourceDurationMs: 49706, proxy: { fps: 25, sourceOffsetMs: 0 }, chunkMs: 30000 });
    expect(job.inputSpec.readKeys).toBeUndefined();
  });

  it("refuses a proxy no completed transcode vouches for, and footage of unknown length", async () => {
    mockPrisma.visionJob.findFirst.mockResolvedValue(transcode({ progress: { summary: { proxy: { key: "older.mp4", checksumSha256: checksum } }, artifacts: [{ key: "older.mp4", role: "proxy" }] } }));
    await expect(service.enqueueForAsset({ type: "camera_motion", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "ProxyUnpinned" } });
    mockPrisma.visionJob.findFirst.mockResolvedValue(null);
    await expect(service.enqueueForAsset({ type: "camera_motion", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "ProxyUnpinned" } });
    mockPrisma.visionJob.findFirst.mockResolvedValue(transcode());
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, sbMatchId: "match-1", ingestState: "ready", checksumSha256: "b".repeat(64), durationMs: null });
    await expect(service.enqueueForAsset({ type: "camera_motion", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "AssetDurationUnknown" } });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });

  it("refuses bad knobs and a GPU at the door", async () => {
    for (const params of [{ chunkMs: 5 }, { cameraMotionConfig: { minInliers: 2 } }, { cameraMotionConfig: { minShotMs: 1.5 } }, { cameraMotionConfig: { other: 1 } }, { cameraMotionConfig: [] }])
      await expect(service.enqueueForAsset({ type: "camera_motion", videoAssetId: ASSET, params })).rejects.toMatchObject({ response: { error: "InvalidCameraMotionConfig" } });
    await expect(service.enqueueForAsset({ type: "camera_motion", videoAssetId: ASSET, resourceClass: "gpu_24gb" })).rejects.toMatchObject({ response: { error: "CameraMotionCpuOnly" } });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });
});

describe("calibrate carries a person's calibrations along the pinned motion", () => {
  const checksum = "a".repeat(64);
  const transcode = { progress: { summary: { proxy: { key: "proxy.mp4", checksumSha256: checksum } }, artifacts: [{ key: "proxy.mp4", role: "proxy" }] } };
  const motion = (over: Record<string, unknown> = {}) => ({ id: "motion", attemptNumber: 1, progress: {
    summary: { calculationVersion: "camera-motion/v1", proxyChecksum: checksum, chunks: 1, indexChecksum: "C".repeat(64) },
    artifacts: [{ key: "inference/motion/1/camera-motion.json", bucket: "derived", role: "camera_motion" }, { key: "inference/motion/1/motion/motion-0000.jsonl", bucket: "derived", role: "camera_motion_chunk" }] }, ...over });
  const cal = (id: string, frameIndex: number | null, over: object = {}) => ({ id, frameIndex, quality: "good", thresholdsVersion: "t", homography: [0.1, 0, -5, 0, 0.2, -10, 0, 0, 1],
    points: [{ landmark: "a", px: 100, py: 200, frameIndex }], pitchLengthM: 105, pitchWidthM: 68, createdAt: new Date("2026-10-08T12:00:00Z"), ...over });
  beforeEach(() => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, sbMatchId: "match-1", ingestState: "ready", checksumSha256: "b".repeat(64), durationMs: 49706 });
    mockPrisma.visionJob.findMany.mockImplementation(({ where }: { where: { type?: string } }) => Promise.resolve(where?.type === "camera_motion" ? [motion()] : [{ type: "camera_motion" }]));
    mockPrisma.visionJob.findFirst.mockResolvedValue(transcode);
    mockPrisma.visionVideoVariant.findFirst.mockResolvedValue({ id: "proxy", objectKey: "proxy.mp4", fps: 25, sourceOffsetMs: 0 });
    (mockPrisma.visionVideoVariant as Record<string, ReturnType<typeof vi.fn>>).findUnique = vi.fn().mockResolvedValue({ createdAt: new Date("2026-10-08T10:00:00Z") });
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([
      { id: "shot-1", startMs: 0, endMs: 4120, kind: "live_play", calibrations: [cal("k90", 90), cal("k10", 10)] },
      { id: "shot-2", startMs: 4120, endMs: 14360, kind: "live_play", calibrations: [cal("whole", null)] },
      { id: "shot-3", startMs: 14360, endMs: 26000, kind: "unknown", calibrations: [] },
    ]);
  });

  it("pins the motion measured on this proxy and every segment's current calibrations, owned by the control plane", async () => {
    await service.enqueueForAsset({ type: "calibrate", videoAssetId: ASSET, params: { cameraMotion: { indexKey: "forged" }, segments: [], reachMs: 5000 } });
    const job = enqueued();
    expect(job.resourceClass).toBe("cpu_small");
    expect(job.modelVersionId).toBeNull();
    expect(job.inputSpec.cameraMotion).toEqual({ jobId: "motion", indexKey: "inference/motion/1/camera-motion.json", indexChecksum: "c".repeat(64) });
    expect(job.inputSpec.readKeys).toEqual([{ bucket: "derived", key: "inference/motion/1/camera-motion.json" }, { bucket: "derived", key: "inference/motion/1/motion/motion-0000.jsonl" }]);
    expect(job.inputSpec.reachMs).toBe(5000);
    const [one, two, three] = job.inputSpec.segments;
    expect(one.calibrations.map((c: { calibrationId: string; frameIndex: number }) => [c.calibrationId, c.frameIndex])).toEqual([["k90", 90], ["k10", 10]]);
    expect(two.calibrations).toHaveLength(1);
    expect(two.calibrations[0]).toMatchObject({ calibrationId: "whole", frameIndex: null, pitch: { lengthM: 105, widthM: 68 }, points: [{ px: 100, py: 200 }] });
    expect(three.calibrations).toEqual([]);
  });

  it("refuses without motion on the current proxy, with nothing to carry, or with a calibration older than the proxy", async () => {
    mockPrisma.visionJob.findMany.mockImplementation(({ where }: { where: { type?: string } }) => Promise.resolve(where?.type === "camera_motion"
      ? [motion({ progress: { ...motion().progress, summary: { ...motion().progress.summary, proxyChecksum: "f".repeat(64) } } })] : [{ type: "camera_motion" }]));
    await expect(service.enqueueForAsset({ type: "calibrate", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "CameraMotionMissing" } });
    mockPrisma.visionJob.findMany.mockImplementation(({ where }: { where: { type?: string } }) => Promise.resolve(where?.type === "camera_motion"
      ? [motion({ attemptNumber: 2 })] : [{ type: "camera_motion" }]));
    await expect(service.enqueueForAsset({ type: "calibrate", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "CameraMotionMissing" } });
    mockPrisma.visionJob.findMany.mockImplementation(({ where }: { where: { type?: string } }) => Promise.resolve(where?.type === "camera_motion" ? [motion()] : [{ type: "camera_motion" }]));
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: "shot-3", startMs: 0, endMs: 1000, kind: "unknown", calibrations: [] }]);
    await expect(service.enqueueForAsset({ type: "calibrate", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "NoCalibration" } });
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: "s", startMs: 0, endMs: 1000, kind: "live_play", calibrations: [cal("old", 3, { createdAt: new Date("2026-10-01") })] }]);
    await expect(service.enqueueForAsset({ type: "calibrate", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "CalibrationPredatesProxy" } });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });

  it("refuses a GPU, a model and knobs out of range at the door", async () => {
    await expect(service.enqueueForAsset({ type: "calibrate", videoAssetId: ASSET, resourceClass: "gpu_24gb" })).rejects.toMatchObject({ response: { error: "CalibrateCpuOnly" } });
    for (const params of [{ reachMs: 10 }, { reachMs: 1.5e5 }, { chunkMs: 1 }])
      await expect(service.enqueueForAsset({ type: "calibrate", videoAssetId: ASSET, params })).rejects.toMatchObject({ response: { error: "InvalidCalibrateConfig" } });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });
});

describe("possession candidates require compatible, pinned ball and player evidence", () => {
  const sourceHash = "a".repeat(64), proxyHash = "b".repeat(64), detectionsHash = "c".repeat(64), ballHash = "d".repeat(64), trackHash = "e".repeat(64);
  const segments = [{ cameraSegmentId: "cam", startMs: 0, endMs: 200, kind: "live_play" }];
  const rows = () => ({
    ball: { id: "ball", attemptNumber: 2, inputSpec: { sourceChecksum: sourceHash, sourceDurationMs: 200, proxyChecksum: proxyHash, proxyDurationMs: 240, imageWidth: 1280, imageHeight: 720, proxy: { fps: 25, sourceOffsetMs: 0 }, segments, detections: { jobId: "detect", modelVersionId: MODEL_VERSION } },
      progress: { artifacts: [{ key: "inference/ball/2/index.json", bucket: "derived", role: "ball_trajectory" }, { key: "inference/ball/2/chunk.jsonl", bucket: "derived", role: "ball_trajectory_chunk" }],
        summary: { calculationVersion: "ball-trajectory/v1", chunks: 1, frames: 5, observed: 2, lost: 3, windowStartMs: 0, windowEndMs: 200, sourceChecksum: sourceHash, indexChecksum: ballHash, detectionsChecksum: detectionsHash, detectorJobId: "detect", detectorVersionId: MODEL_VERSION } } },
    track: { id: "track", attemptNumber: 1, modelVersionId: "tracker", progress: {
      artifacts: [{ key: "inference/track/1/tracks.json", bucket: "derived", role: "tracks" }], summary: { trackerVersionId: "tracker", sourceChecksum: sourceHash, proxyChecksum: proxyHash, detectionsChecksum: detectionsHash, tracksChecksum: trackHash,
        detectJobId: "detect", detectorVersionId: MODEL_VERSION, imageWidth: 1280, imageHeight: 720, proxyDurationMs: 240, sampleFps: 25, proxy: { fps: 25, sourceOffsetMs: 0 }, cameraCuts: [] as number[] } } },
  });
  function install(r = rows()) {
    mockPrisma.visionJob.findFirst.mockImplementation(({ where }) => Promise.resolve(where.type === "ball_trajectory" ? r.ball : r.track));
    return r;
  }
  beforeEach(() => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, sbMatchId: "match", checksumSha256: sourceHash, durationMs: 200 });
    mockPrisma.visionJob.findMany.mockResolvedValue([{ type: "ball_trajectory" }, { type: "track" }]);
    mockPrisma.visionVideoVariant.findFirst.mockResolvedValue({ fps: 25, sourceOffsetMs: 0 });
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: "cam", startMs: 0, endMs: 200, kind: "live_play" }]);
    install();
  });
  it("owns all object keys and provenance and queues on CPU without a new model", async () => {
    await service.enqueueForAsset({ type: "possession", videoAssetId: ASSET, params: { ballJobId: "ball", trackJobId: "track", ball: { key: "forged" }, detectionsChecksum: "forged", tracks: { key: "forged" }, readKeys: [{ bucket: "master", key: "forged" }] } });
    const job = enqueued();
    expect(job.resourceClass).toBe("cpu_small"); expect(job.modelVersionId).toBeNull();
    expect(job.inputSpec).toMatchObject({ sourceChecksum: sourceHash, detectionsChecksum: detectionsHash, detectorJobId: "detect", segments, proxy: { fps: 25, sourceOffsetMs: 0 },
      ball: { jobId: "ball", key: "inference/ball/2/index.json", indexChecksum: ballHash, chunkKeys: ["inference/ball/2/chunk.jsonl"] },
      tracks: { jobId: "track", key: "inference/track/1/tracks.json", checksum: trackHash } });
    expect(job.inputSpec.readKeys).toEqual([{ bucket: "derived", key: "inference/ball/2/index.json" }, { bucket: "derived", key: "inference/ball/2/chunk.jsonl" }, { bucket: "derived", key: "inference/track/1/tracks.json" }]);
  });
  it("reads the ball run's segments as Postgres returns them: its own key order, the same evidence", async () => {
    const r = rows();
    r.ball.inputSpec.segments = [{ kind: "live_play", endMs: 200, startMs: 0, cameraSegmentId: "cam" }];
    install(r);
    await service.enqueueForAsset({ type: "possession", videoAssetId: ASSET });
    expect(enqueued().inputSpec.segments).toEqual(segments);
    r.ball.inputSpec.segments = [{ kind: "live_play", endMs: 199, startMs: 0, cameraSegmentId: "cam" }];
    await expect(service.enqueueForAsset({ type: "possession", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "PossessionEvidenceMismatch" } });
  });
  it("refuses incompatible clocks, attempts, detector bytes, geometry, source, weights lineage and camera changes", async () => {
    for (const change of ["source", "clock", "attempt", "detections", "geometry", "detector", "tracker", "sparse", "hash", "window", "chunks"]) {
      const r = rows();
      if (change === "source") r.track.progress.summary.sourceChecksum = "f".repeat(64);
      if (change === "clock") r.track.progress.summary.proxy.sourceOffsetMs = 1;
      if (change === "attempt") r.ball.progress.artifacts[0]!.key = "inference/ball/1/index.json";
      if (change === "detections") r.track.progress.summary.detectionsChecksum = "f".repeat(64);
      if (change === "geometry") r.track.progress.summary.imageWidth = 99;
      if (change === "detector") r.track.progress.summary.detectJobId = "other";
      if (change === "tracker") r.track.modelVersionId = "other";
      if (change === "sparse") r.track.progress.summary.sampleFps = 2;
      if (change === "hash") r.track.progress.summary.tracksChecksum = "";
      if (change === "window") r.ball.progress.summary.windowEndMs = 240;
      if (change === "chunks") r.ball.progress.summary.chunks = 2;
      install(r);
      await expect(service.enqueueForAsset({ type: "possession", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "PossessionEvidenceMismatch" } });
    }
    install();
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: "cam", startMs: 0, endMs: 200, kind: "replay" }]);
    await expect(service.enqueueForAsset({ type: "possession", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "PossessionEvidenceMismatch" } });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });
  it("refuses unsupported configuration and GPU overrides", async () => {
    for (const params of [{ possessionConfig: { minBallConfidence: true } }, { possessionConfig: { minContinuityMs: 0 } }, { possessionConfig: { maxFootDistanceHeights: 1 } }, { possessionConfig: { unrecognised: true } }, { chunkMs: 1 }])
      await expect(service.enqueueForAsset({ type: "possession", videoAssetId: ASSET, params })).rejects.toMatchObject({ response: { error: "InvalidPossessionConfig" } });
    await expect(service.enqueueForAsset({ type: "possession", videoAssetId: ASSET, resourceClass: "gpu_24gb" })).rejects.toMatchObject({ response: { error: "PossessionCpuOnly" } });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });
  it("requires the tracker to have broken at a camera boundary in the pinned ball snapshot", async () => {
    const r = rows();
    r.ball.inputSpec.segments = [{ cameraSegmentId: "a", startMs: 0, endMs: 80, kind: "live_play" }, { cameraSegmentId: "b", startMs: 80, endMs: 200, kind: "live_play" }];
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: "a", startMs: 0, endMs: 80, kind: "live_play" }, { id: "b", startMs: 80, endMs: 200, kind: "live_play" }]);
    install(r);
    await expect(service.enqueueForAsset({ type: "possession", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "PossessionEvidenceMismatch" } });
    r.track.progress.summary.cameraCuts = [80];
    await service.enqueueForAsset({ type: "possession", videoAssetId: ASSET });
    expect(enqueued().inputSpec.segments).toEqual(r.ball.inputSpec.segments);
  });
  it("continues to enforce rights and stage prerequisites", async () => {
    mockRights.canAnalyze.mockResolvedValue({ allowed: false, reason: "revoked" });
    await expect(service.enqueueForAsset({ type: "possession", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "RightsDenied" } });
    mockRights.canAnalyze.mockResolvedValue({ allowed: true });
    mockPrisma.visionJob.findMany.mockResolvedValue([{ type: "track" }]);
    await expect(service.enqueueForAsset({ type: "possession", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "PrerequisiteMissing" } });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });
  it("owns calibrated evidence and ignores caller-supplied matrices", async () => {
    const r = rows();
    mockPrisma.visionJob.findFirst.mockImplementation(({ where }) => Promise.resolve(where.type === "ball_trajectory" ? r.ball : where.type === "track" ? r.track : { progress: { summary: { proxy: { key: "proxy.mp4", checksumSha256: proxyHash } }, artifacts: [{ key: "proxy.mp4", role: "proxy" }] } }));
    mockPrisma.visionVideoVariant.findFirst.mockResolvedValue({ id: "proxy", objectKey: "proxy.mp4", width: 1280, height: 720, fps: 25, sourceOffsetMs: 0, createdAt: new Date("2026-10-01") });
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: "cam", startMs: 0, endMs: 200, kind: "live_play", calibrations: [] }]);
    await service.enqueueForAsset({ type: "possession", videoAssetId: ASSET, params: { constraintMode: "calibrated", calibrationSnapshot: { homography: "forged" } } });
    expect(enqueued().inputSpec).toMatchObject({ constraintMode: "calibrated", calibrationSnapshot: { proxyVariantId: "proxy", proxyChecksum: proxyHash, segments: [{ calibrationId: null, quality: null, homography: null }] } });
  });
  it("refuses unrecorded geometry, unsupported modes and out-of-range football limits", async () => {
    await expect(service.enqueueForAsset({ type: "possession", videoAssetId: ASSET, params: { constraintMode: "calibrated" } })).rejects.toMatchObject({ response: { error: "PossessionCalibrationGeometryMissing" } });
    for (const params of [{ constraintMode: "guess" }, { constraintMode: "image", calibrationSnapshot: {} }, { footballConfig: {} }, { constraintMode: "calibrated", footballConfig: { maxGroundDistanceM: 10 } }, { constraintMode: "calibrated", footballConfig: { maxPlayerSpeedMps: true } }])
      await expect(service.enqueueForAsset({ type: "possession", videoAssetId: ASSET, params })).rejects.toMatchObject({ response: { error: "InvalidPossessionConfig" } });
  });

  describe("calibrated possession preflight", () => {
    const calibration = (createdAt = new Date("2026-10-02")) => ({ id: "cal", quality: "good", thresholdsVersion: "provisional/v1", homography: [0.1, 0, 0, 0, 0.1, 0, 0, 0, 1], points: [], pitchLengthM: 105, pitchWidthM: 68, createdAt });
    function calibrated(r = rows(), calibrations: unknown[] = [calibration()]) {
      mockPrisma.visionJob.findFirst.mockImplementation(({ where }) => Promise.resolve(where.type === "ball_trajectory" ? r.ball : where.type === "track" ? r.track : { progress: { summary: { proxy: { key: "proxy.mp4", checksumSha256: proxyHash } }, artifacts: [{ key: "proxy.mp4", role: "proxy" }] } }));
      mockPrisma.visionVideoVariant.findFirst.mockResolvedValue({ id: "proxy", objectKey: "proxy.mp4", width: 1280, height: 720, fps: 25, sourceOffsetMs: 0, createdAt: new Date("2026-10-01") });
      mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: "cam", startMs: 0, endMs: 200, kind: "live_play", calibrations }]);
      return r;
    }
    it("names the ball and track runs and counts calibrated windows, with no write and no key", async () => {
      calibrated();
      const result = await service.possessionPreflight(ASSET, "ball", "track");
      expect(result).toMatchObject({ ready: true, ballJobId: "ball", trackJobId: "track", constraintMode: "calibrated", cameraSegments: 1, calibratedSegments: 1 });
      expect(JSON.stringify(result)).not.toMatch(/inference\/|proxy\.mp4|readKeys|homography/);
      expect(mockPrisma.visionJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ type: "ball_trajectory", id: "ball" }) }));
      expect(mockPrisma.visionJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ type: "track", id: "track" }) }));
      expect(mockQueue.enqueue).not.toHaveBeenCalled(); expect(mockAudit.record).not.toHaveBeenCalled();
    });
    it("is ready with no passing calibration, exactly as the queue is, and says so in the count", async () => {
      calibrated(rows(), []);
      expect(await service.possessionPreflight(ASSET)).toMatchObject({ ready: true, cameraSegments: 1, calibratedSegments: 0 });
      calibrated(rows(), [{ ...calibration(), quality: "failed" }]);
      expect(await service.possessionPreflight(ASSET)).toMatchObject({ ready: true, calibratedSegments: 0 });
    });
    it.each(["geometry", "unpinned proxy", "old calibration", "snapshot proxy", "source", "clock", "camera", "tracker", "rights", "prerequisite", "unlinked"])("preflight and calibrated enqueue share the first refusal: %s", async (change) => {
      const r = calibrated(rows(), change === "old calibration" ? [calibration(new Date("2026-09-01"))] : [calibration()]);
      if (change === "geometry") mockPrisma.visionVideoVariant.findFirst.mockResolvedValue({ id: "proxy", objectKey: "proxy.mp4", width: null, height: 720, fps: 25, sourceOffsetMs: 0, createdAt: new Date("2026-10-01") });
      if (change === "unpinned proxy") mockPrisma.visionVideoVariant.findFirst.mockResolvedValue({ id: "proxy", objectKey: "other.mp4", width: 1280, height: 720, fps: 25, sourceOffsetMs: 0, createdAt: new Date("2026-10-01") });
      if (change === "snapshot proxy") { r.ball.inputSpec.proxyChecksum = "f".repeat(64); r.track.progress.summary.proxyChecksum = "f".repeat(64); }
      if (change === "source") r.track.progress.summary.sourceChecksum = "f".repeat(64);
      if (change === "clock") r.track.progress.summary.proxy.sourceOffsetMs = 1;
      if (change === "camera") mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: "cam", startMs: 0, endMs: 200, kind: "replay", calibrations: [] }]);
      if (change === "tracker") r.track.modelVersionId = "other";
      if (change === "rights") mockRights.canAnalyze.mockResolvedValue({ allowed: false, reason: "revoked", remediation: "Renew the licence." });
      if (change === "prerequisite") mockPrisma.visionJob.findMany.mockResolvedValue([{ type: "track" }]);
      if (change === "unlinked") mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, sbMatchId: null, checksumSha256: sourceHash, durationMs: 200 });
      const result = await service.possessionPreflight(ASSET);
      if (result.ready) throw new Error("Unexpected ready result");
      expect(result.blocker.error).toBe(({ geometry: "PossessionCalibrationGeometryMissing", "unpinned proxy": "PossessionCalibrationProxyUnpinned", "old calibration": "PossessionCalibrationPredatesProxy", "snapshot proxy": "PossessionEvidenceMismatch", source: "PossessionEvidenceMismatch", clock: "PossessionEvidenceMismatch", camera: "PossessionEvidenceMismatch", tracker: "PossessionEvidenceMismatch", rights: "RightsDenied", prerequisite: "PrerequisiteMissing", unlinked: "AssetNotLinked" } as Record<string, string>)[change]);
      await expect(service.enqueueForAsset({ type: "possession", videoAssetId: ASSET, params: { constraintMode: "calibrated" } })).rejects.toMatchObject({ status: result.blocker.statusCode, response: { error: result.blocker.error, message: result.blocker.message } });
      expect(mockQueue.enqueue).not.toHaveBeenCalled(); expect(mockAudit.record).not.toHaveBeenCalled();
    });
    it("checks calibrated mode only, even where image mode would pass", async () => {
      install();
      expect(await service.possessionPreflight(ASSET)).toMatchObject({ ready: false, blocker: { error: "PossessionCalibrationGeometryMissing" } });
      await service.enqueueForAsset({ type: "possession", videoAssetId: ASSET });
      expect(enqueued().inputSpec.constraintMode).toBeUndefined();
    });
    it("propagates a server failure and refuses an ambiguous selection", async () => {
      mockPrisma.visionJob.findFirst.mockRejectedValue(new Error("DB unavailable"));
      await expect(service.possessionPreflight(ASSET)).rejects.toThrow("DB unavailable");
      await expect(service.possessionPreflight(ASSET, ["a", "b"] as never)).rejects.toMatchObject({ status: 400, response: { error: "InvalidPreflightSelection" } });
      await expect(service.possessionPreflight(ASSET, undefined, "a,b")).rejects.toMatchObject({ status: 400, response: { error: "InvalidPreflightSelection" } });
    });
  });
});

describe("an identify job is given the track artifact it assigns teams on", () => {
  const IDENTIFY = "55556666-7777-4888-9999-aaaabbbbeeee";
  const TRACKER = "55556666-7777-4888-9999-aaaabbbbcccc";

  beforeEach(() => {
    mockPrisma.visionJob.findMany.mockResolvedValue([{ type: "probe" }, { type: "fingerprint" }, { type: "transcode" }, { type: "detect" }, { type: "track" }]);
    mockModels.resolveForJob.mockResolvedValue({ id: IDENTIFY, task: "identify" });
    mockPrisma.visionJob.findFirst.mockResolvedValue({
      id: "job-t", modelVersionId: TRACKER,
      progress: { artifacts: [{ key: "inference/job-t/1/tracks.json", bucket: "derived", role: "tracks" }] },
    });
  });

  it("declares the latest succeeded track artifact, the tracker that made it, and the proxy clock", async () => {
    await service.enqueueForAsset({ type: "identify", videoAssetId: ASSET });
    const spec = enqueued().inputSpec;
    expect(spec.tracks).toEqual({ jobId: "job-t", key: "inference/job-t/1/tracks.json", trackerVersionId: TRACKER });
    expect(spec.readKeys).toEqual([{ bucket: "derived", key: "inference/job-t/1/tracks.json" }]);
    expect(spec.proxy).toEqual({ fps: 25, sourceOffsetMs: 9000 });
    expect(enqueued().modelVersionId).toBe(IDENTIFY);
    expect(mockPrisma.visionJob.findFirst.mock.calls[0]![0].where).toMatchObject({ type: "track", state: "succeeded" });
  });

  it("refuses when no succeeded track job carries an artifact", async () => {
    mockPrisma.visionJob.findFirst.mockResolvedValue(null);
    await expect(service.enqueueForAsset({ type: "identify", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "TracksMissing" } });
  });
});

describe("a gamestate job is given the tracks, the calibrations and the clock", () => {
  const TRACKER = "55556666-7777-4888-9999-aaaabbbbcccc";
  const H = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  beforeEach(() => {
    mockPrisma.visionJob.findMany.mockResolvedValue([{ type: "probe" }, { type: "fingerprint" }, { type: "transcode" }, { type: "detect" }, { type: "track" }]);
    mockPrisma.visionJob.findFirst.mockResolvedValue({ id: "job-t", modelVersionId: TRACKER, progress: { artifacts: [{ key: "inference/job-t/1/tracks.json", bucket: "derived", role: "tracks" }] } });
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([
      { id: "seg-1", startMs: 9000, endMs: 60000, calibrations: [{ quality: "good", homography: H, pitchLengthM: 105, pitchWidthM: 68 }] },
      { id: "seg-2", startMs: 60001, endMs: 120000, calibrations: [] },
      { id: "seg-3", startMs: 120001, endMs: 180000, calibrations: [{ quality: "failed", homography: H, pitchLengthM: 100, pitchWidthM: 64 }] },
    ]);
    mockPrisma.visionClockAnchor.findMany.mockResolvedValue([{ half: 1, sourceMs: 9000, endMs: null }]);
  });

  it("declares the track artifact, every segment with its calibration where one exists, and the anchors", async () => {
    await service.enqueueForAsset({ type: "gamestate", videoAssetId: ASSET, params: { chunkMs: 30000 } });
    const spec = enqueued().inputSpec;
    expect(spec.tracks).toEqual({ jobId: "job-t", key: "inference/job-t/1/tracks.json", trackerVersionId: TRACKER });
    expect(spec.readKeys).toEqual([{ bucket: "derived", key: "inference/job-t/1/tracks.json" }]);
    expect(spec.segments).toEqual([
      { cameraSegmentId: "seg-1", startMs: 9000, endMs: 60000, quality: "good", homography: H, pitch: { lengthM: 105, widthM: 68 } },
      { cameraSegmentId: "seg-2", startMs: 60001, endMs: 120000, quality: null, homography: null, pitch: null },
      { cameraSegmentId: "seg-3", startMs: 120001, endMs: 180000, quality: "failed", homography: H, pitch: { lengthM: 100, widthM: 64 } },
    ]);
    expect(spec.anchors).toEqual([{ half: 1, sourceMs: 9000, endMs: null }]);
    // Every current calibration: whole ones for still cameras, keyframes for moving ones (docs/vision/94).
    expect(mockPrisma.visionCameraSegment.findMany.mock.calls[0]![0].include.calibrations).toEqual({ where: { supersededBy: null, withdrawnAt: null }, orderBy: { createdAt: "desc" } });
    expect(spec).not.toHaveProperty("carried");
    expect(spec.chunkMs).toBe(30000);
    expect(spec.proxy).toEqual({ fps: 25, sourceOffsetMs: 9000 });
    expect(enqueued().modelVersionId).toBeNull();
    expect(mockPrisma.visionClockAnchor.findMany.mock.calls[0]![0].where).toEqual({ videoAssetId: ASSET, supersededBy: null });
  });

  it("declares each homography signed by its own clicked points, so the stage can tell the horizon", async () => {
    // w = 1 - y/100 at a pixel. The clicks are at y = 300 and 400: on the negative side as stored.
    const stored = [1, 0, 0, 0, 1, 0, 0, -0.01, 1];
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([
      { id: "seg-1", startMs: 0, endMs: 60000, calibrations: [{ quality: "good", homography: stored, points: [{ landmark: "a", px: 10, py: 300 }, { landmark: "b", px: 50, py: 400 }], pitchLengthM: 105, pitchWidthM: 68 }] },
      { id: "seg-2", startMs: 60000, endMs: 90000, calibrations: [{ quality: "good", homography: stored, points: [{ landmark: "a", px: 10, py: 30 }, { landmark: "b", px: 50, py: 40 }], pitchLengthM: 105, pitchWidthM: 68 }] },
    ]);
    await service.enqueueForAsset({ type: "gamestate", videoAssetId: ASSET });
    const [first, second] = enqueued().inputSpec.segments;
    expect(first.homography).toEqual(stored.map((v) => -v));
    expect(second.homography).toEqual(stored);
  });

  describe("a moving camera's segment", () => {
    const prefix = visionKeys.inferencePrefix("job-c", 1);
    const keyframe = (id: string, frameIndex: number) => ({ id, frameIndex, quality: "good", thresholdsVersion: "t", homography: H, points: [], pitchLengthM: 100, pitchWidthM: 64 });
    function withRun(run: boolean) {
      mockPrisma.visionVideoVariant.findFirst.mockResolvedValue({ id: "proxy", objectKey: "proxy.mp4", fps: 25, sourceOffsetMs: 9000 });
      mockPrisma.visionCameraSegment.findMany.mockResolvedValue([
        { id: "seg-1", startMs: 9000, endMs: 60000, kind: "live_play", calibrations: [{ id: "w", frameIndex: null, quality: "good", homography: H, points: [], pitchLengthM: 105, pitchWidthM: 68 }] },
        { id: "seg-2", startMs: 60000, endMs: 90000, kind: "live_play", calibrations: [keyframe("k2", 1900), keyframe("k1", 1600)] },
      ]);
      mockPrisma.visionJob.findFirst.mockImplementation(({ where }: { where: { type: string } }) => Promise.resolve(
        where.type === "track" ? { id: "job-t", modelVersionId: TRACKER, progress: { artifacts: [{ key: "inference/job-t/1/tracks.json", bucket: "derived", role: "tracks" }] } }
        : where.type === "transcode" ? { progress: { summary: { proxy: { key: "proxy.mp4", checksumSha256: "e".repeat(64) } }, artifacts: [{ role: "proxy", key: "proxy.mp4" }] } }
        : run ? { id: "job-c", attemptNumber: 1, finishedAt: new Date(),
          inputSpec: { proxyChecksum: "e".repeat(64), segments: [
            { cameraSegmentId: "seg-1", startMs: 9000, endMs: 60000, kind: "live_play", calibrations: [{ calibrationId: "w" }] },
            { cameraSegmentId: "seg-2", startMs: 60000, endMs: 90000, kind: "live_play", calibrations: [{ calibrationId: "k1" }, { calibrationId: "k2" }] }] },
          progress: { summary: { indexChecksum: "a".repeat(64), chunks: 1, calculationVersion: CALIBRATION_PROPAGATION_VERSION },
            artifacts: [{ role: CALIBRATION_FRAMES_INDEX_ROLE, bucket: "derived", key: `${prefix}index.json` }, { role: CALIBRATION_FRAMES_CHUNK_ROLE, bucket: "derived", key: `${prefix}c0.jsonl` }] } }
        : null));
    }

    it("is declared carried, naming its keyframes, with the current run pinned and readable", async () => {
      withRun(true);
      await service.enqueueForAsset({ type: "gamestate", videoAssetId: ASSET });
      const spec = enqueued().inputSpec;
      expect(spec.segments[1]).toEqual({ cameraSegmentId: "seg-2", startMs: 60000, endMs: 90000, homography: null, quality: "carried", thresholdsVersion: "t", pitch: { lengthM: 100, widthM: 64 }, keyframeIds: ["k1", "k2"] });
      expect(spec.segments[0]).toMatchObject({ quality: "good", homography: H });
      expect(spec.carried).toEqual({ jobId: "job-c", indexKey: `${prefix}index.json`, indexChecksum: "a".repeat(64), chunkKeys: [`${prefix}c0.jsonl`] });
      expect(spec.readKeys).toEqual([{ bucket: "derived", key: "inference/job-t/1/tracks.json" }, { bucket: "derived", key: `${prefix}index.json` }, { bucket: "derived", key: `${prefix}c0.jsonl` }]);
    });

    it("is uncalibrated, with nothing pinned, when no current run follows its keyframes", async () => {
      withRun(false);
      await service.enqueueForAsset({ type: "gamestate", videoAssetId: ASSET });
      const spec = enqueued().inputSpec;
      expect(spec.segments[1]).toEqual({ cameraSegmentId: "seg-2", startMs: 60000, endMs: 90000, quality: null, homography: null, pitch: null });
      expect(spec).not.toHaveProperty("carried");
      expect(spec.readKeys).toEqual([{ bucket: "derived", key: "inference/job-t/1/tracks.json" }]);
    });
  });

  it("refuses when no segment is calibrated, and when there are no tracks", async () => {
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: "seg-2", startMs: 0, endMs: 1, calibrations: [] }]);
    await expect(service.enqueueForAsset({ type: "gamestate", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "NoCalibration" } });
    mockPrisma.visionJob.findFirst.mockResolvedValue(null);
    await expect(service.enqueueForAsset({ type: "gamestate", videoAssetId: ASSET })).rejects.toMatchObject({ response: { error: "TracksMissing" } });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });
});

describe("retry re-checks rights (docs/vision/50, PR-4)", () => {
  it("refuses to retry a job on footage whose grant was withdrawn since", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue({ state: "failed", attemptNumber: 1, maxAttempts: 3, videoAssetId: ASSET });
    mockRights.canAnalyze.mockResolvedValue({ allowed: false, reason: "revoked", detail: "withdrawn", remediation: "r" });
    await expect(service.retry("job-1")).rejects.toMatchObject({ response: { error: "RightsDenied" } });
    expect(mockPrisma.visionJob.update).not.toHaveBeenCalled();
  });

  it("retries when the grant still stands", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue({ state: "failed", attemptNumber: 1, maxAttempts: 3, videoAssetId: ASSET });
    mockPrisma.visionJob.update.mockResolvedValue({});
    await service.retry("job-1");
    expect(mockPrisma.visionJob.update).toHaveBeenCalledOnce();
  });
});
