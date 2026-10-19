import { describe, expect, it, vi } from "vitest";
import { AdminMatchStatsService } from "./admin-match-stats.service";
import {
  AUTO_APPROVE_DELAY_MS,
  assessAutoApprove,
  danglingNumbers,
  type AutoApproveCandidate,
  type NumberedEvent,
} from "./sheet-auto-approve";
import { SheetAutoApproveService } from "./sheet-auto-approve.service";

/**
 * When a submitted sheet publishes itself.
 *
 * Publishing is the one step that reaches the public site, player profiles and the
 * standings, so the expensive mistake is approving a sheet a person should have looked
 * at. Most of these tests are about what holds a sheet back.
 */

const SUBMITTED = new Date("2026-10-19T17:00:00Z");
const MIN = 60_000;
const after = (minutes: number) => new Date(SUBMITTED.getTime() + minutes * MIN);

function sheet(over: Partial<AutoApproveCandidate> = {}): AutoApproveCandidate {
  return {
    sheetStatus: "submitted",
    submittedAt: SUBMITTED,
    submittedById: "recorder-1",
    recorderId: "recorder-1",
    autoSubmittedAt: null,
    idleLockedAt: null,
    idleReleasedAt: null,
    correctionRequested: false,
    isTraining: false,
    dangling: [],
    ...over,
  };
}

describe("the delay is what was asked for", () => {
  it("is ten minutes", () => {
    expect(AUTO_APPROVE_DELAY_MS).toBe(10 * MIN);
  });
});

describe("assessAutoApprove: timing", () => {
  it("waits ten minutes from submission", () => {
    expect(assessAutoApprove(sheet(), after(9)).approve).toBe(false);
    expect(assessAutoApprove(sheet(), new Date(after(10).getTime() - 1)).approve).toBe(false);
    expect(assessAutoApprove(sheet(), after(10))).toEqual({
      approve: true,
      dueAt: after(10),
      blocks: [],
    });
  });

  it("counts from the latest submission, so a resubmitted correction restarts it", () => {
    const resubmitted = sheet({ submittedAt: after(8) });
    expect(assessAutoApprove(resubmitted, after(12)).approve).toBe(false);
    expect(assessAutoApprove(resubmitted, after(18)).approve).toBe(true);
  });

  it("does nothing to a sheet that is live or already approved", () => {
    for (const sheetStatus of ["live", "approved"] as const) {
      expect(assessAutoApprove(sheet({ sheetStatus }), after(60))).toEqual({
        approve: false,
        dueAt: null,
        blocks: ["not_submitted"],
      });
    }
  });
});

describe("assessAutoApprove: condition 2, submitted by the recorder", () => {
  it("holds a sheet the clock submitted at full time", () => {
    const byClock = sheet({ submittedById: null, autoSubmittedAt: SUBMITTED });
    expect(assessAutoApprove(byClock, after(60)).blocks).toEqual(["submitted_by_clock"]);
  });

  it("is not fooled by a stale submitter left from an earlier round", () => {
    /* The auto-submit stamps the time and leaves the submitted-by columns alone. */
    const byClock = sheet({ submittedById: "recorder-1", autoSubmittedAt: SUBMITTED });
    expect(assessAutoApprove(byClock, after(60)).approve).toBe(false);
  });

  it("allows a sheet the recorder resubmitted after the clock had submitted it", () => {
    const later = sheet({ autoSubmittedAt: after(-30) });
    expect(assessAutoApprove(later, after(10)).approve).toBe(true);
  });

  it("holds a sheet somebody else submitted for the recorder", () => {
    const forThem = sheet({ submittedById: "super-admin" });
    expect(assessAutoApprove(forThem, after(60)).blocks).toEqual(["not_submitted_by_recorder"]);
  });

  it("holds a sheet with no recorded submitter or no recorder", () => {
    expect(assessAutoApprove(sheet({ submittedById: null }), after(60)).approve).toBe(false);
    expect(assessAutoApprove(sheet({ recorderId: null }), after(60)).approve).toBe(false);
  });

  it("holds a recording the idle sweep stopped", () => {
    const locked = sheet({ idleLockedAt: after(-40) });
    expect(assessAutoApprove(locked, after(60)).blocks).toEqual(["idle_locked"]);
  });

  it("still holds it after an admin released the lock", () => {
    const released = sheet({ idleReleasedAt: after(-30) });
    expect(assessAutoApprove(released, after(60)).blocks).toEqual(["idle_locked"]);
  });
});

describe("assessAutoApprove: condition 1, every number named", () => {
  it("holds a sheet with a dangling shirt number", () => {
    const dangling = sheet({
      dangling: [{ side: "home", number: 7, eventType: "goal", minute: 23 }],
    });
    expect(assessAutoApprove(dangling, after(60)).blocks).toEqual(["dangling_numbers"]);
  });
});

describe("assessAutoApprove: other holds", () => {
  it("holds a sheet with a correction request pending", () => {
    expect(assessAutoApprove(sheet({ correctionRequested: true }), after(60)).blocks).toEqual([
      "correction_requested",
    ]);
  });

  it("holds practice matches", () => {
    expect(assessAutoApprove(sheet({ isTraining: true }), after(60)).blocks).toEqual([
      "training",
    ]);
  });

  it("lists every hold, so the console can say all of them at once", () => {
    const everything = sheet({
      autoSubmittedAt: SUBMITTED,
      idleLockedAt: after(-40),
      dangling: [{ side: "away", number: 4, eventType: "foul", minute: 50 }],
    });
    expect(assessAutoApprove(everything, after(60)).blocks).toEqual([
      "submitted_by_clock",
      "idle_locked",
      "dangling_numbers",
    ]);
  });
});

describe("danglingNumbers", () => {
  const squad: Record<string, string> = { "home:9": "Ade Bola", "away:11": "Musa Ibe" };
  const find = (side: "home" | "away", number: number) => {
    const playerName = squad[`${side}:${number}`];
    return playerName === undefined ? undefined : { playerName };
  };
  const event = (over: Partial<NumberedEvent>): NumberedEvent => ({
    type: "goal",
    minute: 10,
    side: "home",
    playerNumber: 9,
    secondaryPlayerNumber: null,
    ...over,
  });

  it("is empty when every number names somebody", () => {
    expect(danglingNumbers([event({}), event({ side: "away", playerNumber: 11 })], find)).toEqual(
      []
    );
  });

  it("reports a number nobody in that side's squad wears", () => {
    expect(danglingNumbers([event({ playerNumber: 7, minute: 23 })], find)).toEqual([
      { side: "home", number: 7, eventType: "goal", minute: 23 },
    ]);
  });

  it("checks the assist and the incoming substitute too", () => {
    expect(danglingNumbers([event({ secondaryPlayerNumber: 14 })], find)).toEqual([
      { side: "home", number: 14, eventType: "goal", minute: 10 },
    ]);
  });

  it("reads the number against the event's own side", () => {
    /* Home 11 is not away 11. */
    expect(danglingNumbers([event({ playerNumber: 11 })], find)).toHaveLength(1);
  });

  it("reports each number once, where it was first used", () => {
    const events = [
      event({ playerNumber: 7, minute: 5, type: "shot" }),
      event({ playerNumber: 7, minute: 40 }),
    ];
    expect(danglingNumbers(events, find)).toEqual([
      { side: "home", number: 7, eventType: "shot", minute: 5 },
    ]);
  });

  it("treats a squad row with a blank name as no name", () => {
    const blank = () => ({ playerName: "  " });
    expect(danglingNumbers([event({})], blank)).toHaveLength(1);
  });

  it("ignores events with no number, and zero", () => {
    expect(danglingNumbers([event({ playerNumber: null }), event({ playerNumber: 0 })], find)).toEqual(
      []
    );
  });
});

describe("AdminMatchStatsService.autoApprove", () => {
  /** A fixture whose squads name home 9 and away 11, as `loadMatch` returns it. */
  function harness(sheetOver: Record<string, unknown> = {}, events: unknown[] = []) {
    const match = {
      id: "match-1",
      homeTeamId: "home-team",
      awayTeamId: "away-team",
      competitionId: "comp-1",
      competition: { formatConfig: null },
      squadPlayers: [],
      homeTeam: {
        squad: [{ teamId: "home-team", shirtNumber: 9, displayName: "Ade Bola", playerId: "p9" }],
      },
      awayTeam: {
        squad: [{ teamId: "away-team", shirtNumber: 11, displayName: "Musa Ibe", playerId: "p11" }],
      },
    };
    const row = {
      id: "sheet-1",
      matchId: "match-1",
      status: "submitted",
      eventsStatus: "submitted",
      submittedAt: SUBMITTED,
      submittedById: "recorder-1",
      recorderId: "recorder-1",
      autoSubmittedAt: null,
      idleLockedAt: null,
      idleReleasedAt: null,
      correctionRequestedSection: null,
      events,
      ...sheetOver,
    };
    const prisma = {
      sbMatch: { findUnique: vi.fn(async () => match) },
      sbMatchStatistics: { findUnique: vi.fn(async () => row) },
    };
    const service = new AdminMatchStatsService(prisma as never, {} as never, {} as never);
    const publish = vi
      .spyOn(service as unknown as { publishSheet: () => Promise<unknown> }, "publishSheet")
      .mockResolvedValue({});
    return { service, publish };
  }

  const goal = (side: "home" | "away", playerNumber: number) => ({
    id: `${side}-${playerNumber}`,
    type: "goal",
    minute: 30,
    side,
    playerNumber,
    secondaryPlayerNumber: null,
    half: 1,
  });

  it("publishes as the clock, stamping when", async () => {
    const { service, publish } = harness({}, [goal("home", 9), goal("away", 11)]);
    expect(await service.autoApprove("match-1", after(10))).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    const [, , ctx, stampedAt] = publish.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { displayName: string; userId?: string },
      Date,
    ];
    expect(ctx.displayName).toBe("Auto-approval");
    expect(ctx.userId).toBeUndefined();
    expect(stampedAt).toEqual(after(10));
  });

  it("does not publish a sheet whose numbers do not all resolve through the squads", async () => {
    const { service, publish } = harness({}, [goal("home", 9), goal("home", 7)]);
    expect(await service.autoApprove("match-1", after(60))).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not publish before the ten minutes are up", async () => {
    const { service, publish } = harness({}, [goal("home", 9)]);
    expect(await service.autoApprove("match-1", after(9))).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not publish a sheet an approver has already approved", async () => {
    const { service, publish } = harness({ status: "approved", eventsStatus: "approved" });
    expect(await service.autoApprove("match-1", after(60))).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not publish a sheet the clock submitted", async () => {
    const { service, publish } = harness({ autoSubmittedAt: SUBMITTED }, [goal("home", 9)]);
    expect(await service.autoApprove("match-1", after(60))).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("SheetAutoApproveService.sweep", () => {
  it("asks only for sheets that could be due, and approves what the service accepts", async () => {
    const findMany = vi.fn(async () => [{ matchId: "a" }, { matchId: "b" }, { matchId: "c" }]);
    const autoApprove = vi.fn(async (matchId: string) => {
      if (matchId === "b") throw new Error("boom");
      return matchId === "a";
    });
    const sweep = new SheetAutoApproveService(
      { sbMatchStatistics: { findMany } } as never,
      { autoApprove } as never
    );

    expect(await sweep.sweep(after(30))).toEqual({ approved: ["a"] });
    /* One failure does not stop the next sheet. */
    expect(autoApprove).toHaveBeenCalledTimes(3);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "submitted",
        eventsStatus: "submitted",
        submittedAt: { lte: after(20) },
        idleLockedAt: null,
        idleReleasedAt: null,
        correctionRequestedSection: null,
      },
      select: { matchId: true },
    });
  });

  it("never throws", async () => {
    const sweep = new SheetAutoApproveService(
      { sbMatchStatistics: { findMany: vi.fn(async () => Promise.reject(new Error("db"))) } } as never,
      { autoApprove: vi.fn() } as never
    );
    await expect(sweep.sweep(after(30))).resolves.toEqual({ approved: [] });
  });
});
