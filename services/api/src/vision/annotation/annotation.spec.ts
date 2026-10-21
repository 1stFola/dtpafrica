import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadVisionConfig } from "../config/vision.config";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import { DEMO_SCHEMA_SUFFIX, VisionAnnotationService } from "./annotation.service";

/**
 * Annotation.
 *
 * The gate for this increment is that the four things that cannot be undone are
 * refused rather than discouraged: losing a correction, letting someone approve
 * their own work, handing an annotator the master, and labelling footage DTP has no
 * right to analyse.
 */

const TASK = "task-1";
const SCHEMA = "schema-1";
const ASSET = "asset-1";

const mockPrisma = {
  visionLabelSchemaVersion: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  visionAnnotationTask: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  visionAnnotationVersion: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    aggregate: vi.fn(),
  },
  visionReviewDecision: { create: vi.fn(), groupBy: vi.fn() },
  visionActiveLearningItem: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  visionVideoAsset: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
};

const mockAudit = { record: vi.fn() };
const mockRights = { canAnalyze: vi.fn() };

let store: InMemoryObjectStore;
let service: VisionAnnotationService;

const schemaRow = (over: Record<string, unknown> = {}) => ({
  id: SCHEMA,
  version: "2026.1",
  supersededAt: null,
  definitions: { player: {} },
  ...over,
});

/** An asset that can be annotated: it has a proxy. */
const assetRow = (over: Record<string, unknown> = {}) => ({
  id: ASSET,
  durationMs: 2_700_000,
  variants: [{ id: "v1", objectKey: "proxies/asset-1/proxy.mp4", sourceOffsetMs: 0, fps: 25 }],
  ...over,
});

const taskRow = (over: Record<string, unknown> = {}) => ({
  id: TASK,
  videoAssetId: ASSET,
  labelSchemaVersionId: SCHEMA,
  samplingStrategy: "low_confidence",
  startMs: 60_000,
  endMs: 120_000,
  assignedTo: null,
  state: "queued",
  preLabelled: false,
  preLabelModelVersionId: null,
  ...over,
});

const validTask = {
  videoAssetId: ASSET,
  labelSchemaVersionId: SCHEMA,
  samplingStrategy: "low_confidence" as const,
  startMs: 60_000,
  endMs: 120_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  store = new InMemoryObjectStore();
  service = new VisionAnnotationService(
    mockPrisma as never,
    store,
    mockRights as never,
    mockAudit as never,
    loadVisionConfig()
  );

  mockPrisma.visionLabelSchemaVersion.findUnique.mockResolvedValue(schemaRow());
  mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(assetRow());
  mockPrisma.visionAnnotationTask.create.mockImplementation(({ data }: never) =>
    Promise.resolve({ ...taskRow(), ...(data as object) })
  );
  mockPrisma.visionAnnotationTask.findUnique.mockResolvedValue(taskRow());
  mockPrisma.visionAnnotationTask.update.mockResolvedValue(taskRow());
  mockPrisma.visionAnnotationVersion.findFirst.mockResolvedValue(null);
  mockPrisma.visionAnnotationVersion.create.mockImplementation(({ data }: never) =>
    Promise.resolve(data as object)
  );
  mockPrisma.visionReviewDecision.create.mockImplementation(({ data }: never) =>
    Promise.resolve({ id: "rev-1", ...(data as object) })
  );
  mockPrisma.visionActiveLearningItem.create.mockImplementation(({ data }: never) =>
    Promise.resolve({ id: "al-1", ...(data as object) })
  );
  mockRights.canAnalyze.mockResolvedValue({ allowed: true, reason: "granted", remediation: "" });
});

describe("label schema versions", () => {
  it("publishes a version", async () => {
    mockPrisma.visionLabelSchemaVersion.findUnique.mockResolvedValue(null);
    mockPrisma.visionLabelSchemaVersion.create.mockResolvedValue(schemaRow());
    const created = await service.createLabelSchema({ version: "2026.1", definitions: { pass: {} } });
    expect(created.version).toBe("2026.1");
  });

  it("refuses to reuse a version number", async () => {
    // Editing what a version means changes what every existing label meant.
    await expect(
      service.createLabelSchema({ version: "2026.1", definitions: { pass: {} } })
    ).rejects.toThrow(ConflictException);
  });

  it("refuses an empty taxonomy", async () => {
    mockPrisma.visionLabelSchemaVersion.findUnique.mockResolvedValue(null);
    await expect(service.createLabelSchema({ version: "x", definitions: {} })).rejects.toThrow(
      BadRequestException
    );
  });

  it("refuses definitions that are not an object", async () => {
    // `Object.keys("not-an-object").length` is 13, so a bare emptiness check would
    // have accepted a string and built a taxonomy out of character indices.
    mockPrisma.visionLabelSchemaVersion.findUnique.mockResolvedValue(null);
    await expect(
      service.createLabelSchema({ version: "x", definitions: "not-an-object" as never })
    ).rejects.toThrow(BadRequestException);
  });

  it("refuses a blank version identifier", async () => {
    mockPrisma.visionLabelSchemaVersion.findUnique.mockResolvedValue(null);
    await expect(
      service.createLabelSchema({ version: "   ", definitions: { a: {} } })
    ).rejects.toThrow(BadRequestException);
  });

  it("refuses to supersede while tasks are still open against it", async () => {
    // Otherwise an annotator is mid-task against definitions that just changed.
    mockPrisma.visionAnnotationTask.count.mockResolvedValue(3);
    await expect(service.supersedeLabelSchema(SCHEMA)).rejects.toThrow(ConflictException);
  });

  it("supersedes when nothing is open", async () => {
    mockPrisma.visionAnnotationTask.count.mockResolvedValue(0);
    mockPrisma.visionLabelSchemaVersion.update.mockResolvedValue(schemaRow({ supersededAt: new Date() }));
    await expect(service.supersedeLabelSchema(SCHEMA)).resolves.toBeTruthy();
  });
});

describe("task creation", () => {
  it("creates a task on eligible footage", async () => {
    const task = await service.createTask(validTask);
    expect(task.samplingStrategy).toBe("low_confidence");
    expect(task.state).toBe("queued");
  });

  it("refuses footage that may not be analysed", async () => {
    // The refusal must happen before a human sees it. Once disclosed, no later check
    // can undo the disclosure.
    mockRights.canAnalyze.mockResolvedValue({
      allowed: false,
      reason: "guardian_withdrawal",
      remediation: "Restore the grant.",
    });
    await expect(service.createTask(validTask)).rejects.toThrow(ForbiddenException);
    expect(mockPrisma.visionAnnotationTask.create).not.toHaveBeenCalled();
  });

  it("checks rights before creating, not after", async () => {
    mockRights.canAnalyze.mockResolvedValue({ allowed: false, reason: "no_scope", remediation: "" });
    await service.createTask(validTask).catch(() => undefined);
    expect(mockRights.canAnalyze).toHaveBeenCalledWith({ videoAssetId: ASSET });
  });

  it("refuses an asset with no proxy", async () => {
    // Annotators have no route to the master by design, so this task would be work
    // nobody can open.
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(assetRow({ variants: [] }));
    await expect(service.createTask(validTask)).rejects.toThrow(ConflictException);
  });

  it("refuses a superseded label schema", async () => {
    mockPrisma.visionLabelSchemaVersion.findUnique.mockResolvedValue(
      schemaRow({ supersededAt: new Date("2026-01-01") })
    );
    await expect(service.createTask(validTask)).rejects.toThrow(BadRequestException);
  });

  it("refuses a window that ends before it starts", async () => {
    await expect(
      service.createTask({ ...validTask, startMs: 120_000, endMs: 60_000 })
    ).rejects.toThrow(BadRequestException);
  });

  it("refuses a window longer than ten minutes", async () => {
    // A task nobody can finish in one sitting gets abandoned half-done.
    await expect(
      service.createTask({ ...validTask, startMs: 0, endMs: 11 * 60 * 1000 })
    ).rejects.toThrow(BadRequestException);
  });

  it("refuses a window past the end of the footage", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue(assetRow({ durationMs: 90_000 }));
    await expect(service.createTask(validTask)).rejects.toThrow(BadRequestException);
  });

  it("marks a task pre-labelled when a model produced the starting labels", async () => {
    // An unmarked pre-label is an anchoring-bias machine: the reviewer agrees with
    // the model and its error becomes ground truth.
    const task = await service.createTask({ ...validTask, preLabelModelVersionId: "model-1" });
    expect(task.preLabelled).toBe(true);
  });

  it("does not mark a task pre-labelled when no model was involved", async () => {
    const task = await service.createTask(validTask);
    expect(task.preLabelled).toBe(false);
  });

  it("refuses a sampling strategy outside the contract's list", async () => {
    // Enforced in the service, not only in the DTO: the dev server's transpiler
    // emits no decorator metadata, so the ValidationPipe never fires there and a
    // DTO-only guard is one no gate script can verify.
    await expect(
      service.createTask({ ...validTask, samplingStrategy: "because_i_felt_like_it" as never })
    ).rejects.toThrow(BadRequestException);
  });

  it("records the sampling strategy on the row", async () => {
    // Without it nobody can answer what fraction of the corpus came from hard cases.
    await service.createTask({ ...validTask, samplingStrategy: "new_domain_slice" });
    const data = mockPrisma.visionAnnotationTask.create.mock.calls[0]?.[0].data;
    expect(data.samplingStrategy).toBe("new_domain_slice");
  });
});

describe("claiming", () => {
  it("claims in a single statement so two annotators cannot get the same window", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ id: TASK }]);
    mockPrisma.visionAnnotationTask.findUniqueOrThrow.mockResolvedValue({
      ...taskRow({ assignedTo: "ann-1", state: "assigned" }),
      labelSchemaVersion: schemaRow(),
      videoAsset: assetRow(),
    });

    const result = await service.claimNextTask("ann-1");
    expect(result.task).toBeTruthy();
    // One raw statement did the claim; there is no separate read-then-update.
    expect(mockPrisma.$queryRaw).toHaveBeenCalledOnce();
    const sql = String(mockPrisma.$queryRaw.mock.calls[0]?.[0]?.join?.("?") ?? "");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("UPDATE vision_annotation_tasks");
  });

  it("never hands out a demo-seed task or one under a retired schema", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    await service.claimNextTask("ann-1");

    const [strings, ...values] = mockPrisma.$queryRaw.mock.calls[0]! as [string[], ...unknown[]];
    const sql = strings.join("?");
    expect(sql).toMatch(/label_schema_version_id IN \(\s*SELECT id FROM vision_label_schema_versions/);
    expect(sql).toContain("superseded_at IS NULL");
    expect(sql).toContain("version NOT LIKE ?");
    expect(values).toContain(`%${DEMO_SCHEMA_SUFFIX}`);
  });

  it("returns null when the queue is empty rather than throwing", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    await expect(service.claimNextTask("ann-1")).resolves.toEqual({ task: null });
  });

  it("hands out a proxy URL, never the master", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ id: TASK }]);
    mockPrisma.visionAnnotationTask.findUniqueOrThrow.mockResolvedValue({
      ...taskRow(),
      labelSchemaVersion: schemaRow(),
      videoAsset: assetRow(),
    });

    // Assert the BUCKET that was asked for, not just the key. A master-bucket
    // presign under a proxy-shaped key would pass a key-only check while handing an
    // annotator the raw youth footage that RBAC deliberately withholds from them.
    const presign = vi.spyOn(store, "presignGet");
    const { media } = await service.claimNextTask("ann-1");

    expect(presign).toHaveBeenCalledOnce();
    const [bucket, key] = presign.mock.calls[0]!;
    expect(bucket).toBe("derived");
    expect(bucket).not.toBe("master");
    expect(key).toBe("proxies/asset-1/proxy.mp4");
    expect(media?.url).toBeTruthy();
  });

  it("translates the window into proxy time", async () => {
    // A proxy that does not start at source zero would otherwise put every label a
    // few seconds out — an error that survives review because the labels look
    // internally consistent.
    mockPrisma.$queryRaw.mockResolvedValue([{ id: TASK }]);
    mockPrisma.visionAnnotationTask.findUniqueOrThrow.mockResolvedValue({
      ...taskRow(),
      labelSchemaVersion: schemaRow(),
      videoAsset: assetRow({
        variants: [{ objectKey: "proxies/a/p.mp4", sourceOffsetMs: 5_000, fps: 25 }],
      }),
    });

    const { media } = await service.claimNextTask("ann-1");
    expect(media?.windowStartMs).toBe(55_000);
    expect(media?.windowEndMs).toBe(115_000);
  });
});

describe("submission", () => {
  it("stores the labels and records a checksum", async () => {
    const version = await service.submit(TASK, { payload: { labels: [1, 2, 3] } });
    expect(version.payloadChecksum).toHaveLength(64);
    const stored = await store.getSmallObject("derived", version.payloadKey);
    expect(JSON.parse(stored!.toString("utf8"))).toEqual({ labels: [1, 2, 3] });
  });

  it("supersedes the previous submission instead of overwriting it", async () => {
    // The correction is the training signal and the only data here that cannot be
    // regenerated. An UPDATE would destroy exactly what is worth most.
    mockPrisma.visionAnnotationVersion.findFirst.mockResolvedValue({ id: "v1", supersedesId: null });
    const version = await service.submit(TASK, { payload: { boxes: [] } });
    expect(version.supersedesId).toBe("v1");
  });

  it("writes each submission to its own key, so the first survives the second", async () => {
    const first = await service.submit(TASK, { payload: { attempt: 1 } });
    mockPrisma.visionAnnotationVersion.findFirst.mockResolvedValue({ id: first.id, supersedesId: null });
    const second = await service.submit(TASK, { payload: { attempt: 2 } });

    expect(second.payloadKey).not.toBe(first.payloadKey);
    const original = await store.getSmallObject("derived", first.payloadKey);
    expect(JSON.parse(original!.toString("utf8"))).toEqual({ attempt: 1 });
  });

  it("records effort, because a model that doubles correction time is worse", async () => {
    const version = await service.submit(TASK, { payload: {}, effortMinutes: 42 });
    expect(version.effortMinutes).toBe(42);
  });

  it("refuses an implausible effort figure", async () => {
    await expect(service.submit(TASK, { payload: {}, effortMinutes: 900 })).rejects.toThrow(
      BadRequestException
    );
  });

  it("refuses to resubmit against an approved task", async () => {
    mockPrisma.visionAnnotationTask.findUnique.mockResolvedValue(taskRow({ state: "approved" }));
    await expect(service.submit(TASK, { payload: {} })).rejects.toThrow(ConflictException);
  });

  it("refuses a submission from someone the task is not assigned to", async () => {
    // Two people labelling the same window unknowingly destroys the independence
    // the disagreement metric depends on.
    mockPrisma.visionAnnotationTask.findUnique.mockResolvedValue(
      taskRow({ assignedTo: "ann-1", state: "assigned" })
    );
    await expect(
      service.submit(TASK, { payload: {}, annotatorId: "ann-2" })
    ).rejects.toThrow(ForbiddenException);
  });

  it("refuses a missing payload rather than storing nothing", async () => {
    await expect(
      service.submit(TASK, { payload: undefined as never })
    ).rejects.toThrow(BadRequestException);
  });

  it("verifies the checksum when reading labels back", async () => {
    const version = await service.submit(TASK, { payload: { ok: true } });
    mockPrisma.visionAnnotationVersion.findUnique.mockResolvedValue({
      id: version.id,
      payloadKey: version.payloadKey,
      payloadChecksum: version.payloadChecksum,
      taskId: TASK,
    });
    await expect(service.readSubmission(version.id)).resolves.toMatchObject({
      payload: { ok: true },
    });
  });

  it("refuses labels whose bytes no longer match the recorded checksum", async () => {
    const version = await service.submit(TASK, { payload: { ok: true } });
    mockPrisma.visionAnnotationVersion.findUnique.mockResolvedValue({
      id: version.id,
      payloadKey: version.payloadKey,
      payloadChecksum: "0".repeat(64),
      taskId: TASK,
    });
    // Better to refuse than to train on labels that changed underneath.
    await expect(service.readSubmission(version.id)).rejects.toThrow(ConflictException);
  });
});

describe("review", () => {
  const versionRow = (over: Record<string, unknown> = {}) => ({
    id: "ver-1",
    annotatorId: "ann-1",
    taskId: TASK,
    ...over,
  });

  beforeEach(() => {
    mockPrisma.visionAnnotationVersion.findUnique.mockResolvedValue(versionRow());
  });

  it("records an approval by someone else", async () => {
    const decision = await service.review("ver-1", { decision: "approved" }, {
      userId: "rev-1",
    } as never);
    expect(decision.decision).toBe("approved");
  });

  it("refuses to let an annotator approve their own work", async () => {
    // The same separation of duty the model registry has between training and
    // promotion. A second pair of eyes is the entire control.
    await expect(
      service.review("ver-1", { decision: "approved" }, { userId: "ann-1" } as never)
    ).rejects.toThrow(ForbiddenException);
    expect(mockPrisma.visionReviewDecision.create).not.toHaveBeenCalled();
  });

  it("requires a structured reason for a rejection", async () => {
    // Free text cannot be counted, and these drive which windows are sampled next.
    await expect(
      service.review("ver-1", { decision: "rejected" }, { userId: "rev-1" } as never)
    ).rejects.toThrow(BadRequestException);
  });

  it("requires a structured reason for a correction too", async () => {
    await expect(
      service.review("ver-1", { decision: "corrected" }, { userId: "rev-1" } as never)
    ).rejects.toThrow(BadRequestException);
  });

  it("sends a rejected window back to the active-learning queue", async () => {
    await service.review(
      "ver-1",
      { decision: "rejected", rejectionReason: "wrong_identity" },
      { userId: "rev-1" } as never
    );
    expect(mockPrisma.visionActiveLearningItem.create).toHaveBeenCalledOnce();
  });

  it("does not re-queue footage rejected for a rights problem", async () => {
    // A rights failure is a governance problem, not a sampling signal. Re-queueing
    // would put footage back in front of a human for exactly the wrong reason.
    await service.review(
      "ver-1",
      { decision: "rejected", rejectionReason: "rights_issue" },
      { userId: "rev-1" } as never
    );
    expect(mockPrisma.visionActiveLearningItem.create).not.toHaveBeenCalled();
  });

  it("moves the task to rejected, not approved, on a rejection", async () => {
    await service.review(
      "ver-1",
      { decision: "rejected", rejectionReason: "wrong_box" },
      { userId: "rev-1" } as never
    );
    const update = mockPrisma.visionAnnotationTask.update.mock.calls.at(-1)?.[0];
    expect(update.data.state).toBe("rejected");
  });

  it("refuses a rejection reason outside the contract's list", async () => {
    await expect(
      service.review(
        "ver-1",
        { decision: "rejected", rejectionReason: "i_didnt_like_it" as never },
        { userId: "rev-1" } as never
      )
    ).rejects.toThrow(BadRequestException);
  });

  it("refuses a decision outside the contract's list", async () => {
    await expect(
      service.review("ver-1", { decision: "looks_fine" as never }, { userId: "rev-1" } as never)
    ).rejects.toThrow(BadRequestException);
  });

  it("refuses to review an unknown version", async () => {
    mockPrisma.visionAnnotationVersion.findUnique.mockResolvedValue(null);
    await expect(
      service.review("nope", { decision: "approved" }, { userId: "rev-1" } as never)
    ).rejects.toThrow(NotFoundException);
  });
});

describe("active learning", () => {
  it("queues a window", async () => {
    const item = await service.enqueue({
      videoAssetId: ASSET,
      startMs: 0,
      endMs: 5_000,
      reason: "low_confidence",
      score: 0.8,
    });
    expect(item.state).toBe("queued");
  });

  it("refuses to queue footage that may not be analysed", async () => {
    // The queue is a list of footage humans will be shown, so the same gate applies.
    mockRights.canAnalyze.mockResolvedValue({ allowed: false, reason: "no_scope", remediation: "" });
    await expect(
      service.enqueue({ videoAssetId: ASSET, startMs: 0, endMs: 5_000, reason: "low_confidence", score: 1 })
    ).rejects.toThrow(ForbiddenException);
  });

  it("refuses a queue reason outside the contract's list", async () => {
    await expect(
      service.enqueue({ videoAssetId: ASSET, startMs: 0, endMs: 5_000, reason: "vibes", score: 1 })
    ).rejects.toThrow(BadRequestException);
  });

  it("refuses uniform_random as a queue reason", async () => {
    // An active-learning item exists because something is NOT routine, so the
    // control group would be a contradiction.
    await expect(
      service.enqueue({
        videoAssetId: ASSET, startMs: 0, endMs: 5_000, reason: "uniform_random", score: 1,
      })
    ).rejects.toThrow(BadRequestException);
  });

  it("carries the queue reason through as the task's sampling strategy", async () => {
    // Recording "uniform_random" would erase the fact that this window was chosen
    // deliberately, which is the whole value of the active-learning loop.
    mockPrisma.visionActiveLearningItem.findUnique.mockResolvedValue({
      id: "al-1",
      videoAssetId: ASSET,
      startMs: 0,
      endMs: 60_000,
      reason: "stage_disagreement",
      state: "queued",
    });
    mockPrisma.visionActiveLearningItem.update.mockResolvedValue({});

    const { task } = await service.convertQueueItem("al-1", { labelSchemaVersionId: SCHEMA });
    expect(task.samplingStrategy).toBe("stage_disagreement");
  });

  it("marks a converted item rather than deleting it", async () => {
    mockPrisma.visionActiveLearningItem.findUnique.mockResolvedValue({
      id: "al-1",
      videoAssetId: ASSET,
      startMs: 0,
      endMs: 60_000,
      reason: "low_confidence",
      state: "queued",
    });
    mockPrisma.visionActiveLearningItem.update.mockResolvedValue({});

    await service.convertQueueItem("al-1", { labelSchemaVersionId: SCHEMA });
    const update = mockPrisma.visionActiveLearningItem.update.mock.calls[0]?.[0];
    expect(update.data.state).toBe("converted");
  });

  it("refuses to convert an item twice", async () => {
    mockPrisma.visionActiveLearningItem.findUnique.mockResolvedValue({
      id: "al-1",
      state: "converted",
    });
    await expect(
      service.convertQueueItem("al-1", { labelSchemaVersionId: SCHEMA })
    ).rejects.toThrow(ConflictException);
  });
});

describe("mix report", () => {
  it("reports the hard-case share", async () => {
    // The number this module exists to keep honest: a corpus that is 95% uniform
    // random looks productive and teaches little.
    mockPrisma.visionAnnotationTask.groupBy.mockImplementation(({ by }: never) =>
      Promise.resolve(
        (by as string[])[0] === "samplingStrategy"
          ? [
              { samplingStrategy: "uniform_random", _count: { _all: 20 } },
              { samplingStrategy: "low_confidence", _count: { _all: 60 } },
              { samplingStrategy: "new_domain_slice", _count: { _all: 20 } },
            ]
          : [{ state: "approved", _count: { _all: 100 } }]
      )
    );
    mockPrisma.visionReviewDecision.groupBy.mockResolvedValue([]);
    mockPrisma.visionAnnotationVersion.aggregate.mockResolvedValue({
      _avg: { effortMinutes: 12 },
      _sum: { effortMinutes: 1200 },
      _count: { _all: 100 },
    });

    const report = await service.mixReport();
    expect(report.tasks).toBe(100);
    expect(report.hardCaseShare).toBe(0.8);
    expect(report.effort.averageMinutes).toBe(12);
  });

  it("reports null rather than zero when there are no tasks", async () => {
    // Zero would read as "no hard cases", which is a different claim from "no data".
    mockPrisma.visionAnnotationTask.groupBy.mockResolvedValue([]);
    mockPrisma.visionReviewDecision.groupBy.mockResolvedValue([]);
    mockPrisma.visionAnnotationVersion.aggregate.mockResolvedValue({
      _avg: { effortMinutes: null },
      _sum: { effortMinutes: null },
      _count: { _all: 0 },
    });
    const report = await service.mixReport();
    expect(report.hardCaseShare).toBeNull();
  });
});

/**
 * Boxes are checked at submit, against the task's own window and provenance.
 * The rule itself is tested in the contracts; what matters here is that a bad
 * submission is refused before anything is written, and a Phase 2 payload still
 * passes.
 */
describe("boxes at the door", () => {
  const MODEL = "55556666-7777-4888-9999-aaaabbbbcccc";
  const box = (overrides: Record<string, unknown> = {}) => ({
    sourceTimeMs: 60_500,
    class: "player",
    x: 0.1,
    y: 0.2,
    width: 0.05,
    height: 0.1,
    ...overrides,
  });

  beforeEach(() => {
    mockPrisma.visionAnnotationTask.findUnique.mockResolvedValue(taskRow());
    mockPrisma.visionAnnotationVersion.findFirst.mockResolvedValue(null);
    mockPrisma.visionAnnotationVersion.create.mockImplementation(({ data }: never) =>
      Promise.resolve({ id: "av-new", ...(data as object) })
    );
    mockPrisma.visionAnnotationTask.update.mockResolvedValue({});
  });

  it("accepts boxes inside the window and stores the payload as submitted", async () => {
    const payload = { windowSourceStartMs: 60_000, windowSourceEndMs: 120_000, uncertain: false, notes: null, boxes: [box()] };
    await service.submit(TASK, { payload });
    expect(mockPrisma.visionAnnotationVersion.create).toHaveBeenCalled();
  });

  it("refuses a box outside the task's window with every problem listed", async () => {
    const payload = { boxes: [box({ sourceTimeMs: 59_999 }), box({ class: "dog" })] };
    await expect(service.submit(TASK, { payload })).rejects.toMatchObject({
      response: {
        error: "InvalidBoxes",
        problems: [
          { index: 0, kind: "box_outside_window" },
          { index: 1, kind: "box_unknown_class" },
        ],
      },
    });
    expect(mockPrisma.visionAnnotationVersion.create).not.toHaveBeenCalled();
    expect(store.objectCount).toBe(0);
  });

  it("refuses a box crediting a model unless that model pre-labelled the task", async () => {
    await expect(
      service.submit(TASK, { payload: { boxes: [box({ fromModelVersionId: MODEL })] } })
    ).rejects.toMatchObject({ response: { error: "InvalidBoxes" } });

    mockPrisma.visionAnnotationTask.findUnique.mockResolvedValue(
      taskRow({ preLabelled: true, preLabelModelVersionId: MODEL })
    );
    await expect(
      service.submit(TASK, { payload: { boxes: [box({ fromModelVersionId: MODEL })] } })
    ).resolves.toBeDefined();
  });

  it("still accepts a payload with no boxes field at all", async () => {
    await expect(service.submit(TASK, { payload: { uncertain: true, notes: "hard" } })).resolves.toBeDefined();
  });
});

describe("the footage is handed out only while the grant stands (docs/vision/50, PR-4)", () => {
  const task = {
    id: "task-1", startMs: 0, endMs: 5_000,
    videoAsset: { id: ASSET, durationMs: 90_000, variants: [{ objectKey: "inference/t/1/proxy.mp4", sourceOffsetMs: 0, fps: 25 }] },
    versions: [],
  };

  it("refuses the task's media once analysis is withdrawn", async () => {
    mockPrisma.visionAnnotationTask.findUnique.mockResolvedValue(task);
    mockRights.canAnalyze.mockResolvedValue({ allowed: false, reason: "revoked", detail: "withdrawn", remediation: "r" });
    await expect(service.getTask("task-1")).rejects.toThrow(ForbiddenException);
  });

  it("hands it out while the grant stands", async () => {
    mockPrisma.visionAnnotationTask.findUnique.mockResolvedValue(task);
    const out = await service.getTask("task-1");
    expect(out.media.url).toEqual(expect.any(String));
    expect(mockRights.canAnalyze).toHaveBeenCalledWith({ videoAssetId: ASSET });
  });
});
