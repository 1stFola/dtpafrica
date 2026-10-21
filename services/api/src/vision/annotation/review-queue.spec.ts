import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadVisionConfig } from "../config/vision.config";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import { VisionAnnotationService } from "./annotation.service";

/** The review queue (docs/vision/101): submitted work for a second person, never the reviewer's own. */
const task = (id: string, annotatorId: string | null, at: string) => ({
  id, videoAssetId: `asset-${id}`, startMs: 12_520, endMs: 12_560, samplingStrategy: "stage_disagreement", preLabelled: true, updatedAt: new Date(at),
  videoAsset: { sourceVideoRecord: { title: `Clip ${id}` } },
  versions: annotatorId === null ? [] : [{ id: `v-${id}`, annotatorId, createdAt: new Date(at) }],
});

const prisma = {
  visionAnnotationTask: { findMany: vi.fn() },
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
