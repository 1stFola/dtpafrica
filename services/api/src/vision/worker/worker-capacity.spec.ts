import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOSTED_IDLE_GRACE_MS, HOSTED_REGISTER_GRACE_MS, WorkerCapacityService } from "./worker-capacity.service";

/**
 * A hosted pod bills until something terminates it. The worker quits when idle, but a
 * provider restarts an exited container, so the control plane has to stop the pod.
 */
const NOW = new Date("2026-10-08T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const prisma = { visionWorker: { findMany: vi.fn() }, visionJob: { count: vi.fn(), findFirst: vi.fn() } };
const tokens = { retire: vi.fn() };
const terminate = vi.fn();
const compute = { get: vi.fn(() => ({ terminate })) };
const audit = { record: vi.fn() };
const service = new WorkerCapacityService(prisma as never, tokens as never, compute as never, audit as never);

function worker(overrides: Record<string, unknown> = {}) {
  return { id: "w-1", providerId: "runpod", providerRef: "pod-1", resourceClass: "gpu_24gb", retiredAt: null, tokenKind: "worker", firstSeenAt: ago(60 * 60 * 1000), lastSeenAt: ago(60 * 60 * 1000), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.visionJob.count.mockResolvedValue(0);
  prisma.visionJob.findFirst.mockResolvedValue(null);
});

describe("stopping idle hosted capacity", () => {
  it("only looks at unretired hosted workers that have a pod", async () => {
    prisma.visionWorker.findMany.mockResolvedValue([]);
    await service.reapIdle(NOW);
    expect(prisma.visionWorker.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { retiredAt: null, providerRef: { not: null }, providerId: { notIn: ["local", "mock"] } } }));
  });

  it("terminates the pod, then retires the worker, then records why", async () => {
    const order: string[] = [];
    terminate.mockImplementation(async () => { order.push("terminate"); });
    tokens.retire.mockImplementation(async () => { order.push("retire"); });
    prisma.visionWorker.findMany.mockResolvedValue([worker()]);
    prisma.visionJob.findFirst.mockResolvedValue({ finishedAt: ago(HOSTED_IDLE_GRACE_MS + 1000), heartbeatAt: ago(HOSTED_IDLE_GRACE_MS + 5000) });
    expect(await service.reapIdle(NOW)).toEqual(["w-1"]);
    expect(order).toEqual(["terminate", "retire"]);
    expect(terminate).toHaveBeenCalledWith("pod-1");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "worker.retired", targetId: "w-1", data: expect.objectContaining({ reason: "idle", terminated: true }) }), null);
  });

  it("keeps a worker that holds a job, however long ago it was seen", async () => {
    prisma.visionWorker.findMany.mockResolvedValue([worker()]);
    prisma.visionJob.count.mockResolvedValue(1);
    expect(await service.reapIdle(NOW)).toEqual([]);
    expect(prisma.visionJob.count).toHaveBeenCalledWith({ where: { workerId: "w-1", state: { in: ["claimed", "running"] } } });
    expect(terminate).not.toHaveBeenCalled();
  });

  it("keeps a registered worker inside its idle grace, measured from its latest job", async () => {
    prisma.visionWorker.findMany.mockResolvedValue([worker()]);
    prisma.visionJob.findFirst.mockResolvedValue({ finishedAt: ago(HOSTED_IDLE_GRACE_MS - 1000), heartbeatAt: null });
    expect(await service.reapIdle(NOW)).toEqual([]);
    prisma.visionJob.findFirst.mockResolvedValue(null);
    prisma.visionWorker.findMany.mockResolvedValue([worker({ lastSeenAt: ago(HOSTED_IDLE_GRACE_MS - 1000) })]);
    expect(await service.reapIdle(NOW)).toEqual([]);
    expect(terminate).not.toHaveBeenCalled();
  });

  it("gives an unregistered pod time to pull its image, then stops it", async () => {
    prisma.visionWorker.findMany.mockResolvedValue([worker({ tokenKind: "bootstrap", firstSeenAt: ago(HOSTED_REGISTER_GRACE_MS - 1000) })]);
    expect(await service.reapIdle(NOW)).toEqual([]);
    prisma.visionWorker.findMany.mockResolvedValue([worker({ tokenKind: "bootstrap", firstSeenAt: ago(HOSTED_REGISTER_GRACE_MS + 1000) })]);
    expect(await service.reapIdle(NOW)).toEqual(["w-1"]);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reason: "never_registered" }) }), null);
  });

  it("does not retire a worker whose pod it could not terminate, and goes on to the next", async () => {
    prisma.visionWorker.findMany.mockResolvedValue([worker(), worker({ id: "w-2", providerRef: "pod-2" })]);
    terminate.mockRejectedValueOnce(new Error("provider down"));
    expect(await service.reapIdle(NOW)).toEqual(["w-2"]);
    expect(tokens.retire).toHaveBeenCalledTimes(1);
    expect(tokens.retire).toHaveBeenCalledWith("w-2");
  });

  it("never terminates for a provider that started nothing", async () => {
    await service.stop({ id: "w-3", providerId: "local", providerRef: "ref", resourceClass: "cpu_small", retiredAt: null }, "operator", null);
    expect(terminate).not.toHaveBeenCalled();
    expect(tokens.retire).toHaveBeenCalledWith("w-3");
  });
});
