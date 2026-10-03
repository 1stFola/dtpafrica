import { createHash } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerTokenService } from "./worker-token.service";

/**
 * Bootstrap and worker tokens (docs/vision/50, C3).
 *
 * Both hashes live in one column, so the only thing keeping a bootstrap token out of
 * the job routes, and a worker token out of `register`, is `tokenKind`. These tests
 * hold that line from both sides.
 */

const TOKEN = "a".repeat(64);
const HASH = createHash("sha256").update(TOKEN).digest("hex");

const mockPrisma = {
  visionWorker: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
};
const config = { jobs: { workerTokenTtlHours: 12 } };

function service() {
  return new WorkerTokenService(mockPrisma as never, config as never);
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "worker-1",
    providerId: "local",
    resourceClass: "cpu_small",
    tokenHash: HASH,
    tokenExpiresAt: new Date(Date.now() + 3_600_000),
    tokenKind: "worker",
    retiredAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.visionWorker.updateMany.mockResolvedValue({ count: 1 });
});

describe("mintBootstrap", () => {
  it("stores the token as a bootstrap token", async () => {
    mockPrisma.visionWorker.create.mockResolvedValue({ id: "worker-1" });
    await service().mintBootstrap({ providerId: "local", resourceClass: "cpu_small", image: "img" });
    expect(mockPrisma.visionWorker.create.mock.calls[0][0].data.tokenKind).toBe("bootstrap");
  });
});

describe("verify accepts only a worker token", () => {
  it("verifies a worker token", async () => {
    mockPrisma.visionWorker.findUnique.mockResolvedValue(row());
    await expect(service().verify(TOKEN)).resolves.toMatchObject({ workerId: "worker-1" });
  });

  it("refuses an unredeemed bootstrap token, so it cannot claim jobs", async () => {
    mockPrisma.visionWorker.findUnique.mockResolvedValue(row({ tokenKind: "bootstrap" }));
    await expect(service().verify(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuses an expired token", async () => {
    mockPrisma.visionWorker.findUnique.mockResolvedValue(row({ tokenExpiresAt: new Date(Date.now() - 1) }));
    await expect(service().verify(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe("register accepts only a bootstrap token", () => {
  it("exchanges a bootstrap token, conditionally on it still being the bootstrap hash", async () => {
    mockPrisma.visionWorker.findUnique.mockResolvedValue(row({ tokenKind: "bootstrap" }));
    const out = await service().register(TOKEN);
    expect(out.identity.workerId).toBe("worker-1");
    const call = mockPrisma.visionWorker.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "worker-1", tokenHash: HASH, tokenKind: "bootstrap", retiredAt: null });
    expect(call.data.tokenKind).toBe("worker");
    expect(call.data.tokenHash).not.toBe(HASH);
  });

  it("refuses a worker token, so its lifetime cannot be extended by re-registering", async () => {
    mockPrisma.visionWorker.findUnique.mockResolvedValue(row({ tokenKind: "worker" }));
    await expect(service().register(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockPrisma.visionWorker.updateMany).not.toHaveBeenCalled();
  });

  it("refuses when a concurrent registration already swapped the token", async () => {
    mockPrisma.visionWorker.findUnique.mockResolvedValue(row({ tokenKind: "bootstrap" }));
    mockPrisma.visionWorker.updateMany.mockResolvedValue({ count: 0 });
    await expect(service().register(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
