import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRAIN_DEFAULTS, TRAINED_DETECTOR_CONFIG } from "@dtp/vision-contracts";
import { VisionTrainingService } from "./training.service";

/** Fine-tuning runs (docs/vision/102): what a run must have before it is queued, and how a version is made from one. */
const DS = "11111111-1111-4111-8111-111111111111";
const window = { _cls: "TemporalDetection", support: [10, 10] };
const exportBody = (over: Record<string, unknown>[] = []) => Buffer.from(JSON.stringify({ samples: [
  { filepath: "proxies/a.mp4", tags: ["train"], provenance: { video_asset_id: "a" }, annotations: { detections: [window, window] } },
  { filepath: "proxies/b.mp4", tags: ["val"], provenance: { video_asset_id: "b" }, annotations: { detections: [window] } },
  { filepath: "proxies/g.mp4", tags: ["gold"], provenance: { video_asset_id: "g" }, annotations: { detections: [window] } },
  ...over,
] }));

const prisma = {
  visionDatasetMember: { findMany: vi.fn() },
  visionModel: { findUnique: vi.fn() },
  visionJob: { findUnique: vi.fn() },
};
const audit = { record: vi.fn() };
const store = { getSmallObject: vi.fn() };
const jobs = { enqueueDetached: vi.fn() };
const rights = { canTrainMany: vi.fn() };
const models = { assertDatasetCanBackAModel: vi.fn(), registerVersion: vi.fn() };
let service: VisionTrainingService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new VisionTrainingService(prisma as never, audit as never, store as never, jobs as never, rights as never, models as never);
  prisma.visionDatasetMember.findMany.mockResolvedValue([{ videoAssetId: "a", split: "train" }, { videoAssetId: "b", split: "val" }]);
  rights.canTrainMany.mockResolvedValue(new Map([["a", { allowed: true }], ["b", { allowed: true }]]));
  store.getSmallObject.mockResolvedValue(exportBody());
  jobs.enqueueDetached.mockResolvedValue({ id: "job-train" });
});

describe("requesting a run", () => {
  it("pins the export, lists only train and val proxies, and books the budget given", async () => {
    const result = await service.request({ datasetVersionId: DS, budgetUsdCents: 150 });
    const call = jobs.enqueueDetached.mock.calls[0]![0];
    expect(call).toMatchObject({ type: "train", datasetVersionId: DS, resourceClass: "gpu_24gb", budgetUsdCents: 150 });
    expect(call.params.export).toEqual({ key: `datasets/${DS}/export/samples.json`, checksum: createHash("sha256").update(exportBody()).digest("hex") });
    expect(call.params.members).toEqual([{ videoAssetId: "a", split: "train", proxyKey: "proxies/a.mp4" }, { videoAssetId: "b", split: "val", proxyKey: "proxies/b.mp4" }]);
    expect(call.params.readKeys.map((k: { key: string }) => k.key)).toEqual([`datasets/${DS}/export/samples.json`, "proxies/a.mp4", "proxies/b.mp4"]);
    expect(call.params.hyperparameters).toEqual(TRAIN_DEFAULTS);
    expect(result.labelWindows).toEqual({ train: 2, val: 1 });
    expect(models.assertDatasetCanBackAModel).toHaveBeenCalledWith(DS);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "model.training.requested", targetId: "job-train" }), undefined);
  });

  it("will not default the budget", async () => {
    await expect(service.request({ datasetVersionId: DS } as never)).rejects.toMatchObject({ response: { error: "TrainingBudgetRequired" } });
    expect(jobs.enqueueDetached).not.toHaveBeenCalled();
  });

  it("refuses hyperparameters outside the bounds", async () => {
    await expect(service.request({ datasetVersionId: DS, budgetUsdCents: 100, hyperparameters: { epochs: 500 } })).rejects.toMatchObject({ response: { error: "TrainingHyperparametersInvalid" } });
    await expect(service.request({ datasetVersionId: DS, budgetUsdCents: 100, hyperparameters: { batchSize: 2.5 } })).rejects.toMatchObject({ response: { error: "TrainingHyperparametersInvalid" } });
  });

  it("refuses a dataset with no val split", async () => {
    prisma.visionDatasetMember.findMany.mockResolvedValue([{ videoAssetId: "a", split: "train" }]);
    await expect(service.request({ datasetVersionId: DS, budgetUsdCents: 100 })).rejects.toMatchObject({ response: { error: "TrainingSplitsEmpty" } });
  });

  it("refuses footage whose training right has lapsed since the freeze", async () => {
    rights.canTrainMany.mockResolvedValue(new Map([["a", { allowed: true }], ["b", { allowed: false }]]));
    await expect(service.request({ datasetVersionId: DS, budgetUsdCents: 100 })).rejects.toMatchObject({ response: { error: "TrainingRightsDenied", members: ["b"] } });
  });

  it("refuses a dataset that was never exported, or whose export predates its members", async () => {
    store.getSmallObject.mockResolvedValueOnce(null);
    await expect(service.request({ datasetVersionId: DS, budgetUsdCents: 100 })).rejects.toMatchObject({ response: { error: "DatasetNotExported" } });
    prisma.visionDatasetMember.findMany.mockResolvedValue([{ videoAssetId: "a", split: "train" }, { videoAssetId: "b", split: "val" }, { videoAssetId: "new", split: "val" }]);
    await expect(service.request({ datasetVersionId: DS, budgetUsdCents: 100 })).rejects.toMatchObject({ response: { error: "ExportStale" } });
  });

  it("refuses a split with no approved labels", async () => {
    store.getSmallObject.mockResolvedValue(Buffer.from(JSON.stringify({ samples: [
      { filepath: "proxies/a.mp4", tags: ["train"], provenance: { video_asset_id: "a" }, annotations: { detections: [window] } },
      { filepath: "proxies/b.mp4", tags: ["val"], provenance: { video_asset_id: "b" }, annotations: null },
    ] })));
    await expect(service.request({ datasetVersionId: DS, budgetUsdCents: 100 })).rejects.toMatchObject({ response: { error: "TrainingLabelsEmpty" } });
  });
});

describe("registering a version from a run", () => {
  const run = (over: Record<string, unknown> = {}) => ({
    id: "job-train", type: "train", state: "succeeded", datasetVersionId: DS,
    progress: { workerImage: "ghcr.io/1stfola/dtp-vision-worker:gpu-abc1234",
      artifacts: [{ role: "weights", bucket: "models", key: "inference/job-train/1/weights.pt" }],
      summary: { weightsSha256: "e".repeat(64), configKey: TRAINED_DETECTOR_CONFIG } },
    ...over,
  });
  const dto = { jobId: "job-train", version: "1.0.0-ft1", gitCommit: "abc1234", licenceNote: "BSD-3 torchvision code and COCO weights; baseline only." };

  beforeEach(() => {
    prisma.visionModel.findUnique.mockResolvedValue({ id: "m-1", key: "detector/torchvision-fasterrcnn-ft", task: "detect" });
    prisma.visionJob.findUnique.mockResolvedValue(run());
  });

  it("takes weights, checksum, dataset, config and image from the run", async () => {
    await service.registerFromRun("m-1", dto);
    expect(models.registerVersion).toHaveBeenCalledWith("m-1", {
      version: "1.0.0-ft1", gitCommit: "abc1234", configKey: TRAINED_DETECTOR_CONFIG, workerImage: "ghcr.io/1stfola/dtp-vision-worker:gpu-abc1234",
      licenceNote: dto.licenceNote, datasetVersionId: DS, weightsKey: "inference/job-train/1/weights.pt", weightsChecksum: "e".repeat(64),
    }, undefined);
  });

  it("refuses a run that did not succeed, and a model that is not a detector", async () => {
    prisma.visionJob.findUnique.mockResolvedValueOnce(run({ state: "failed" }));
    await expect(service.registerFromRun("m-1", dto)).rejects.toMatchObject({ response: { error: "TrainingRunNotSucceeded" } });
    prisma.visionModel.findUnique.mockResolvedValueOnce({ id: "m-2", key: "tracker/x", task: "track" });
    await expect(service.registerFromRun("m-2", dto)).rejects.toMatchObject({ response: { error: "ModelTaskUnsupported" } });
    expect(models.registerVersion).not.toHaveBeenCalled();
  });

  it("refuses a run that recorded no weights checksum", async () => {
    prisma.visionJob.findUnique.mockResolvedValueOnce(run({ progress: { workerImage: "img", artifacts: [], summary: {} } }));
    await expect(service.registerFromRun("m-1", dto)).rejects.toMatchObject({ response: { error: "TrainingRunIncomplete" } });
  });
});
