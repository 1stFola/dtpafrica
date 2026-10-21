import { describe, expect, it, vi } from "vitest";
import { AdminMatchStatsService, isCorrecting, readClock } from "./admin-match-stats.service";

/**
 * A finished match reopened for corrections.
 *
 * Reopening used to put the clock back to `running` on its match-day anchors, so the
 * console read hours past full time, jumped to the added-time prompt, and the public page
 * could show a finished match as live. The record now reopens into a `correction` phase:
 * the clock stays stopped, the server holds that phase whatever a console sends, and only
 * approval closes it.
 */

const recorder = { method: "jwt", userId: "recorder-a", permissions: ["scoreboard.stats.record"] };
const approver = {
  method: "jwt",
  userId: "admin-1",
  displayName: "Admin One",
  permissions: ["scoreboard.stats.approve"],
};

const anchors = {
  halfLength: 45,
  half: 2,
  addedFirst: 2,
  addedSecond: 4,
  firstHalfStartedAt: "2026-10-18T15:00:00.000Z",
  secondHalfStartedAt: "2026-10-18T16:02:00.000Z",
};

function setup(over: Record<string, unknown> = {}) {
  const sheet = {
    id: "sheet-1",
    matchId: "match",
    recorderId: "recorder-a",
    status: "submitted",
    eventsStatus: "submitted",
    clock: { ...anchors, phase: "finished" },
    events: [],
    tallies: {},
    correctionRequestedSection: null as string | null,
    updatedAt: new Date("2026-10-18T17:00:00.000Z"),
    ...over,
  };
  const store = {
    findUnique: vi.fn().mockResolvedValue(sheet),
    update: vi.fn((args) => Promise.resolve({ ...sheet, ...args.data })),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const service: any = Object.create(AdminMatchStatsService.prototype);
  service.prisma = {
    sbMatchStatistics: store,
    sbMatchSheetLog: { create: vi.fn() },
    sbMatchEvent: { deleteMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    sbMatch: { update: vi.fn() },
  };
  service.lifecycle = { reverseMatchEventStatsByFilter: vi.fn() };
  service.loadMatch = vi.fn().mockResolvedValue({
    id: "match",
    homeTeamId: "home",
    awayTeamId: "away",
    meta: {},
    competition: {},
  });
  service.present = vi.fn((_match, row) => row);
  service.syncFinalScoreFromSheet = vi.fn();
  return { service, store, sheet };
}

const clockWritten = (store: { update: any }) => store.update.mock.calls[0][0].data.clock;

describe("reopening a finished match", () => {
  it("reopens a full-time record for corrections, with the clock stopped where it ended", async () => {
    const { service, store } = setup({ correctionRequestedSection: "sheet" });
    await service.sendBack("match", "Correction approved", approver);
    const clock = clockWritten(store);
    expect(clock.phase).toBe("correction");
    /* Same anchors and added time: the reading the console freezes at is full time. */
    expect(clock).toMatchObject(anchors);
    expect(store.update.mock.calls[0][0].data.correctionRequestedSection).toBeNull();
  });

  it("reopens an approved sheet for corrections even when its clock never reached full time", async () => {
    const { service, store } = setup({
      status: "approved",
      eventsStatus: "approved",
      clock: { ...anchors, phase: "running" },
    });
    await service.sendBack("match", "Wrong scorer", approver);
    expect(clockWritten(store).phase).toBe("correction");
  });

  it("leaves a match still in play recording when a submitted sheet is sent back", async () => {
    const { service, store } = setup({ clock: { ...anchors, phase: "running" } });
    await service.sendBack("match", "Missed a corner", approver);
    expect(clockWritten(store)).toBeUndefined();
  });

  it("answers a correction request on a record locked at full time before it was submitted", async () => {
    /* Locked at full time while still `live`, with a request pending (which holds back the
       auto-submit). Refusing the send-back left that request with no way to approve it. */
    const { service, store } = setup({
      status: "live",
      eventsStatus: "live",
      correctionRequestedSection: "sheet",
    });
    await service.sendBack("match", "Correction approved", approver);
    expect(clockWritten(store).phase).toBe("correction");
  });

  it("still refuses to send back a live sheet nobody asked to correct", async () => {
    const { service } = setup({ status: "live", eventsStatus: "live" });
    await expect(service.sendBack("match", "", approver)).rejects.toThrow("already open for edits");
  });
});

describe("saving while correcting", () => {
  const correcting = { ...anchors, phase: "correction" };

  it("accepts edits: a correction is not locked at full time", async () => {
    const { service, store } = setup({ status: "live", eventsStatus: "live", clock: correcting });
    await service.saveTallies("match", {}, recorder, {
      events: [{ id: "g1", type: "goal", minute: 30, side: "home", playerNumber: 9, half: 1 }],
    });
    expect(store.updateMany).toHaveBeenCalledTimes(1);
  });

  it("keeps the stored clock when a device sends its match-day clock back", async () => {
    const { service, store } = setup({ status: "live", eventsStatus: "live", clock: correcting });
    await service.saveTallies("match", {}, recorder, { clock: { ...anchors, phase: "running" } });
    const data = store.updateMany.mock.calls[0][0].data;
    expect(data.clock.phase).toBe("correction");
    expect(data.fullTimeAt).toBeUndefined();
  });

  it("keeps the stored clock when a device sends full time, so the record does not lock itself", async () => {
    const { service, store } = setup({ status: "live", eventsStatus: "live", clock: correcting });
    await service.saveTallies("match", {}, recorder, { clock: { ...anchors, phase: "finished" } });
    expect(store.updateMany.mock.calls[0][0].data.clock.phase).toBe("correction");
  });

  it("does not let a console put a live match into correction mode", async () => {
    const live = { ...anchors, half: 1, phase: "running" };
    const { service, store } = setup({ status: "live", eventsStatus: "live", clock: live });
    await service.saveTallies("match", {}, recorder, { clock: { ...live, phase: "correction" } });
    expect(store.updateMany.mock.calls[0][0].data.clock.phase).toBe("running");
  });

  it("still locks a record at full time that nobody reopened", async () => {
    const { service } = setup({ status: "live", eventsStatus: "live" });
    await expect(service.saveTallies("match", {}, recorder, {})).rejects.toThrow("locked at full time");
  });
});

describe("submitting a correction", () => {
  it("can be sent whichever half the clock was left in", async () => {
    const { service, store } = setup({
      status: "live",
      eventsStatus: "live",
      clock: { ...anchors, half: 1, phase: "correction" },
    });
    await service.submit("match", recorder);
    expect(store.update.mock.calls[0][0].data.status).toBe("submitted");
  });
});

describe("approving a correction", () => {
  function approvable() {
    const ctx = setup({ clock: { ...anchors, phase: "correction" } });
    ctx.service.prisma.$transaction = vi.fn((ops: Promise<unknown>[]) => Promise.all(ops));
    ctx.service.lifecycle.onMatchFinished = vi.fn();
    ctx.service.lifecycle.refreshStandingsForFinishedMatch = vi.fn();
    ctx.service.loadMatch.mockResolvedValue({
      id: "match",
      homeTeamId: "home",
      awayTeamId: "away",
      homeTeam: { name: "Home", squad: [] },
      awayTeam: { name: "Away", squad: [] },
      squadPlayers: [],
      status: "scheduled",
      homeScore: 0,
      awayScore: 0,
      meta: {},
      stats: {},
      competition: {},
      competitionId: "comp",
    });
    return ctx;
  }

  it("closes the correction, so the record locks at full time again", async () => {
    const { service, store } = approvable();
    await service.approve("match", approver);
    expect(store.update.mock.calls[0][0].data.clock.phase).toBe("finished");
  });

  it("publishes it as a finished match, so the standings follow the corrected score", async () => {
    const { service } = approvable();
    await service.approve("match", approver);
    expect(service.prisma.sbMatch.update.mock.calls[0][0].data.status).toBe("finished");
    expect(service.lifecycle.onMatchFinished).toHaveBeenCalledWith("match");
  });

  it("is never approved by the clock", async () => {
    const { service, sheet } = approvable();
    const verdict = service.autoApproval(
      await service.loadMatch(),
      { ...sheet, submittedAt: new Date(0), submittedById: "recorder-a" },
      new Date()
    );
    expect(verdict.blocks).toContain("correcting");
  });
});

describe("the phase itself", () => {
  it("survives a read, so a reopened record stays reopened", () => {
    expect(isCorrecting(readClock({ ...anchors, phase: "correction" }))).toBe(true);
    expect(isCorrecting(readClock({ ...anchors, phase: "finished" }))).toBe(false);
  });
});
