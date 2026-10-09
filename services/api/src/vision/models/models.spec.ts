import { DETECTOR_CONFIG_BALL_TILES, DETECTOR_CONFIG_BASE } from "@dtp/vision-contracts";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VisionModelsService } from "./models.service";

/**
 * The model registry's refusals.
 *
 * Phase 3's gate: every prediction carries its model version. Three things make
 * that true and each is tested as a refusal -- a version without lineage cannot be
 * registered, a model-bound job cannot be queued without resolving to one version,
 * and a completion naming the wrong version or the wrong weights cannot succeed.
 */

const MODEL = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const DATASET = "33333333-3333-4333-8333-333333333333";
const SHA = "a".repeat(64);

const mockPrisma = {
  visionEventGoldSet: { findMany: vi.fn().mockResolvedValue([]) },
  visionModel: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  visionModelVersion: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  visionDatasetVersion: { findUnique: vi.fn() },
  visionDatasetMember: { findMany: vi.fn() },
};
const mockAudit = { record: vi.fn() };

let service: VisionModelsService;

const registration = {
  version: "0.1",
  gitCommit: "3eeec6e0",
  configKey: "detector/baseline/config.json",
  workerImage: "dtp-vision-engine:0.1",
  licenceNote: "torchvision BSD-3-Clause; COCO weights BSD-3-Clause via torchvision; no DTP data.",
};

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.visionModel.findUnique.mockResolvedValue({ id: MODEL, key: "detector/baseline", task: "detect" });
  mockPrisma.visionModelVersion.create.mockImplementation(({ data }: never) =>
    Promise.resolve({ id: VERSION, ...(data as object) })
  );
  mockPrisma.visionDatasetMember.findMany.mockResolvedValue([]);
  mockAudit.record.mockResolvedValue(undefined);
  service = new VisionModelsService(mockPrisma as never, mockAudit as never);
});

// ── registration ─────────────────────────────────────────────────────────────

describe("registering a version", () => {
  it("records the lineage and starts as a candidate", async () => {
    const version = await service.registerVersion(MODEL, registration);
    expect(mockPrisma.visionModelVersion.create.mock.calls[0]![0].data).toMatchObject({
      modelId: MODEL,
      version: "0.1",
      gitCommit: "3eeec6e0",
      workerImage: "dtp-vision-engine:0.1",
      stage: "candidate",
      datasetVersionId: null,
      weightsChecksum: null,
    });
    expect(version.id).toBe(VERSION);
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "model.version.registered", targetId: VERSION }),
      undefined
    );
  });

  it("refuses a blank licence note, because the register says nothing ships without one", async () => {
    await expect(
      service.registerVersion(MODEL, { ...registration, licenceNote: "   " })
    ).rejects.toMatchObject({ response: { error: "LicenceNoteRequired" } });
    expect(mockPrisma.visionModelVersion.create).not.toHaveBeenCalled();
  });

  it("lower-cases a declared checksum so comparison is never case-sensitive", async () => {
    await service.registerVersion(MODEL, { ...registration, weightsChecksum: "ABC".padEnd(64, "0") });
    expect(mockPrisma.visionModelVersion.create.mock.calls[0]![0].data.weightsChecksum).toBe(
      "abc".padEnd(64, "0")
    );
  });

  it("refuses a second version with the same string, because a version is immutable", async () => {
    mockPrisma.visionModelVersion.create.mockRejectedValue(uniqueViolation());
    await expect(service.registerVersion(MODEL, registration)).rejects.toMatchObject({
      response: { error: "ModelVersionExists" },
    });
  });

  it("rejects an unknown model", async () => {
    mockPrisma.visionModel.findUnique.mockResolvedValue(null);
    await expect(service.registerVersion(MODEL, registration)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("a version's dataset lineage", () => {
  function dataset(overrides: Record<string, unknown> = {}) {
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue({
      id: DATASET,
      label: "v1",
      frozenAt: new Date("2026-09-30"),
      containsRevokedMembers: false,
      ...overrides,
    });
  }

  it("accepts a frozen, rights-clean dataset", async () => {
    dataset();
    const version = await service.registerVersion(MODEL, { ...registration, datasetVersionId: DATASET });
    expect(version.datasetVersionId).toBe(DATASET);
  });

  it("refuses a draft dataset: a model recorded against it could never be rebuilt", async () => {
    dataset({ frozenAt: null });
    await expect(
      service.registerVersion(MODEL, { ...registration, datasetVersionId: DATASET })
    ).rejects.toMatchObject({ response: { error: "DatasetNotFrozen" } });
    expect(mockPrisma.visionModelVersion.create).not.toHaveBeenCalled();
  });

  it("refuses a dataset holding revoked footage", async () => {
    dataset({ containsRevokedMembers: true });
    const refusal = service.registerVersion(MODEL, { ...registration, datasetVersionId: DATASET });
    await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
    await expect(refusal).rejects.toMatchObject({ response: { error: "DatasetContainsRevokedMembers" } });
  });

  it("refuses a dataset that trains on another frozen version's gold", async () => {
    dataset();
    // goldContamination: this version trains on a1, and a frozen version holds a1 as gold.
    mockPrisma.visionDatasetMember.findMany
      .mockResolvedValueOnce([{ videoAssetId: "a1", split: "train" }])
      .mockResolvedValueOnce([{ videoAssetId: "a1", datasetVersion: { label: "gold-2026" } }]);
    await expect(
      service.registerVersion(MODEL, { ...registration, datasetVersionId: DATASET })
    ).rejects.toMatchObject({
      response: { error: "GoldContamination", members: [{ videoAssetId: "a1", heldOutBy: "gold-2026" }] },
    });
  });

  it("rejects an unknown dataset", async () => {
    mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(null);
    await expect(
      service.registerVersion(MODEL, { ...registration, datasetVersionId: DATASET })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("registering a model", () => {
  it("creates it and audits", async () => {
    mockPrisma.visionModel.create.mockResolvedValue({ id: MODEL, key: "detector/x", task: "detect" });
    await service.createModel({ key: "detector/x", task: "detect" });
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "model.registered", targetId: MODEL }),
      undefined
    );
  });

  it("refuses a duplicate key", async () => {
    mockPrisma.visionModel.create.mockRejectedValue(uniqueViolation());
    await expect(service.createModel({ key: "detector/x", task: "detect" })).rejects.toMatchObject({
      response: { error: "ModelKeyExists" },
    });
  });
});

// ── dispatch ─────────────────────────────────────────────────────────────────

describe("resolving the model a job must run", () => {
  const detector = (overrides: Record<string, unknown> = {}) => ({
    id: VERSION,
    version: "0.1",
    stage: "production",
    datasetVersionId: null,
    model: { id: MODEL, key: "detector/baseline", task: "detect" },
    ...overrides,
  });

  it("returns null for a job type that runs no model", async () => {
    expect(await service.resolveForJob("probe")).toBeNull();
    expect(await service.resolveForJob("transcode")).toBeNull();
    expect(mockPrisma.visionModelVersion.findMany).not.toHaveBeenCalled();
  });

  it("refuses a model version passed for a job type that runs none", async () => {
    await expect(service.resolveForJob("probe", VERSION)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("uses the explicit version when it matches the task", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(detector({ stage: "candidate" }));
    const resolved = await service.resolveForJob("detect", VERSION);
    expect(resolved).toMatchObject({ id: VERSION, modelKey: "detector/baseline", task: "detect", stage: "candidate" });
  });

  it("refuses an explicit version of the wrong task", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(
      detector({ model: { id: MODEL, key: "tracker/x", task: "track" } })
    );
    await expect(service.resolveForJob("detect", VERSION)).rejects.toMatchObject({
      response: { error: "ModelTaskMismatch" },
    });
  });

  it("refuses an archived version", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(detector({ stage: "archived" }));
    await expect(service.resolveForJob("detect", VERSION)).rejects.toMatchObject({
      response: { error: "ModelVersionArchived" },
    });
  });

  it("refuses an unknown explicit version", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(null);
    await expect(service.resolveForJob("detect", VERSION)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("falls back to the single production version for the task", async () => {
    mockPrisma.visionModelVersion.findMany.mockResolvedValue([detector()]);
    const resolved = await service.resolveForJob("detect");
    expect(resolved?.id).toBe(VERSION);
    expect(mockPrisma.visionModelVersion.findMany.mock.calls[0]![0].where).toEqual({
      stage: "production",
      model: { task: "detect" },
    });
  });

  it("refuses when nothing is in production: provenance must not be an accident", async () => {
    mockPrisma.visionModelVersion.findMany.mockResolvedValue([]);
    await expect(service.resolveForJob("detect")).rejects.toMatchObject({
      response: { error: "NoProductionModel" },
    });
  });

  it("refuses when two versions claim production", async () => {
    mockPrisma.visionModelVersion.findMany.mockResolvedValue([detector(), detector({ id: "other", version: "0.2" })]);
    await expect(service.resolveForJob("detect")).rejects.toMatchObject({
      response: { error: "AmbiguousProductionModel", versions: ["detector/baseline@0.1", "detector/baseline@0.2"] },
    });
  });
});

// ── completion ───────────────────────────────────────────────────────────────

describe("verifying a completion's provenance", () => {
  const job = { id: "job-1", type: "detect" as const, modelVersionId: VERSION };
  /** What a 1.20 detect worker reports: the config it ran. */
  const RAN = { detectorConfig: DETECTOR_CONFIG_BASE };

  beforeEach(() => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue({ id: VERSION, weightsChecksum: null, configKey: DETECTOR_CONFIG_BASE });
  });

  it("accepts a stage that runs no model and reports none", async () => {
    const verdict = await service.verifyCompletion(
      { id: "job-1", type: "probe", modelVersionId: null },
      { modelVersionIds: [], summary: {} }
    );
    expect(verdict).toEqual({ ok: true, modelVersionId: null, weights: { outcome: "not_applicable", sha256: null } });
  });

  it("refuses a stage that runs no model yet claims one", async () => {
    const verdict = await service.verifyCompletion(
      { id: "job-1", type: "probe", modelVersionId: null },
      { modelVersionIds: [VERSION], summary: {} }
    );
    expect(verdict).toMatchObject({ ok: false, error: "ProvenanceMismatch" });
  });

  it("refuses a model-bound job that was dispatched without a version", async () => {
    const verdict = await service.verifyCompletion(
      { ...job, modelVersionId: null },
      { modelVersionIds: [VERSION], summary: { modelVersionId: VERSION } }
    );
    expect(verdict).toMatchObject({ ok: false, error: "ProvenanceMismatch" });
  });

  it.each([
    ["none", []],
    ["another", ["44444444-4444-4444-8444-444444444444"]],
    ["two", [VERSION, "44444444-4444-4444-8444-444444444444"]],
  ])("refuses a completion reporting %s instead of the dispatched version", async (_label, reported) => {
    const verdict = await service.verifyCompletion(job, { modelVersionIds: reported, summary: {} });
    expect(verdict).toMatchObject({ ok: false, error: "ProvenanceMismatch" });
  });

  it("refuses a summary that names a different version than the completion", async () => {
    const verdict = await service.verifyCompletion(job, {
      modelVersionIds: [VERSION],
      summary: { modelVersionId: "44444444-4444-4444-8444-444444444444" },
    });
    expect(verdict).toMatchObject({ ok: false, error: "ProvenanceMismatch" });
  });

  it("accepts the dispatched version and notes an unreported checksum as a gap", async () => {
    const verdict = await service.verifyCompletion(job, {
      modelVersionIds: [VERSION],
      summary: { ...RAN, modelVersionId: VERSION, weightsSha256: null },
    });
    expect(verdict).toEqual({ ok: true, modelVersionId: VERSION, weights: { outcome: "unreported", sha256: null } });
  });

  it("offers a first-seen checksum to be recorded, without writing it itself", async () => {
    const verdict = await service.verifyCompletion(job, {
      modelVersionIds: [VERSION],
      summary: { ...RAN, modelVersionId: VERSION, weightsSha256: SHA.toUpperCase() },
    });
    expect(verdict).toEqual({ ok: true, modelVersionId: VERSION, weights: { outcome: "recorded", sha256: SHA } });
    // Read-only: the controller records after the job has succeeded, so a refused
    // or failed completion leaves nothing behind.
    expect(mockPrisma.visionModelVersion.updateMany).not.toHaveBeenCalled();
  });

  it("verifies a checksum that matches the pinned one", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue({ id: VERSION, weightsChecksum: SHA, configKey: DETECTOR_CONFIG_BASE });
    const verdict = await service.verifyCompletion(job, {
      modelVersionIds: [VERSION],
      summary: { ...RAN, modelVersionId: VERSION, weightsSha256: SHA },
    });
    expect(verdict).toMatchObject({ ok: true, weights: { outcome: "verified" } });
  });

  it("refuses weights that differ from the pinned ones: a URL can serve different bytes", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue({ id: VERSION, weightsChecksum: SHA, configKey: DETECTOR_CONFIG_BASE });
    const verdict = await service.verifyCompletion(job, {
      modelVersionIds: [VERSION],
      summary: { ...RAN, modelVersionId: VERSION, weightsSha256: "b".repeat(64) },
    });
    expect(verdict).toMatchObject({ ok: false, error: "WeightsMismatch" });
  });

  it("refuses a checksum that is not a digest rather than recording garbage", async () => {
    const verdict = await service.verifyCompletion(job, {
      modelVersionIds: [VERSION],
      summary: { ...RAN, modelVersionId: VERSION, weightsSha256: "not-a-digest" },
    });
    expect(verdict).toMatchObject({ ok: false, error: "WeightsMismatch" });
  });

  it.each([
    ["another config", { detectorConfig: DETECTOR_CONFIG_BALL_TILES }],
    ["none: a worker older than 1.20", {}],
  ])("refuses detections from a detector config other than the version's: %s", async (_label, ran) => {
    const verdict = await service.verifyCompletion(job, { modelVersionIds: [VERSION], summary: { ...ran, modelVersionId: VERSION, weightsSha256: null } });
    expect(verdict).toMatchObject({ ok: false, error: "ProvenanceMismatch" });
  });

  it("refuses a version that was deleted between dispatch and completion", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(null);
    const verdict = await service.verifyCompletion(job, { modelVersionIds: [VERSION], summary: {} });
    expect(verdict).toMatchObject({ ok: false, error: "ProvenanceMismatch" });
  });
});

describe("pinning the weights", () => {
  it("writes only where nothing is recorded, so two first runs cannot overwrite each other", async () => {
    mockPrisma.visionModelVersion.updateMany.mockResolvedValue({ count: 1 });
    expect(await service.recordWeightsChecksum(VERSION, SHA.toUpperCase())).toBe(true);
    expect(mockPrisma.visionModelVersion.updateMany).toHaveBeenCalledWith({
      where: { id: VERSION, weightsChecksum: null },
      data: { weightsChecksum: SHA },
    });

    mockPrisma.visionModelVersion.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.recordWeightsChecksum(VERSION, SHA)).toBe(false);
  });
});

describe("the conflict shapes reach the client", () => {
  it("uses the same error envelope as the dataset factory", async () => {
    mockPrisma.visionModelVersion.findMany.mockResolvedValue([]);
    try {
      await service.resolveForJob("detect");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      const body = (error as ConflictException).getResponse() as Record<string, unknown>;
      expect(body.statusCode).toBe(409);
      expect(body.remediation).toMatch(/modelVersionId/);
    }
  });
});

describe("the registry list", () => {
  it("says which versions have a promotion waiting on a second person, and who asked", async () => {
    const waiting = { id: "pr-1", fromStage: "staging", toStage: "production", requestedBy: "u-trainer", requestedByEmail: "t@dtp.test", createdAt: new Date() };
    (mockPrisma.visionModel as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany = vi.fn().mockResolvedValue([
      { id: "m-1", key: "detector/x", task: "detect", versions: [{ id: "v-2", version: "0.2", stage: "staging", promotionRequests: [waiting] }, { id: "v-1", version: "0.1", stage: "production", promotionRequests: [] }] },
    ]);
    const { models } = await service.listModels();
    expect(models[0]!.versions[0]).toEqual({ id: "v-2", version: "0.2", stage: "staging", pendingPromotion: waiting });
    expect(models[0]!.versions[1]).toEqual({ id: "v-1", version: "0.1", stage: "production", pendingPromotion: null });
    const query = (mockPrisma.visionModel as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany.mock.calls[0]![0];
    expect(query.include.versions.select.promotionRequests).toMatchObject({ where: { state: "pending" }, take: 1 });
  });
});
