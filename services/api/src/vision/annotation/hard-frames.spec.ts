import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HARD_FRAMES_ARTIFACT_ROLE, HARD_FRAMES_VERSION, visionKeys } from "@dtp/vision-contracts";
import { loadVisionConfig } from "../config/vision.config";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import { VisionAnnotationService } from "./annotation.service";

/** hard_frames (docs/vision/99): picked frames reach people only through a deliberate queue step, with pre-labels marked as a model's. */
const JOB = "hf-job", ASSET = "asset-1", DETECTOR = "detector-v2";
const key = `${visionKeys.inferencePrefix(JOB, 1)}hard-frames.json`;
const artifact = (over: Record<string, unknown> = {}) => ({
  role: HARD_FRAMES_ARTIFACT_ROLE, calculationVersion: HARD_FRAMES_VERSION, videoAssetId: ASSET, sourceChecksum: "a".repeat(64), detectJobId: "det", detectorVersionId: DETECTOR,
  ballJobId: "ball", frameDurationMs: 40,
  frames: [
    { frameIndex: 250, sourceTimeMs: 10_000, cause: "ball_missed_between_sightings", reason: "stage_disagreement", score: 0.9,
      boxes: [{ class: "ball", x: 0.5, y: 0.4, width: 0.01, height: 0.015, confidence: 0.6 }, { class: "player", x: 0.2, y: 0.3, width: 0.03, height: 0.1, confidence: 0.95 }] },
    { frameIndex: 900, sourceTimeMs: 36_000, cause: "random_live_play", reason: "uniform_random", score: 0.1, boxes: [] },
  ],
  ...over,
});

const prisma = {
  visionJob: { findUnique: vi.fn() },
  visionVideoAsset: { findUnique: vi.fn() },
  visionEventGoldSet: { findFirst: vi.fn() },
  visionActiveLearningItem: { count: vi.fn(), createMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  visionAnnotationTask: { findUnique: vi.fn(), create: vi.fn() },
  visionLabelSchemaVersion: { findUnique: vi.fn() },
};
const rights = { canAnalyze: vi.fn() };
const audit = { record: vi.fn() };
let store: InMemoryObjectStore;
let service: VisionAnnotationService;

async function publish(body: object) {
  const text = JSON.stringify(body);
  await store.putSmallObject("derived", key, text, "application/json");
  prisma.visionJob.findUnique.mockResolvedValue({ id: JOB, type: "hard_frames", state: "succeeded", videoAssetId: ASSET, attemptNumber: 1,
    progress: { summary: { artifactChecksum: createHash("sha256").update(text).digest("hex") }, artifacts: [{ key, bucket: "derived", role: HARD_FRAMES_ARTIFACT_ROLE }] } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  store = new InMemoryObjectStore();
  service = new VisionAnnotationService(prisma as never, store, rights as never, audit as never, loadVisionConfig());
  rights.canAnalyze.mockResolvedValue({ allowed: true });
  prisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, sbMatchId: "match-1", durationMs: 2_700_000, variants: [{ id: "v" }] });
  prisma.visionEventGoldSet.findFirst.mockResolvedValue(null);
  prisma.visionActiveLearningItem.count.mockResolvedValue(0);
  await publish(artifact());
});

describe("queueing picked frames", () => {
  it("queues each frame as a one-frame window that remembers the job and the detector", async () => {
    await expect(service.queueHardFrames(JOB)).resolves.toEqual({ jobId: JOB, queued: 2, alreadyQueued: 0 });
    expect(prisma.visionActiveLearningItem.createMany).toHaveBeenCalledWith({ data: [
      { videoAssetId: ASSET, startMs: 10_000, endMs: 10_040, reason: "stage_disagreement", score: 0.9, state: "queued", sourceJobId: JOB, preLabelModelVersionId: DETECTOR },
      { videoAssetId: ASSET, startMs: 36_000, endMs: 36_040, reason: "uniform_random", score: 0.1, state: "queued", sourceJobId: JOB, preLabelModelVersionId: DETECTOR },
    ] });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "annotation.queue.hard_frames", targetId: JOB }), undefined);
  });

  it("adds nothing when the job is already queued", async () => {
    prisma.visionActiveLearningItem.count.mockResolvedValue(2);
    await expect(service.queueHardFrames(JOB)).resolves.toEqual({ jobId: JOB, queued: 0, alreadyQueued: 2 });
    expect(prisma.visionActiveLearningItem.createMany).not.toHaveBeenCalled();
  });

  it("refuses footage held out as an answer key, and footage that may not be analysed", async () => {
    prisma.visionEventGoldSet.findFirst.mockResolvedValue({ label: "Divine Praise vs Kiraa" });
    await expect(service.queueHardFrames(JOB)).rejects.toMatchObject({ response: { error: "FootageHeldOut" } });
    prisma.visionEventGoldSet.findFirst.mockResolvedValue(null);
    rights.canAnalyze.mockResolvedValue({ allowed: false, reason: "no_scope" });
    await expect(service.queueHardFrames(JOB)).rejects.toMatchObject({ response: { error: "RightsDenied" } });
    expect(prisma.visionActiveLearningItem.createMany).not.toHaveBeenCalled();
  });

  it("refuses an artifact that changed after its job completed, or is malformed", async () => {
    await store.putSmallObject("derived", key, JSON.stringify(artifact({ detectorVersionId: "other" })), "application/json");
    await expect(service.queueHardFrames(JOB)).rejects.toMatchObject({ response: { error: "HardFramesEvidenceInvalid" } });
    await publish(artifact({ frames: [{ ...artifact().frames[0], boxes: [{ class: "car", x: 0, y: 0, width: 0.1, height: 0.1, confidence: 0.5 }] }] }));
    await expect(service.queueHardFrames(JOB)).rejects.toMatchObject({ response: { error: "HardFramesEvidenceInvalid" } });
    await publish(artifact({ frames: [{ ...artifact().frames[0], reason: "uniform_random" }] }));
    await expect(service.queueHardFrames(JOB)).rejects.toMatchObject({ response: { error: "HardFramesEvidenceInvalid" } });
  });
});

describe("a task's pre-labels", () => {
  it("are the detector's boxes on the frames inside its window, each marked as the model's", async () => {
    prisma.visionAnnotationTask.findUnique.mockResolvedValue({ startMs: 10_000, endMs: 10_040, preLabelJobId: JOB, preLabelModelVersionId: DETECTOR });
    const { boxes } = await service.preLabels("task-1");
    expect(boxes).toEqual([
      { sourceTimeMs: 10_000, class: "ball", x: 0.5, y: 0.4, width: 0.01, height: 0.015, fromModelVersionId: DETECTOR },
      { sourceTimeMs: 10_000, class: "player", x: 0.2, y: 0.3, width: 0.03, height: 0.1, fromModelVersionId: DETECTOR },
    ]);
  });

  it("are none for a task that did not come from hard_frames", async () => {
    prisma.visionAnnotationTask.findUnique.mockResolvedValue({ startMs: 0, endMs: 40, preLabelJobId: null, preLabelModelVersionId: null });
    await expect(service.preLabels("task-1")).resolves.toEqual({ taskId: "task-1", boxes: [] });
  });

  it("carry across when a picked window becomes a task", async () => {
    prisma.visionActiveLearningItem.findUnique.mockResolvedValue({ id: "item", videoAssetId: ASSET, startMs: 10_000, endMs: 10_040, reason: "stage_disagreement", state: "queued", sourceJobId: JOB, preLabelModelVersionId: DETECTOR });
    prisma.visionLabelSchemaVersion.findUnique.mockResolvedValue({ id: "schema", version: "1", supersededAt: null });
    prisma.visionAnnotationTask.create.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: "task-1", ...data }));
    await service.convertQueueItem("item", { labelSchemaVersionId: "schema" });
    expect(prisma.visionAnnotationTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ preLabelled: true, preLabelModelVersionId: DETECTOR, preLabelJobId: JOB, samplingStrategy: "stage_disagreement" }) });
  });
});
