import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import type { BenchmarkThresholds } from "./benchmark-thresholds";
import { VisionPromotionsService, type PromotionGate } from "./promotions.service";

/** The stored checks, typed: Prisma hands back Json. */
const gateOf = (request: { checks: unknown }) => request.checks as PromotionGate;

/**
 * Promotion: seven checks and a second person.
 *
 * Every refusal below is a way a model could otherwise reach production on one
 * person's say-so, or on facts that were true last week. The checks are tested as
 * refusals by name, the two-person rule as the thing the API key cannot satisfy.
 */

const VERSION = "22222222-2222-4222-8222-222222222222";
const OTHER = "22222222-2222-4222-8222-222222222299";
const RUN = "44444444-4444-4444-8444-444444444444";
const THEIR_RUN = "44444444-4444-4444-8444-444444444499";
const DATASET = "33333333-3333-4333-8333-333333333333";
const GOLD = "33333333-3333-4333-8333-333333333399";

const mockPrisma = {
  visionModelVersion: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  visionPromotionRequest: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  visionBenchmarkRun: { findFirst: vi.fn() },
  visionMetricResult: { findMany: vi.fn() },
  visionDatasetVersion: { findUnique: vi.fn() },
  visionJob: { count: vi.fn() },
  $transaction: vi.fn(),
};
const mockAudit = { record: vi.fn() };
const mockRights = { canTrain: vi.fn() };
const mockDatasets = { checkLeakage: vi.fn() };

const thresholds: BenchmarkThresholds = {
  version: "test-1",
  iou: 0.5,
  minimums: {},
  criticalSlices: ["quality:platform_copy"],
  regressionMetrics: ["ap:all", "recall:ball"],
  regressionTolerance: 0.02,
};

const trainer: AdminAuthContext = { method: "jwt", roleSlug: "vision_ml_engineer", roleName: null, permissions: [], userId: "u-trainer", email: "t@dtp.test" };
const approver: AdminAuthContext = { method: "jwt", roleSlug: "vision_admin", roleName: null, permissions: [], userId: "u-approver", email: "a@dtp.test" };
const apiKey: AdminAuthContext = { method: "api_key", roleSlug: null, roleName: null, permissions: [] };

let store: InMemoryObjectStore;
let service: VisionPromotionsService;

function version(over: Record<string, unknown> = {}) {
  return {
    id: VERSION,
    version: "0.2",
    stage: "benchmarked",
    datasetVersionId: null as string | null,
    gitCommit: "3eeec6e0",
    configKey: "c",
    workerImage: "img:0.1",
    weightsChecksum: "a".repeat(64),
    licenceNote: "BSD-3",
    model: { key: "detector/x", task: "detect" },
    ...over,
  };
}
function run(over: Record<string, unknown> = {}) {
  return {
    id: RUN,
    verdict: "unthresholded",
    thresholdsVersion: "test-1",
    datasetVersionId: GOLD,
    datasetVersion: { id: GOLD, label: "gold v1" },
    ...over,
  };
}

/** A version that passes every check, so each test can break exactly one. */
async function allClear() {
  mockPrisma.visionModelVersion.findUnique.mockResolvedValue(version());
  mockPrisma.visionBenchmarkRun.findFirst.mockResolvedValue(run());
  mockPrisma.visionModelVersion.findMany.mockResolvedValue([]); // no production model
  mockPrisma.visionJob.count.mockResolvedValue(1);
  mockPrisma.visionPromotionRequest.findFirst.mockResolvedValue(null);
  await store.putSmallObject("models", `${VERSION}/model-card.md`, "# card", "text/markdown");
}

beforeEach(async () => {
  vi.clearAllMocks();
  store = new InMemoryObjectStore();
  service = new VisionPromotionsService(mockPrisma as never, mockAudit as never, store, mockRights as never, mockDatasets as never, thresholds);
  await allClear();
  mockPrisma.visionPromotionRequest.create.mockImplementation(({ data }: never) => Promise.resolve({ id: "pr-1", ...(data as object) }));
  mockPrisma.visionPromotionRequest.update.mockReturnValue("update-request");
  mockPrisma.visionModelVersion.update.mockReturnValue("update-version");
  mockPrisma.visionModelVersion.updateMany.mockReturnValue("update-others");
  mockPrisma.$transaction.mockResolvedValue([]);
  mockAudit.record.mockResolvedValue(undefined);
  mockRights.canTrain.mockResolvedValue({ allowed: true });
  mockDatasets.checkLeakage.mockResolvedValue({ ok: true, offendingGroups: [] });
});

// ── who ───────────────────────────────────────────────────────────────────────

describe("promotion needs a person at both ends", () => {
  it("refuses the operator API key as a requester", async () => {
    await expect(service.request(VERSION, apiKey)).rejects.toMatchObject({ response: { error: "PromotionNeedsAPerson" } });
    await expect(service.request(VERSION, undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses the operator API key as an approver, a rejecter and a roller-back", async () => {
    await expect(service.approve(VERSION, apiKey)).rejects.toMatchObject({ response: { error: "PromotionNeedsAPerson" } });
    await expect(service.reject("pr-1", "no", apiKey)).rejects.toMatchObject({ response: { error: "PromotionNeedsAPerson" } });
    await expect(service.rollback(VERSION, apiKey)).rejects.toMatchObject({ response: { error: "PromotionNeedsAPerson" } });
  });

  it("refuses the requester approving their own request", async () => {
    mockPrisma.visionPromotionRequest.findFirst.mockResolvedValue({ id: "pr-1", state: "pending", requestedBy: "u-trainer", fromStage: "benchmarked", toStage: "staging" });
    await expect(service.approve(VERSION, trainer)).rejects.toMatchObject({ response: { error: "SelfPromotionRefused" } });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

// ── request ───────────────────────────────────────────────────────────────────

describe("requesting a promotion", () => {
  it("records the request with the gate's findings and who asked", async () => {
    const request = await service.request(VERSION, trainer);
    expect(request.id).toBe("pr-1");
    const data = mockPrisma.visionPromotionRequest.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ modelVersionId: VERSION, benchmarkRunId: RUN, fromStage: "benchmarked", toStage: "staging", requestedBy: "u-trainer", requestedByEmail: "t@dtp.test" });
    expect(data.checks.failures).toEqual([]);
    expect(data.checks.warnings.map((w: { name: string }) => w.name)).toEqual(["benchmark"]); // unthresholded
    expect(data.checks.passed.map((p: { name: string }) => p.name)).toEqual(["regression", "model_card", "licence", "lineage", "reproducible", "smoke"]);
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "model.promotion.requested" }), trainer);
  });

  it("promotes staging towards production, and nothing else", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(version({ stage: "staging" }));
    const request = await service.request(VERSION, trainer);
    expect(request.toStage).toBe("production");

    for (const stage of ["candidate", "production", "archived"]) {
      mockPrisma.visionModelVersion.findUnique.mockResolvedValue(version({ stage }));
      await expect(service.request(VERSION, trainer)).rejects.toMatchObject({ response: { error: "StageNotPromotable" } });
    }
  });

  it("refuses a second request while one is pending", async () => {
    mockPrisma.visionPromotionRequest.findFirst.mockResolvedValue({ id: "pr-0", requestedBy: "u-x" });
    await expect(service.request(VERSION, trainer)).rejects.toMatchObject({ response: { error: "PromotionPending", requestId: "pr-0" } });
  });

  it("rejects an unknown version", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(null);
    await expect(service.request(VERSION, trainer)).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ── the gate ──────────────────────────────────────────────────────────────────

describe("the promotion gate", () => {
  async function failures() {
    try {
      await service.request(VERSION, trainer);
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      const body = (error as ConflictException).getResponse() as { error: string; failures: { name: string; detail: string }[] };
      expect(body.error).toBe("PromotionGateFailed");
      return body.failures;
    }
    throw new Error("expected the gate to fail");
  }

  it("fails without a completed benchmark run on a frozen gold version", async () => {
    mockPrisma.visionBenchmarkRun.findFirst.mockResolvedValue(null);
    const f = await failures();
    expect(f.map((x) => x.name)).toEqual(["benchmark"]);
  });

  it("fails when the latest run failed its thresholds", async () => {
    mockPrisma.visionBenchmarkRun.findFirst.mockResolvedValue(run({ verdict: "fail" }));
    expect((await failures()).map((x) => x.name)).toEqual(["benchmark"]);
  });

  it("passes the benchmark check on a passing run, with no warning", async () => {
    mockPrisma.visionBenchmarkRun.findFirst.mockResolvedValue(run({ verdict: "pass" }));
    const request = await service.request(VERSION, trainer);
    expect(gateOf(request).warnings).toEqual([]);
  });

  it("fails without a model card, and names the key", async () => {
    await store.delete("models", `${VERSION}/model-card.md`);
    const f = await failures();
    expect(f[0]).toMatchObject({ name: "model_card" });
    expect(f[0]!.detail).toContain(`${VERSION}/model-card.md`);
  });

  it("fails on a blank licence note", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(version({ licenceNote: " " }));
    expect((await failures()).map((x) => x.name)).toEqual(["licence"]);
  });

  it("fails when commit, config, image or the pinned weights are missing, and says why weights matter", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(version({ weightsChecksum: null, configKey: null }));
    const f = await failures();
    expect(f[0]).toMatchObject({ name: "reproducible" });
    expect(f[0]!.detail).toContain("configKey, weightsChecksum");
    expect(f[0]!.detail).toMatch(/pinned by the first worker run/);
  });

  it("fails without a succeeded inference on the built image", async () => {
    mockPrisma.visionJob.count.mockResolvedValue(0);
    expect((await failures()).map((x) => x.name)).toEqual(["smoke"]);
  });

  it("reports every failure, not the first", async () => {
    mockPrisma.visionBenchmarkRun.findFirst.mockResolvedValue(null);
    mockPrisma.visionJob.count.mockResolvedValue(0);
    await store.delete("models", `${VERSION}/model-card.md`);
    expect((await failures()).map((x) => x.name)).toEqual(["benchmark", "model_card", "smoke"]);
  });

  describe("dataset lineage, re-checked now", () => {
    beforeEach(() => {
      mockPrisma.visionModelVersion.findUnique.mockResolvedValue(version({ datasetVersionId: DATASET }));
      mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue({
        id: DATASET, label: "train v1", frozenAt: new Date("2026-09-30"), containsRevokedMembers: false,
        members: [{ videoAssetId: "a1" }, { videoAssetId: "a2" }],
      });
    });

    it("passes rights and leakage on a clean, frozen dataset", async () => {
      const request = await service.request(VERSION, trainer);
      expect(gateOf(request).passed.map((p) => p.name)).toContain("rights");
      expect(gateOf(request).passed.map((p) => p.name)).toContain("leakage");
      expect(mockRights.canTrain).toHaveBeenCalledTimes(2);
    });

    it("fails when a member lost its training right since the freeze", async () => {
      mockRights.canTrain.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false, reason: "revoked" });
      const f = await failures();
      expect(f[0]).toMatchObject({ name: "rights" });
      expect(f[0]!.detail).toContain("a2");
    });

    it("fails on revoked footage, a draft dataset, or a leak", async () => {
      mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue({ id: DATASET, label: "t", frozenAt: null, containsRevokedMembers: true, members: [] });
      mockDatasets.checkLeakage.mockResolvedValue({ ok: false, offendingGroups: [{}] });
      expect((await failures()).map((x) => x.name)).toEqual(["lineage", "rights", "leakage"]);
    });

    it("fails when the dataset no longer exists", async () => {
      mockPrisma.visionDatasetVersion.findUnique.mockResolvedValue(null);
      expect((await failures()).map((x) => x.name)).toEqual(["lineage"]);
    });
  });

  describe("regression against the production model", () => {
    const production = { id: OTHER, version: "0.1", model: { key: "detector/x" } };
    const metric = (runId: string, metric: string, slice: string, value: number | null, support = 10) => ({ benchmarkRunId: runId, metric, slice, value, support });

    beforeEach(() => {
      mockPrisma.visionModelVersion.findMany.mockResolvedValue([production]);
      // The candidate's run, then the production version's run on the same gold.
      mockPrisma.visionBenchmarkRun.findFirst.mockResolvedValueOnce(run()).mockResolvedValueOnce({ id: THEIR_RUN });
    });

    it("fails when production has no run on the same gold version to compare against", async () => {
      mockPrisma.visionBenchmarkRun.findFirst.mockReset();
      mockPrisma.visionBenchmarkRun.findFirst.mockResolvedValueOnce(run()).mockResolvedValueOnce(null);
      const f = await failures();
      expect(f[0]).toMatchObject({ name: "regression" });
      expect(f[0]!.detail).toMatch(/has no benchmark run on gold v1/);
    });

    it("passes within the tolerance and records what it compared with", async () => {
      mockPrisma.visionMetricResult.findMany.mockResolvedValue([
        metric(RUN, "ap:all", "all", 0.49), metric(THEIR_RUN, "ap:all", "all", 0.5),
        metric(RUN, "recall:ball", "all", 0.3), metric(THEIR_RUN, "recall:ball", "all", 0.3),
      ]);
      const request = await service.request(VERSION, trainer);
      expect(gateOf(request).comparedWith).toBe(OTHER);
      expect(gateOf(request).failures).toEqual([]);
    });

    it("fails a drop beyond the tolerance on the headline", async () => {
      mockPrisma.visionMetricResult.findMany.mockResolvedValue([
        metric(RUN, "ap:all", "all", 0.4), metric(THEIR_RUN, "ap:all", "all", 0.5),
      ]);
      const f = await failures();
      expect(f[0]!.detail).toContain("ap:all@all 0.400 vs production 0.500");
    });

    it("fails a drop on a critical slice however good the headline", async () => {
      mockPrisma.visionMetricResult.findMany.mockResolvedValue([
        metric(RUN, "ap:all", "all", 0.9), metric(THEIR_RUN, "ap:all", "all", 0.5),
        metric(RUN, "recall:ball", "quality:platform_copy", 0.1), metric(THEIR_RUN, "recall:ball", "quality:platform_copy", 0.4),
      ]);
      const f = await failures();
      expect(f[0]!.detail).toContain("recall:ball@quality:platform_copy");
    });

    it("fails when production measured something the candidate did not", async () => {
      mockPrisma.visionMetricResult.findMany.mockResolvedValue([metric(THEIR_RUN, "ap:all", "all", 0.5)]);
      const f = await failures();
      expect(f[0]!.detail).toContain("ap:all@all not measured for the candidate");
    });

    it("ignores a critical slice production could not measure either", async () => {
      mockPrisma.visionMetricResult.findMany.mockResolvedValue([
        metric(RUN, "ap:all", "all", 0.5), metric(THEIR_RUN, "ap:all", "all", 0.5),
        metric(THEIR_RUN, "recall:ball", "quality:platform_copy", null, 0),
      ]);
      await expect(service.request(VERSION, trainer)).resolves.toBeDefined();
    });
  });
});

// ── approve, reject ───────────────────────────────────────────────────────────

describe("approving", () => {
  const pending = { id: "pr-1", state: "pending", requestedBy: "u-trainer", fromStage: "benchmarked", toStage: "staging" };

  it("moves the version to the requested stage and records who decided", async () => {
    mockPrisma.visionPromotionRequest.findFirst.mockResolvedValue(pending);
    const result = await service.approve(VERSION, approver, "looked at the slices");
    expect(result).toEqual({ requestId: "pr-1", modelVersionId: VERSION, fromStage: "benchmarked", toStage: "staging", replacedVersionIds: [] });
    expect(mockPrisma.visionModelVersion.update.mock.calls[0]![0]).toMatchObject({ where: { id: VERSION }, data: { stage: "staging", promotedBy: "u-approver" } });
    expect(mockPrisma.visionPromotionRequest.update.mock.calls[0]![0].data).toMatchObject({ state: "approved", decidedBy: "u-approver", decisionReason: "looked at the slices" });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "model.promoted", targetId: VERSION }), approver);
  });

  it("re-runs the gate and leaves the request pending if it now fails", async () => {
    mockPrisma.visionPromotionRequest.findFirst.mockResolvedValue(pending);
    mockPrisma.visionJob.count.mockResolvedValue(0);
    await expect(service.approve(VERSION, approver)).rejects.toMatchObject({ response: { error: "PromotionGateFailed" } });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses when the version's stage moved since the request", async () => {
    mockPrisma.visionPromotionRequest.findFirst.mockResolvedValue({ ...pending, fromStage: "staging" });
    await expect(service.approve(VERSION, approver)).rejects.toMatchObject({ response: { error: "StageChanged" } });
  });

  it("refuses when nothing is pending", async () => {
    mockPrisma.visionPromotionRequest.findFirst.mockResolvedValue(null);
    await expect(service.approve(VERSION, approver)).rejects.toMatchObject({ response: { error: "NoPendingPromotion" } });
  });

  it("to production, demotes every other production version of the task and records them", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(version({ stage: "staging" }));
    mockPrisma.visionPromotionRequest.findFirst.mockResolvedValue({ ...pending, fromStage: "staging", toStage: "production" });
    // The gate's production lookup (regression), then the one that finds what to replace.
    mockPrisma.visionModelVersion.findMany.mockResolvedValue([]);
    mockPrisma.visionModelVersion.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: OTHER }]);
    const result = await service.approve(VERSION, approver);
    expect(result.replacedVersionIds).toEqual([OTHER]);
    expect(mockPrisma.visionModelVersion.updateMany).toHaveBeenCalledWith({ where: { id: { in: [OTHER] } }, data: { stage: "staging" } });
  });
});

describe("rejecting", () => {
  it("records the reason and who decided", async () => {
    mockPrisma.visionPromotionRequest.findUnique.mockResolvedValue({ id: "pr-1", state: "pending", modelVersionId: VERSION });
    await service.reject("pr-1", "ball recall on night footage is not good enough", approver);
    expect(mockPrisma.visionPromotionRequest.update.mock.calls[0]![0].data).toMatchObject({ state: "rejected", decidedBy: "u-approver", decisionReason: "ball recall on night footage is not good enough" });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "model.promotion.rejected" }), approver);
  });

  it("refuses to decide twice", async () => {
    mockPrisma.visionPromotionRequest.findUnique.mockResolvedValue({ id: "pr-1", state: "approved" });
    await expect(service.reject("pr-1", "late", approver)).rejects.toMatchObject({ response: { error: "PromotionDecided" } });
  });
});

// ── rollback ──────────────────────────────────────────────────────────────────

describe("rollback", () => {
  it("restores exactly what the promotion replaced, in one operation", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(version({ stage: "production" }));
    mockPrisma.visionPromotionRequest.findFirst.mockResolvedValue({ id: "pr-2", replacedVersionIds: [OTHER], decidedAt: new Date() });
    const result = await service.rollback(VERSION, approver);
    expect(result).toEqual({ rolledBack: VERSION, restored: [OTHER], promotionRequestId: "pr-2" });
    expect(mockPrisma.visionModelVersion.update).toHaveBeenCalledWith({ where: { id: VERSION }, data: { stage: "staging" } });
    expect(mockPrisma.visionModelVersion.updateMany).toHaveBeenCalledWith({ where: { id: { in: [OTHER] } }, data: { stage: "production" } });
    expect(mockPrisma.visionPromotionRequest.update.mock.calls[0]![0].data).toMatchObject({ rolledBackBy: "u-approver" });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "model.rolled_back" }), approver);
  });

  it("refuses a version that is not in production", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(version({ stage: "staging" }));
    await expect(service.rollback(VERSION, approver)).rejects.toMatchObject({ response: { error: "NotInProduction" } });
  });

  it("refuses when the promotion replaced nothing", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(version({ stage: "production" }));
    mockPrisma.visionPromotionRequest.findFirst.mockResolvedValue({ id: "pr-2", replacedVersionIds: [] });
    await expect(service.rollback(VERSION, approver)).rejects.toMatchObject({ response: { error: "NothingToRollBackTo" } });
    mockPrisma.visionPromotionRequest.findFirst.mockResolvedValue(null);
    await expect(service.rollback(VERSION, approver)).rejects.toMatchObject({ response: { error: "NothingToRollBackTo" } });
  });

  it("looks only at promotions not already rolled back", async () => {
    mockPrisma.visionModelVersion.findUnique.mockResolvedValue(version({ stage: "production" }));
    mockPrisma.visionPromotionRequest.findFirst.mockResolvedValue({ id: "pr-2", replacedVersionIds: [OTHER] });
    await service.rollback(VERSION, approver);
    expect(mockPrisma.visionPromotionRequest.findFirst.mock.calls[0]![0].where).toMatchObject({ state: "approved", toStage: "production", rolledBackAt: null });
  });
});
