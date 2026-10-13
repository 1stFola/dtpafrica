import { describe, it, expect, vi } from "vitest";
import { eventCarryInputs } from "./event-carry-inputs";
import { calibratePossessionFixture, possessionFixture } from "../possession/possession-fixture";
import { VisionJobsService } from "../jobs/vision-jobs.service";
import { CALIBRATION_FRAMES_CHUNK_ROLE, CALIBRATION_FRAMES_INDEX_ROLE, CALIBRATION_PROPAGATION_VERSION, visionKeys } from "@dtp/vision-contracts";

async function fixture() {
  const f = possessionFixture(); calibratePossessionFixture(f); await f.write();
  const model: any = { id: "model", model: { task: "event" }, configKey: "event-carry/v2", weightsKey: null, weightsChecksum: null, gitCommit: "commit", workerImage: "image" };
  const camera: any = { id: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [{ id: "cal", quality: "good", thresholdsVersion: "provisional/v1", homography: [.1,0,0,0,.1,0,0,0,1], points: [], pitchLengthM: 105, pitchWidthM: 68, createdAt: new Date("2026-10-02") }] };
  const proxy: any = { id: "proxy", objectKey: "proxy.mp4", width: 1000, height: 500, fps: 25, sourceOffsetMs: 0, createdAt: new Date("2026-10-01") };
  const db: any = {
    visionJob: { findFirst: vi.fn(async ({ where }: any) => where.type === "transcode" ? { progress: { summary: { proxy: { key: "proxy.mp4", checksumSha256: "e".repeat(64) } }, artifacts: [{ role: "proxy", key: "proxy.mp4" }] } } : f.job),
      findMany: vi.fn().mockResolvedValue([{ type: "track" }, { type: "possession" }]) },
    visionJobEvent: { findFirst: vi.fn(async () => f.log) },
    visionModelVersion: { findUnique: vi.fn(async () => model) },
    visionCameraSegment: { findMany: vi.fn(async () => [camera]) },
    visionVideoVariant: { findFirst: vi.fn(async () => proxy) },
    visionVideoAsset: { findUnique: vi.fn(async () => ({ ...f.asset, sbMatchId: "match" })) },
  };
  const read = (requested?: Record<string, unknown>) => eventCarryInputs(db, f.store, f.asset, model.id, requested);
  return { f, model, camera, proxy, db, read };
}

describe("carry producer enqueue evidence", () => {
  it("preflights valid original evidence without queue, audit or exposing resolved object keys", async () => {
    const { f, db } = await fixture();
    const queue = { enqueue: vi.fn() }, audit = { record: vi.fn() };
    const service = new VisionJobsService(db, { canAnalyze: vi.fn().mockResolvedValue({ allowed: true }) } as never, audit as never, queue as never, {} as never, { resolveForJob: vi.fn().mockResolvedValue({ id: "model" }) } as never, f.store);
    const result = await service.carryPreflight("asset", "model", "job");
    expect(result).toMatchObject({ ready: true, videoAssetId: "asset", modelVersionId: "model", possessionJobId: "job" });
    expect(JSON.stringify(result)).not.toContain("readKeys");
    expect(queue.enqueue).not.toHaveBeenCalled(); expect(audit.record).not.toHaveBeenCalled();
  });
  it.each(["rights", "prerequisite", "model", "camera", "proxy", "clock", "tamper", "missing asset", "match"])("preflight and enqueue share the first refusal: %s", async (change) => {
    const { f, db, camera, proxy } = await fixture();
    const rights = { canAnalyze: vi.fn().mockResolvedValue({ allowed: change !== "rights", remediation: "Obtain rights." }) };
    const queue = { enqueue: vi.fn() }, audit = { record: vi.fn() };
    const models = { resolveForJob: vi.fn().mockResolvedValue({ id: "model" }) };
    if (change === "prerequisite") db.visionJob.findMany.mockResolvedValue([]);
    if (change === "model") models.resolveForJob.mockRejectedValue(new (await import("@nestjs/common")).ConflictException({ error: "NoProductionModel", message: "Select a version.", remediation: "Open models." }));
    if (change === "camera") camera.kind = "replay";
    if (change === "proxy") proxy.width = 900;
    if (change === "clock") proxy.fps = 30;
    if (change === "tamper") await f.store.putSmallObject("derived", "inference/job/1/possession.json", "{}", "application/json");
    if (change === "missing asset") db.visionVideoAsset.findUnique.mockResolvedValue(null);
    if (change === "match") db.visionVideoAsset.findUnique.mockResolvedValue({ ...f.asset, sbMatchId: null });
    const service = new VisionJobsService(db, rights as never, audit as never, queue as never, {} as never, models as never, f.store);
    const result = await service.carryPreflight("asset", "model");
    expect(result.ready).toBe(false);
    if (result.ready) throw new Error("Unexpected ready result");
    await expect(service.enqueueForAsset({ type: "events", videoAssetId: "asset", modelVersionId: "model" })).rejects.toMatchObject({ response: { error: result.blocker.error, message: result.blocker.message } });
    expect(queue.enqueue).not.toHaveBeenCalled(); expect(audit.record).not.toHaveBeenCalled();
  });
  it("propagates infrastructure failure instead of reporting compatible evidence", async () => {
    const { f, db } = await fixture(); db.visionVideoAsset.findUnique.mockRejectedValue(new Error("DB unavailable"));
    const service = new VisionJobsService(db, {} as never, {} as never, {} as never, {} as never, {} as never, f.store);
    await expect(service.carryPreflight("asset")).rejects.toThrow("DB unavailable");
  });
  it("pins original evidence and ignores a caller's forged matrices, models, read keys and windows", async () => {
    const { f, db } = await fixture();
    const queue = { enqueue: vi.fn(async (data) => ({ id: data.id })) };
    const rights = { canAnalyze: vi.fn().mockResolvedValue({ allowed: true }) }, audit = { record: vi.fn() }, models = { resolveForJob: vi.fn().mockResolvedValue({ id: "model" }) };
    const service = new VisionJobsService(db, rights as never, audit as never, queue as never, { jobs: {} } as never, models as never, f.store);
    await service.enqueueForAsset({ type: "events", videoAssetId: "asset", modelVersionId: "model", params: { possessionIndex: { fake: true }, eventAlgorithm: { fake: true }, windowStartMs: 99, readKeys: [{ key: "secret" }] } });
    const spec = queue.enqueue.mock.calls[0][0];
    expect(spec.modelVersionId).toBe("model");
    expect(spec.inputSpec.possessionIndex).toEqual(f.index);
    expect(spec.inputSpec.eventAlgorithm).toMatchObject({ configKey: "event-carry/v2", weightsChecksum: null });
    expect(spec.inputSpec.windowStartMs).toBe(0);
    expect(spec.inputSpec.readKeys).toEqual([{ bucket: "derived", key: "inference/job/1/possession.json" }, { bucket: "derived", key: "inference/job/1/possession/000.jsonl" }, { bucket: "derived", key: "inference/track/1/tracks.json" }]);
    expect(rights.canAnalyze).toHaveBeenCalled();
    await expect(service.enqueueForAsset({ type: "events", videoAssetId: "asset", resourceClass: "gpu_24gb" })).rejects.toMatchObject({ response: { error: "EventsCpuOnly" } });
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });
  describe("on a moving camera", () => {
    const prefix = visionKeys.inferencePrefix("job-c", 1);
    const pin = { jobId: "job-c", indexKey: `${prefix}index.json`, indexChecksum: "a".repeat(64), chunkKeys: [`${prefix}c0.jsonl`] };
    /** The possession run was judged with a carried calibration, and that calibrate run is still current. */
    async function carriedFixture() {
      const x = await fixture();
      x.camera.calibrations = [{ id: "k1", frameIndex: 3, quality: "good", thresholdsVersion: "provisional/v1", homography: [.1,0,0,0,.1,0,0,0,1], points: [], pitchLengthM: 105, pitchWidthM: 68, createdAt: new Date("2026-10-02") }];
      x.f.index.calibrationSnapshot.segments = [{ cameraSegmentId: "cam", startMs: 0, endMs: 400, calibrationId: null, homography: null, quality: "carried", thresholdsVersion: "provisional/v1", pitch: { lengthM: 105, widthM: 68 }, keyframeIds: ["k1"] }];
      x.f.index.calibrationSnapshot.carried = pin;
      x.f.input.calibrationSnapshot = structuredClone(x.f.index.calibrationSnapshot);
      await x.f.write();
      const run = { id: "job-c", attemptNumber: 1, finishedAt: new Date(), inputSpec: { proxyChecksum: "e".repeat(64), segments: [{ cameraSegmentId: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [{ calibrationId: "k1" }] }] },
        progress: { summary: { indexChecksum: pin.indexChecksum, chunks: 1, calculationVersion: CALIBRATION_PROPAGATION_VERSION },
          artifacts: [{ role: CALIBRATION_FRAMES_INDEX_ROLE, bucket: "derived", key: pin.indexKey }, { role: CALIBRATION_FRAMES_CHUNK_ROLE, bucket: "derived", key: pin.chunkKeys[0] }] } };
      const transcode = await x.db.visionJob.findFirst({ where: { type: "transcode" } });
      x.db.visionJob.findFirst.mockImplementation(async ({ where }: any) => where.type === "transcode" ? transcode : where.type === "calibrate" ? run : x.f.job);
      const queue = { enqueue: vi.fn(async (data) => ({ id: data.id })) };
      const service = new VisionJobsService(x.db, { canAnalyze: vi.fn().mockResolvedValue({ allowed: true }) } as never, { record: vi.fn() } as never, queue as never, { jobs: {} } as never, { resolveForJob: vi.fn().mockResolvedValue({ id: "model" }) } as never, x.f.store);
      return { ...x, queue, service };
    }
    it("may read the calibrate run its possession was judged with", async () => {
      const { service, queue } = await carriedFixture();
      await service.enqueueForAsset({ type: "events", videoAssetId: "asset", modelVersionId: "model" });
      expect(queue.enqueue.mock.calls[0][0].inputSpec.readKeys.slice(-2)).toEqual([{ bucket: "derived", key: pin.indexKey }, { bucket: "derived", key: pin.chunkKeys[0] }]);
    });
    it("is refused once a keyframe changed since, so the run is no longer current", async () => {
      const { service, queue, camera } = await carriedFixture();
      camera.calibrations.push({ ...camera.calibrations[0], id: "k2", frameIndex: 9 });
      await expect(service.enqueueForAsset({ type: "events", videoAssetId: "asset", modelVersionId: "model" })).rejects.toMatchObject({ status: 409 });
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });
  it.each(["weighted", "unregistered", "missing commit", "missing image", "stale camera", "stale calibration", "stale proxy", "stale clock", "legacy", "tamper"])("refuses incompatible evidence: %s", async (change) => {
    const { f, model, camera, proxy, read } = await fixture();
    if (change === "weighted") model.weightsChecksum = "a".repeat(64);
    if (change === "unregistered") model.configKey = "other";
    if (change === "missing commit") model.gitCommit = "";
    if (change === "missing image") model.workerImage = "";
    if (change === "stale camera") camera.kind = "replay";
    if (change === "stale calibration") camera.calibrations[0].id = "replacement";
    if (change === "stale proxy") proxy.width = 900;
    if (change === "stale clock") proxy.fps = 30;
    if (change === "legacy") {
      f.index.calculationVersion = "possession-candidates/v1";
      for (const key of ["constraintMode", "calibrationSnapshot", "footballConfig"]) { delete f.index[key]; delete f.input[key]; }
      await f.write();
    }
    if (change === "tamper") await f.store.putSmallObject("derived", "inference/job/1/possession.json", "{}", "application/json");
    await expect(read()).rejects.toMatchObject({ status: 409 });
  });
  it("validates an explicit selected job ID", async () => {
    const { read, db } = await fixture();
    await read({ possessionJobId: "job" });
    expect(db.visionJob.findFirst.mock.calls[0][0].where.id).toBe("job");
    for (const id of [true, 1, "", "x".repeat(101)]) await expect(read({ possessionJobId: id })).rejects.toMatchObject({ status: 400 });
  });
});
