import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import { VisionBenchmarksService } from "./benchmarks.service";
import type { BenchmarkThresholds } from "./benchmark-thresholds";

/**
 * The benchmark ledger's refusals, and what a completion becomes.
 *
 * A run that could not mean anything is refused before a job is queued -- a draft
 * gold set, one person's review, no export, a gold member nobody ran the model
 * on. A completion becomes rows per slice and a verdict, and moves the version
 * one step: candidate to benchmarked, never further.
 */

const VERSION = "22222222-2222-4222-8222-222222222222";
const DATASET = "33333333-3333-4333-8333-333333333333";
const RUN = "44444444-4444-4444-8444-444444444444";
const EXPORT_KEY = `datasets/${DATASET}/export/samples.json`;

const mockPrisma = {
  visionModelVersion: { findUnique: vi.fn(), updateMany: vi.fn() },
  visionDatasetVersion: { findUnique: vi.fn() },
  visionDatasetMember: { findMany: vi.fn() },
  visionAnnotationVersion: { findMany: vi.fn() },
  visionJob: { findMany: vi.fn() },
  visionBenchmarkRun: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  visionMetricResult: { createMany: vi.fn() },
  $transaction: vi.fn(),
};
const mockAudit = { record: vi.fn() };
const mockJobs = { enqueueDetached: vi.fn() };

let store: InMemoryObjectStore;
let service: VisionBenchmarksService;

const thresholds: BenchmarkThresholds = {
  version: "test-1",
  iou: 0.5,
  minimums: {},
  criticalSlices: ["quality:platform_copy"],
  regressionMetrics: { detect: ["ap:all", "recall:ball"], track: ["idf1:all", "mota:all"] },
  regressionTolerance: 0.02,
};

function detector(over: Record<string, unknown> = {}) {
  return { id: VERSION, version: "0.1", stage: "candidate", model: { key: "detector/x", task: "detect" }, ...over };
}
function frozen(over: Record<string, unknown> = {}) {
  return { id: DATASET, label: "gold v1", frozenAt: new Date("2026-09-30"), containsRevokedMembers: false, ...over };
}
/** Two gold members, each reviewed by two people, each with a succeeded detect job. */
function readyGold() {
  mockPrisma.visionDatasetMember.findMany.mockResolvedValue([{ videoAssetId: "a1" }, { videoAssetId: "a2" }]);
  mockPrisma.visionAnnotationVersion.findMany.mockResolvedValue(
    ["a1", "a2"].map((id) => ({
      task: { videoAssetId: id },
      reviews: [{ reviewerId: "r1", decision: "approved" }, { reviewerId: "r2", decision: "approved" }],
    }))
  );
  mockPrisma.visionJob.findMany.mockResolvedValue([
    { videoAssetId: "a1", progress: { artifacts: [{ key: "inference/j1/1/detections.json", bucket: "derived", role: "detections" }] } },
    { videoAssetId: "a2", progress: { artifacts: [{ key: "inference/j2/1/detections.json", bucket: "derived", role: "detections" }] } },
  ]);
}

beforeEach(async () => {
  vi.clearAllMocks();
  store = new InMemoryObjectStore();
  service = new VisionBenchmarksService(mockPrisma as never, mockAudit as never, store, mockJobs as never, thresholds);
  mockPrisma.visionModelVersion.findUnique.mockResolvedValue(detector());
  mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(frozen());
  readyGold();
  await store.putSmallObject("derived", EXPORT_KEY, "{}", "application/json");
  mockPrisma.visionBenchmarkRun.create.mockImplementation(({ data }: never) => Promise.resolve({ id: RUN, ...(data as object) }));
  mockPrisma.visionBenchmarkRun.update.mockResolvedValue({});
  mockJobs.enqueueDetached.mockResolvedValue({ id: "job-b" });
  mockAudit.record.mockResolvedValue(undefined);
});

describe("requesting a run", () => {
  it("queues a benchmark job with every key the worker may read, and records the run", async () => {
    const run = await service.request(VERSION, DATASET);
    expect(run.id).toBe(RUN);
    expect(run.goldMembers).toBe(2);

    const [args] = mockJobs.enqueueDetached.mock.calls[0]!;
    expect(args).toMatchObject({ type: "benchmark", datasetVersionId: DATASET, modelVersionId: VERSION });
    expect(args.params).toMatchObject({
      benchmarkRunId: RUN,
      task: "detect",
      goldLabelsKey: EXPORT_KEY,
      iou: 0.5,
      predictions: [
        { videoAssetId: "a1", key: "inference/j1/1/detections.json" },
        { videoAssetId: "a2", key: "inference/j2/1/detections.json" },
      ],
    });
    expect(args.params.readKeys).toEqual([
      { bucket: "derived", key: EXPORT_KEY },
      { bucket: "derived", key: "inference/j1/1/detections.json" },
      { bucket: "derived", key: "inference/j2/1/detections.json" },
    ]);
    expect(mockPrisma.visionBenchmarkRun.create.mock.calls[0]![0].data).toMatchObject({
      modelVersionId: VERSION,
      datasetVersionId: DATASET,
      thresholdsVersion: "test-1",
      iouThreshold: 0.5,
    });
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "model.benchmark.requested", targetId: RUN }),
      undefined
    );
  });

  it("uses the latest succeeded detect job per member when there are several", async () => {
    mockPrisma.visionJob.findMany.mockResolvedValue([
      { videoAssetId: "a1", progress: { artifacts: [{ key: "inference/new/1/detections.json", bucket: "derived", role: "detections" }] } },
      { videoAssetId: "a1", progress: { artifacts: [{ key: "inference/old/1/detections.json", bucket: "derived", role: "detections" }] } },
      { videoAssetId: "a2", progress: { artifacts: [{ key: "inference/j2/1/detections.json", bucket: "derived", role: "detections" }] } },
    ]);
    await service.request(VERSION, DATASET);
    const [args] = mockJobs.enqueueDetached.mock.calls[0]!;
    expect(args.params.predictions[0]).toEqual({ videoAssetId: "a1", key: "inference/new/1/detections.json" });
  });

  it("refuses a model that is neither a detector nor a tracker", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(detector({ model: { key: "c", task: "calibrate" } }));
    await expect(service.request(VERSION, DATASET)).rejects.toMatchObject({ response: { error: "ModelTaskUnsupported" } });
  });

  it("scores a tracker against the latest track artifacts, and names who lacks one", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(detector({ model: { key: "tracker/x", task: "track" } }));
    mockPrisma.visionJob.findMany.mockResolvedValue([
      { videoAssetId: "a1", progress: { artifacts: [{ key: "inference/t1/1/tracks.json", bucket: "derived", role: "tracks" }] } },
    ]);
    await expect(service.request(VERSION, DATASET)).rejects.toMatchObject({ response: { error: "TracksMissing", members: ["a2"] } });
    expect(mockPrisma.visionJob.findMany.mock.calls[0]![0].where).toMatchObject({ type: "track" });

    mockPrisma.visionJob.findMany.mockResolvedValue([
      { videoAssetId: "a1", progress: { artifacts: [{ key: "inference/t1/1/tracks.json", bucket: "derived", role: "tracks" }] } },
      { videoAssetId: "a2", progress: { artifacts: [{ key: "inference/t2/1/tracks.json", bucket: "derived", role: "tracks" }] } },
    ]);
    await service.request(VERSION, DATASET);
    const [args] = mockJobs.enqueueDetached.mock.calls[0]!;
    expect(args.params.task).toBe("track");
    expect(args.params.predictions).toEqual([
      { videoAssetId: "a1", key: "inference/t1/1/tracks.json" },
      { videoAssetId: "a2", key: "inference/t2/1/tracks.json" },
    ]);
  });

  it("refuses an archived version", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(detector({ stage: "archived" }));
    await expect(service.request(VERSION, DATASET)).rejects.toMatchObject({ response: { error: "ModelVersionArchived" } });
  });

  it("refuses a draft dataset", async () => {
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(frozen({ frozenAt: null }));
    await expect(service.request(VERSION, DATASET)).rejects.toMatchObject({ response: { error: "DatasetNotFrozen" } });
    expect(mockJobs.enqueueDetached).not.toHaveBeenCalled();
  });

  it("refuses a dataset with revoked footage", async () => {
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(frozen({ containsRevokedMembers: true }));
    await expect(service.request(VERSION, DATASET)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses a dataset with no gold split", async () => {
    mockPrisma.visionDatasetMember.findMany.mockResolvedValue([]);
    await expect(service.request(VERSION, DATASET)).rejects.toMatchObject({ response: { error: "NoGoldMembers" } });
  });

  it("refuses gold one reviewer short", async () => {
    mockPrisma.visionAnnotationVersion.findMany.mockResolvedValue([
      { task: { videoAssetId: "a1" }, reviews: [{ reviewerId: "r1", decision: "approved" }] },
      { task: { videoAssetId: "a2" }, reviews: [{ reviewerId: "r1", decision: "approved" }, { reviewerId: "r2", decision: "approved" }] },
    ]);
    await expect(service.request(VERSION, DATASET)).rejects.toMatchObject({
      response: { error: "GoldNotDoubleReviewed", members: ["a1"] },
    });
  });

  it("refuses a dataset that was never exported: there are no gold boxes to read", async () => {
    await store.delete("derived", EXPORT_KEY);
    await expect(service.request(VERSION, DATASET)).rejects.toMatchObject({ response: { error: "DatasetNotExported" } });
  });

  it("refuses when a gold member has no detect job by this version, naming it", async () => {
    mockPrisma.visionJob.findMany.mockResolvedValue([
      { videoAssetId: "a1", progress: { artifacts: [{ key: "inference/j1/1/detections.json", bucket: "derived", role: "detections" }] } },
    ]);
    await expect(service.request(VERSION, DATASET)).rejects.toMatchObject({
      response: { error: "DetectionsMissing", members: ["a2"] },
    });
    expect(mockPrisma.visionJob.findMany.mock.calls[0]![0].where).toMatchObject({
      type: "detect",
      state: "succeeded",
      modelVersionId: VERSION,
    });
  });

  it("does not count a detect job that reported no detections artifact", async () => {
    mockPrisma.visionJob.findMany.mockResolvedValue([
      { videoAssetId: "a1", progress: { artifacts: [] } },
      { videoAssetId: "a2", progress: { artifacts: [{ key: "inference/j2/1/detections.json", bucket: "derived", role: "detections" }] } },
    ]);
    await expect(service.request(VERSION, DATASET)).rejects.toMatchObject({ response: { members: ["a1"] } });
  });

  it("rejects an unknown version or dataset", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(null);
    await expect(service.request(VERSION, DATASET)).rejects.toBeInstanceOf(NotFoundException);
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(detector());
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(null);
    await expect(service.request(VERSION, DATASET)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("completing a run", () => {
  const summary = (over: Record<string, unknown> = {}) => ({
    benchmarkRunId: RUN,
    modelVersionId: VERSION,
    datasetVersionId: DATASET,
    iou: 0.5,
    classes: ["player", "ball"],
    assets: 2,
    framesLabelled: 10,
    framesScored: 8,
    metrics: [
      { metric: "ap:all", slice: "all", value: 0.42, support: 30 },
      { metric: "recall:ball", slice: "all", value: 0.25, support: 8 },
      { metric: "recall:ball", slice: "quality:platform_copy", value: null, support: 0 },
    ],
    ...over,
  });
  const artifacts = [{ key: "inference/job-b/1/benchmark.json", bucket: "models", role: "benchmark" }];

  beforeEach(() => {
    mockPrisma.visionBenchmarkRun.findUnique.mockResolvedValue({
      id: RUN,
      modelVersionId: VERSION,
      datasetVersionId: DATASET,
      thresholdsVersion: "test-1",
    });
    mockPrisma.$transaction.mockResolvedValue([]);
    mockPrisma.visionMetricResult.createMany.mockReturnValue("createMany");
    mockPrisma.visionBenchmarkRun.update.mockReturnValue("update");
    mockPrisma.visionModelVersion.updateMany.mockReturnValue("updateMany");
  });

  it("writes one row per metric and slice, idempotently, and judges the run", async () => {
    const outcome = await service.complete(RUN, summary(), artifacts);
    expect(outcome.applied).toBe(true);
    expect(outcome.detail).toContain("mAP@0.5 0.420");
    expect(outcome.detail).toContain("ball recall 0.250");
    expect(outcome.detail).toContain("verdict unthresholded under test-1");

    const rows = mockPrisma.visionMetricResult.createMany.mock.calls[0]![0];
    expect(rows.skipDuplicates).toBe(true);
    expect(rows.data).toHaveLength(3);
    expect(rows.data[2]).toEqual({ benchmarkRunId: RUN, metric: "recall:ball", slice: "quality:platform_copy", value: null, support: 0 });

    const update = mockPrisma.visionBenchmarkRun.update.mock.calls[0]![0];
    expect(update.data).toMatchObject({
      state: "completed",
      verdict: "unthresholded",
      reportKey: "inference/job-b/1/benchmark.json",
      summary: { framesLabelled: 10, framesScored: 8, metrics: 3 },
    });
  });

  it("moves the version from candidate to benchmarked, and from nowhere else", async () => {
    await service.complete(RUN, summary(), artifacts);
    expect(mockPrisma.visionModelVersion.updateMany).toHaveBeenCalledWith({
      where: { id: VERSION, stage: "candidate" },
      data: { stage: "benchmarked" },
    });
  });

  it("judges under the configured thresholds and records the failures", async () => {
    const strictService = new VisionBenchmarksService(
      mockPrisma as never,
      mockAudit as never,
      store,
      mockJobs as never,
      { ...thresholds, minimums: { "recall:ball": 0.5 } }
    );
    await strictService.complete(RUN, summary(), artifacts);
    const update = mockPrisma.visionBenchmarkRun.update.mock.calls[0]![0];
    expect(update.data.verdict).toBe("fail");
    expect(update.data.verdictDetail.failures[0]).toMatchObject({ metric: "recall:ball", reason: "below_minimum" });
  });

  it("refuses a summary naming another run, model or dataset", async () => {
    expect((await service.complete(RUN, summary({ benchmarkRunId: "other" }), artifacts)).applied).toBe(false);
    expect((await service.complete(RUN, summary({ modelVersionId: "other" }), artifacts)).applied).toBe(false);
    expect((await service.complete(RUN, summary({ datasetVersionId: "other" }), artifacts)).applied).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a summary with malformed metrics rather than storing part of it", async () => {
    const bad = summary({ metrics: [{ metric: "ap:all", slice: "all", value: "high" }] });
    expect((await service.complete(RUN, bad, artifacts)).applied).toBe(false);
    expect((await service.complete(RUN, summary({ metrics: "none" }), artifacts)).applied).toBe(false);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("says so when the run does not exist", async () => {
    mockPrisma.visionBenchmarkRun.findUnique.mockResolvedValue(null);
    expect((await service.complete(RUN, summary(), artifacts)).applied).toBe(false);
  });

  it("marks a failed job's run failed, only while it is still open", async () => {
    mockPrisma.visionBenchmarkRun.updateMany.mockResolvedValue({ count: 1 });
    await service.fail(RUN, "worker died");
    expect(mockPrisma.visionBenchmarkRun.updateMany).toHaveBeenCalledWith({
      where: { id: RUN, state: { in: ["queued", "running"] } },
      data: { state: "failed", failureReason: "worker died" },
    });
  });
});

describe("the error shapes", () => {
  it("are the ones the client already knows", async () => {
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(frozen({ frozenAt: null }));
    try {
      await service.request(VERSION, DATASET);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ statusCode: 409, remediation: expect.any(String) });
    }
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(detector({ model: { key: "c", task: "calibrate" } }));
    await expect(service.request(VERSION, DATASET)).rejects.toBeInstanceOf(BadRequestException);
  });
});
