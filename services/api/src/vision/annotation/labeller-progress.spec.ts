import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadVisionConfig } from "../config/vision.config";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import { VisionAnnotationService } from "./annotation.service";

/** Each labeller's output, pace and send-backs, for whoever reviews them. */
const version = (annotatorId: string, taskId: string, minutes: number | null, at: string, decisions: string[] = []) => ({
  annotatorId, taskId, effortMinutes: minutes, createdAt: new Date(at), reviews: decisions.map((decision) => ({ decision })),
});

const prisma = {
  visionAnnotationVersion: { findMany: vi.fn() },
  visionAnnotationTask: { findMany: vi.fn(), groupBy: vi.fn() },
  adminUser: { findMany: vi.fn() },
};
let service: VisionAnnotationService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new VisionAnnotationService(prisma as never, new InMemoryObjectStore(), { canAnalyze: vi.fn() } as never, { record: vi.fn() } as never, loadVisionConfig());
  // Newest first, as the service asks for them. Precious: task a sent back then fixed and
  // approved, task b waiting for review. Ada: one approved frame.
  prisma.visionAnnotationVersion.findMany.mockResolvedValue([
    version("precious", "b", 2, "2026-10-22T10:00:00Z"),
    version("precious", "a", 3, "2026-10-22T09:00:00Z", ["approved"]),
    version("ada", "c", 1.5, "2026-10-22T08:30:00Z", ["approved"]),
    version("precious", "a", 10.5, "2026-10-21T16:54:00Z", ["rejected"]),
  ]);
  prisma.visionAnnotationTask.findMany.mockResolvedValue([
    { id: "a", state: "approved", versions: [{ annotatorId: "precious" }] },
    { id: "b", state: "submitted", versions: [{ annotatorId: "precious" }] },
    { id: "c", state: "approved", versions: [{ annotatorId: "ada" }] },
  ]);
  prisma.visionAnnotationTask.groupBy.mockResolvedValue([
    { assignedTo: "precious", state: "assigned", _count: { _all: 1 } },
    { assignedTo: "newcomer", state: "assigned", _count: { _all: 1 } },
  ]);
  prisma.adminUser.findMany.mockResolvedValue([
    { id: "precious", name: "Second reviewer (freelance)", email: "p@example.com" },
    { id: "ada", name: null, email: "ada@example.com" },
  ]);
});

describe("labeller progress", () => {
  it("counts each person's frames, attempts, verdicts and held work", async () => {
    const { labellers } = await service.labellerProgress();
    const precious = labellers.find((l) => l.annotatorId === "precious")!;
    expect(precious).toMatchObject({
      name: "Second reviewer (freelance)", frames: 2, attempts: 3, approved: 1, awaitingReview: 1, sentBack: 1, claimed: 1, toFix: 0,
    });
    expect(precious.lastSubmittedAt).toEqual(new Date("2026-10-22T10:00:00Z"));
  });

  it("gives minutes as medians, so one frame left open does not skew the pace", async () => {
    const { labellers } = await service.labellerProgress();
    expect(labellers.find((l) => l.annotatorId === "precious")!.medianMinutes).toBe(3);
  });

  it("lists someone who has claimed work but not submitted yet, and falls back to the email", async () => {
    const { labellers } = await service.labellerProgress();
    expect(labellers.find((l) => l.annotatorId === "newcomer")).toMatchObject({ frames: 0, claimed: 1, medianMinutes: null });
    expect(labellers.find((l) => l.annotatorId === "ada")!.name).toBe("ada@example.com");
  });

  it("leaves abandoned windows out, and names an account that no longer exists as removed", async () => {
    prisma.adminUser.findMany.mockResolvedValue([]);
    const { labellers } = await service.labellerProgress();
    expect(prisma.visionAnnotationVersion.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { annotatorId: { not: null }, task: { state: { not: "abandoned" } } } }));
    expect(labellers.find((l) => l.annotatorId === "newcomer")!.name).toBe("Removed account (newcomer)");
  });

  it("puts the most productive first", async () => {
    const { labellers } = await service.labellerProgress();
    expect(labellers.map((l) => l.annotatorId)).toEqual(["precious", "ada", "newcomer"]);
  });
});
