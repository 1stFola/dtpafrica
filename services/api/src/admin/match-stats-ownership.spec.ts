import { describe, expect, it, vi } from "vitest";
import { AdminMatchStatsService, readEvents } from "./admin-match-stats.service";

const ctx = { method: "jwt", userId: "recorder-b", permissions: ["scoreboard.stats.record"] };
function setup(clock: unknown = null) {
  const sheet = { matchId: "match", recorderId: "recorder-a", clock, status: "live", updatedAt: new Date() };
  const store = {
    findUnique: vi.fn().mockResolvedValue(sheet),
    upsert: vi.fn().mockResolvedValue(sheet),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const service: any = Object.create(AdminMatchStatsService.prototype);
  service.prisma = { sbMatchStatistics: store };
  service.loadMatch = vi.fn().mockResolvedValue({ competition: {} });
  service.present = vi.fn((_match, row) => row);
  service.syncFinalScoreFromSheet = vi.fn();
  return { service, store };
}
const running = { phase: "running", firstHalfStartedAt: "2026-10-02T12:00:00Z" };

describe("fixture recording ownership", () => {
  it("does not claim an existing fixture when viewed", async () => {
    const { service, store } = setup();
    await service.openSheet("match", ctx);
    expect(store.updateMany).not.toHaveBeenCalled();
    expect(store.upsert).not.toHaveBeenCalled();
  });
  it("creates an unowned sheet safely when first viewed", async () => {
    const { service, store } = setup();
    store.findUnique.mockResolvedValue(null);
    await service.openSheet("match", ctx);
    const args = store.upsert.mock.calls[0][0];
    expect(args.create.recorderId).toBeUndefined();
    expect(args.update).toEqual({});
  });
  it("clears a legacy viewing lock on a pre-kickoff save", async () => {
    const { service, store } = setup();
    await service.saveTallies("match", {}, ctx);
    expect(store.updateMany.mock.calls[0][0].data.recorderId).toBeNull();
  });
  it("claims ownership only when kickoff is saved", async () => {
    const { service, store } = setup();
    await service.saveTallies("match", {}, ctx, { clock: running });
    expect(store.updateMany.mock.calls[0][0].data.recorderId).toBe("recorder-b");
  });
  it("rejects another recorder after kickoff", async () => {
    const { service, store } = setup(running);
    await expect(service.saveTallies("match", {}, ctx)).rejects.toThrow("Another recorder");
    expect(store.updateMany).not.toHaveBeenCalled();
  });
  it("rejects a competing save rather than overwriting it", async () => {
    const { service, store } = setup();
    store.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.saveTallies("match", {}, ctx, { clock: running })).rejects.toThrow("changed while saving");
  });
  it("does not allow kickoff to be cleared to bypass ownership", async () => {
    const { service, store } = setup(running);
    await expect(service.saveTallies("match", {}, { ...ctx, userId: "recorder-a" }, { clock: null }))
      .rejects.toThrow("Kickoff cannot be cleared");
    expect(store.updateMany).not.toHaveBeenCalled();
  });
  it("preserves the kickoff event", () => {
    expect(readEvents([{ id: "kickoff", type: "kick_off", minute: 0, side: "home", playerNumber: 9 }])).toHaveLength(1);
  });
});
