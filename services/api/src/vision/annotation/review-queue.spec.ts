import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadVisionConfig } from "../config/vision.config";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import { VisionAnnotationService } from "./annotation.service";

/** The review queue (docs/vision/101): submitted work for a second person, never the reviewer's own. */
const task = (id: string, annotatorId: string | null, at: string) => ({
  id, videoAssetId: `asset-${id}`, startMs: 12_520, endMs: 12_560, samplingStrategy: "stage_disagreement", preLabelled: true, updatedAt: new Date(at),
  videoAsset: { sourceVideoRecord: { title: `Clip ${id}` } },
  versions: annotatorId === null ? [] : [{ id: `v-${id}`, annotatorId, createdAt: new Date(at), reviews: [] }],
});

const prisma = {
  visionAnnotationTask: { findMany: vi.fn() },
  visionReviewDecision: { count: vi.fn(), findMany: vi.fn() },
  adminUser: { findMany: vi.fn() },
};
let service: VisionAnnotationService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new VisionAnnotationService(prisma as never, new InMemoryObjectStore(), { canAnalyze: vi.fn() } as never, { record: vi.fn() } as never, loadVisionConfig());
  prisma.visionAnnotationTask.findMany.mockResolvedValue([
    task("a", "labeller", "2026-10-20T08:00:00Z"),
    task("b", "reviewer", "2026-10-20T08:05:00Z"),
    task("c", "labeller", "2026-10-20T08:10:00Z"),
  ]);
  prisma.adminUser.findMany.mockResolvedValue([{ id: "labeller", name: "Precious", email: "p@example.com" }]);
});

describe("the review queue", () => {
  it("lists only submitted work, oldest first", async () => {
    await service.reviewQueue({ userId: "reviewer", permissions: ["vision.review"] } as never);
    expect(prisma.visionAnnotationTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { state: "submitted" }, orderBy: { updatedAt: "asc" } }));
  });

  it("leaves out the reviewer's own work but counts it, and names the labeller", async () => {
    const result = await service.reviewQueue({ userId: "reviewer", permissions: ["vision.review"] } as never);
    expect(result.waiting).toBe(2);
    expect(result.yours).toBe(1);
    expect(result.tasks.map((t) => t.taskId)).toEqual(["a", "c"]);
    expect(result.tasks[0]).toMatchObject({ annotator: "Precious", source: "Clip a", versionId: "v-a", preLabelled: true });
  });

  it("caps the page but keeps the true count", async () => {
    const result = await service.reviewQueue({ userId: "reviewer", permissions: ["vision.review"] } as never, 1);
    expect(result.tasks).toHaveLength(1);
    expect(result.waiting).toBe(2);
  });

  it("lists everything for the operator key, which has no person to exclude", async () => {
    const result = await service.reviewQueue({ method: "api_key", permissions: [] } as never);
    expect(result.yours).toBe(0);
    expect(result.tasks).toHaveLength(3);
  });
});

describe("work sent back before", () => {
  it("marks a resubmission with its last send-back, and new work with none", async () => {
    const resubmitted = { ...task("r", "labeller", "2026-10-21T09:00:00Z"), versions: [
      { id: "v-r2", annotatorId: "labeller", createdAt: new Date("2026-10-21T09:00:00Z"), reviews: [] },
      { id: "v-r1", annotatorId: "labeller", createdAt: new Date("2026-10-20T09:00:00Z"), reviews: [{ createdAt: new Date("2026-10-20T10:00:00Z"), rejectionReason: "wrong_box" }] },
    ] };
    prisma.visionAnnotationTask.findMany.mockResolvedValue([task("a", "labeller", "2026-10-20T08:00:00Z"), resubmitted]);
    const result = await service.reviewQueue({ userId: "reviewer", permissions: ["vision.review"] } as never);
    expect(result.tasks.map((t) => t.sentBackBefore)).toEqual([null, { at: new Date("2026-10-20T10:00:00Z"), reason: "wrong_box" }]);
    expect(result.tasks[1]).toMatchObject({ versionId: "v-r2" });
  });
});

describe("work already reviewed", () => {
  const decision = (id: string, verdict: string, at: string, over: Record<string, unknown> = {}) => ({
    id, decision: verdict, rejectionReason: verdict === "rejected" ? "wrong_box" : null, notes: null, reviewerId: "reviewer", createdAt: new Date(at),
    annotationVersion: { id: `v-${id}`, annotatorId: "labeller", createdAt: new Date("2026-10-20T08:00:00Z"),
      task: { id: `task-${id}`, videoAssetId: "asset-1", startMs: 12_520, endMs: 12_560, samplingStrategy: "stage_disagreement", state: verdict === "approved" ? "approved" : "rejected",
        videoAsset: { sourceVideoRecord: { title: "Clip 1" } } } },
    ...over,
  });

  beforeEach(() => {
    prisma.visionReviewDecision.count.mockResolvedValue(3);
    prisma.visionReviewDecision.findMany.mockResolvedValue([decision("b", "rejected", "2026-10-22T08:00:00Z"), decision("a", "approved", "2026-10-21T08:00:00Z")]);
    prisma.adminUser.findMany.mockResolvedValue([{ id: "labeller", name: "Precious", email: "p@example.com" }, { id: "reviewer", name: "", email: "fola@example.com" }]);
  });

  it("lists labelling verdicts newest first, capped, with the true total", async () => {
    const result = await service.reviewed(2);
    expect(prisma.visionReviewDecision.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { targetKind: "vision_annotation_version", annotationVersionId: { not: null } }, orderBy: { createdAt: "desc" }, take: 2 }));
    expect(result.total).toBe(3);
    expect(result.decisions.map((d) => [d.taskId, d.decision])).toEqual([["task-b", "rejected"], ["task-a", "approved"]]);
  });

  it("names the labeller and the reviewer, and says where the frame is", async () => {
    const [sentBack] = (await service.reviewed()).decisions;
    expect(sentBack).toMatchObject({ annotator: "Precious", reviewer: "fola@example.com", rejectionReason: "wrong_box", taskState: "rejected",
      source: "Clip 1", startMs: 12_520, samplingStrategy: "stage_disagreement", versionId: "v-b" });
  });

  it("skips a verdict whose attempt is gone", async () => {
    prisma.visionReviewDecision.findMany.mockResolvedValue([decision("a", "approved", "2026-10-21T08:00:00Z", { annotationVersion: null })]);
    expect((await service.reviewed()).decisions).toEqual([]);
  });
});
