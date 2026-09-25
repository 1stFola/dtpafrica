import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadVisionConfig } from "../config/vision.config";
import { VisionJobDispatcher } from "./job-dispatcher.service";

/**
 * The dispatcher exists because the thing that should report a problem is exactly
 * the thing that has gone away: a killed pod never reports its failure, and an
 * abandoned multipart upload never reports itself either.
 */

const mockPrisma = { visionJob: { findFirst: vi.fn(), count: vi.fn() } };
const mockQueue = { reap: vi.fn() };
const mockUploads = { expireStale: vi.fn() };

function dispatcher(env: Record<string, string> = {}) {
  return new VisionJobDispatcher(
    mockPrisma as never,
    mockQueue as never,
    mockUploads as never,
    loadVisionConfig(env)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQueue.reap.mockResolvedValue({ requeued: [], failed: [] });
  mockUploads.expireStale.mockResolvedValue({ expired: [] });
  mockPrisma.visionJob.findFirst.mockResolvedValue(null);
  mockPrisma.visionJob.count.mockResolvedValue(0);
});

describe("a tick does both jobs", () => {
  it("reaps abandoned work and expires stale sessions", async () => {
    mockQueue.reap.mockResolvedValue({ requeued: ["job-1"], failed: ["job-2"] });
    mockUploads.expireStale.mockResolvedValue({ expired: ["session-1"] });

    const d = dispatcher();
    const result = await d.tick();

    expect(result).toEqual({
      requeued: ["job-1"],
      failed: ["job-2"],
      sessionsExpired: ["session-1"],
    });
    expect(d.stats).toMatchObject({ ticks: 1, requeued: 1, failed: 1, sessionsExpired: 1 });
  });

  // One failing pass must not stop the timer, and must not stop the other job.
  it("expires sessions even when reaping throws", async () => {
    mockQueue.reap.mockRejectedValue(new Error("deadlock"));
    mockUploads.expireStale.mockResolvedValue({ expired: ["session-1"] });

    const d = dispatcher();
    const result = await d.tick();

    expect(result.sessionsExpired).toEqual(["session-1"]);
    expect(d.stats.errors).toBe(1);
  });

  it("reaps even when expiring sessions throws", async () => {
    mockQueue.reap.mockResolvedValue({ requeued: ["job-1"], failed: [] });
    mockUploads.expireStale.mockRejectedValue(new Error("store down"));

    const d = dispatcher();
    const result = await d.tick();

    expect(result.requeued).toEqual(["job-1"]);
    expect(d.stats.errors).toBe(1);
  });

  // A slow pass overlapping the next tick would reap the same job twice.
  it("will not run two passes at once", async () => {
    let release: () => void = () => undefined;
    mockQueue.reap.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ requeued: [], failed: [] }); })
    );

    const d = dispatcher();
    const first = d.tick();
    const second = await d.tick();

    expect(second).toEqual({ requeued: [], failed: [], sessionsExpired: [] });
    expect(d.stats.ticks).toBe(1);

    release();
    await first;
  });
});

describe("lifecycle", () => {
  it("does not start while Vision is disabled", () => {
    const d = dispatcher({});
    d.onModuleInit();
    expect(mockQueue.reap).not.toHaveBeenCalled();
    d.onModuleDestroy();
  });

  it("starts when Vision is enabled, and stops cleanly", async () => {
    const d = dispatcher({ VISION_ENABLED: "true", VISION_STORAGE_BACKEND: "memory" });
    d.onModuleInit();
    expect((await d.health()).dispatcherRunning).toBe(true);
    d.onModuleDestroy();
    expect((await d.health()).dispatcherRunning).toBe(false);
  });
});

describe("health", () => {
  it("reports the oldest queued job so a stuck queue is visible", async () => {
    mockPrisma.visionJob.findFirst.mockResolvedValue({
      queuedAt: new Date(Date.now() - 90_000),
    });
    const health = await dispatcher().health();
    expect(health.oldestQueuedAgeSeconds).toBeGreaterThanOrEqual(89);
  });

  it("reports null when nothing is queued", async () => {
    expect((await dispatcher().health()).oldestQueuedAgeSeconds).toBeNull();
  });

  it("counts jobs whose heartbeat has gone stale", async () => {
    mockPrisma.visionJob.count.mockResolvedValue(3);
    expect((await dispatcher().health()).staleHeartbeats).toBe(3);
  });
});
