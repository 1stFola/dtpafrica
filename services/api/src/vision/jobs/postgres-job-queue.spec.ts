import { beforeEach, describe, expect, it, vi } from "vitest";
import { visionKeys } from "@dtp/vision-contracts";
import { JobNotClaimableError, JobNotHeldByWorkerError } from "./job-queue";
import { PostgresJobQueue } from "./postgres-job-queue";

/**
 * The queue's state machine (docs/vision/50, PR-3).
 *
 * Every transition is one conditional UPDATE with the holder and the state in its
 * WHERE. These tests pin the WHERE clauses, and what happens when they match nothing:
 * a stale worker or the reaper must never overwrite a job that has moved on.
 */

const JOB = "11111111-1111-4111-8111-111111111111";
const W = "worker-1";

const mockPrisma = {
  visionJob: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  visionJobEvent: { create: vi.fn() },
};
const config = { jobs: { heartbeatIntervalSeconds: 30, missedHeartbeatsBeforeExpiry: 4 } };

function queue() {
  return new PostgresJobQueue(mockPrisma as never, config as never);
}

const held = { id: JOB, workerId: W, state: { in: ["claimed", "running"] } };

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.visionJob.updateMany.mockResolvedValue({ count: 1 });
});

describe("refusals are shaped HTTP errors", () => {
  it("a job that moved on is a 409; a job held by someone else is a 403", () => {
    expect(new JobNotClaimableError(JOB, "succeeded").getStatus()).toBe(409);
    expect(new JobNotHeldByWorkerError(JOB, W).getStatus()).toBe(403);
    expect(new JobNotClaimableError(JOB, "succeeded").getResponse()).toMatchObject({
      error: "JobNotClaimable",
      remediation: expect.any(String),
    });
  });
});

describe("markRunning and heartbeat", () => {
  it("write only where this worker holds an active job", async () => {
    await queue().markRunning(JOB, W);
    await queue().heartbeat(JOB, W, { stage: "x" });
    for (const call of mockPrisma.visionJob.updateMany.mock.calls) {
      expect(call[0].where).toEqual(held);
    }
  });

  it("refuse a stale worker after the job was handed to another", async () => {
    mockPrisma.visionJob.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.visionJob.findUnique.mockResolvedValue({ state: "running", workerId: "worker-2" });
    await expect(queue().heartbeat(JOB, W)).rejects.toBeInstanceOf(JobNotHeldByWorkerError);
  });

  it("refuse a job that already finished", async () => {
    mockPrisma.visionJob.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.visionJob.findUnique.mockResolvedValue({ state: "succeeded", workerId: W });
    await expect(queue().markRunning(JOB, W)).rejects.toBeInstanceOf(JobNotClaimableError);
  });
});

describe("succeed", () => {
  it("is conditional on the holder and an active state", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue({ state: "running", workerId: W, idempotencyKey: null });
    await expect(queue().succeed(JOB, W, "key-1:1", {})).resolves.toEqual({ alreadyApplied: false });
    expect(mockPrisma.visionJob.updateMany.mock.calls[0][0].where).toEqual(held);
  });

  it("recognises a concurrent retry of the same completion that landed first", async () => {
    mockPrisma.visionJob.findUnique
      .mockResolvedValueOnce({ state: "running", workerId: W, idempotencyKey: null })
      .mockResolvedValueOnce({ state: "succeeded", idempotencyKey: "key-1:1" });
    mockPrisma.visionJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(queue().succeed(JOB, W, "key-1:1", {})).resolves.toEqual({ alreadyApplied: true });
    expect(mockPrisma.visionJobEvent.create).not.toHaveBeenCalled();
  });
});

describe("fail", () => {
  it("never requeues a job that already succeeded, even from its holder", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue({ state: "succeeded", workerId: W, attemptNumber: 1, maxAttempts: 3 });
    await expect(queue().fail(JOB, W, { kind: "late" })).rejects.toBeInstanceOf(JobNotClaimableError);
    expect(mockPrisma.visionJob.updateMany).not.toHaveBeenCalled();
  });

  it("requeues to a new attempt with its own output prefix", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue({ state: "running", workerId: W, attemptNumber: 1, maxAttempts: 3 });
    await expect(queue().fail(JOB, W, { kind: "boom" })).resolves.toEqual({ requeued: true });
    const call = mockPrisma.visionJob.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: JOB, workerId: W, attemptNumber: 1 });
    expect(call.data.attemptNumber).toBe(2);
    expect(call.data.outputPrefix).toBe(visionKeys.inferencePrefix(JOB, 2));
  });

  it("fails terminally when no attempts are left", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue({ state: "running", workerId: W, attemptNumber: 3, maxAttempts: 3 });
    await expect(queue().fail(JOB, W, { kind: "boom" })).resolves.toEqual({ requeued: false });
    expect(mockPrisma.visionJob.updateMany.mock.calls[0][0].data.state).toBe("failed");
  });
});

describe("the reaper", () => {
  const stale = new Date(Date.now() - 3_600_000);

  it("fails the claim it judged, not a newer claim of the same job", async () => {
    mockPrisma.visionJob.findMany.mockResolvedValue([
      { id: JOB, workerId: W, heartbeatAt: stale, claimedAt: stale, resourceClass: "cpu_small", budgetSeconds: 999_999, budgetUsdCents: 999_999 },
    ]);
    mockPrisma.visionJob.findUnique.mockResolvedValue({ state: "running", workerId: W, attemptNumber: 1, maxAttempts: 3 });
    const out = await queue().reap();
    expect(out.requeued).toEqual([JOB]);
    expect(mockPrisma.visionJob.updateMany.mock.calls[0][0].where).toMatchObject({ workerId: W, claimedAt: stale });
  });

  it("leaves alone a job that succeeded while it was looking", async () => {
    mockPrisma.visionJob.findMany.mockResolvedValue([
      { id: JOB, workerId: W, heartbeatAt: stale, claimedAt: stale, resourceClass: "cpu_small", budgetSeconds: 999_999, budgetUsdCents: 999_999 },
    ]);
    mockPrisma.visionJob.findUnique.mockResolvedValue({ state: "succeeded", workerId: W, attemptNumber: 1, maxAttempts: 3 });
    const out = await queue().reap();
    expect(out).toEqual({ requeued: [], failed: [] });
    expect(mockPrisma.visionJob.updateMany).not.toHaveBeenCalled();
  });

  it("leaves alone a job whose claim changed between its read and its write", async () => {
    mockPrisma.visionJob.findMany.mockResolvedValue([
      { id: JOB, workerId: W, heartbeatAt: stale, claimedAt: stale, resourceClass: "cpu_small", budgetSeconds: 999_999, budgetUsdCents: 999_999 },
    ]);
    mockPrisma.visionJob.findUnique
      .mockResolvedValueOnce({ state: "running", workerId: W, attemptNumber: 1, maxAttempts: 3 })
      .mockResolvedValueOnce({ state: "claimed", workerId: "worker-2" });
    mockPrisma.visionJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(queue().reap()).resolves.toEqual({ requeued: [], failed: [] });
  });
});

describe("cancel", () => {
  it("is conditional on the job not having finished", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue({ state: "running" });
    await queue().cancel(JOB, "operator");
    expect(mockPrisma.visionJob.updateMany.mock.calls[0][0].where).toEqual({
      id: JOB,
      state: { notIn: ["succeeded", "failed", "cancelled"] },
    });
  });
});
