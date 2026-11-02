import { describe, expect, it } from "vitest";
import { readClock, type ClockState } from "./admin-match-stats.service";
import { IDLE_LIMIT_MS, assessIdle, type IdleCandidate } from "./recorder-idle";
import { publicLiveState } from "../scoreboard/public-live-state";

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 1, 15, minutes));
const iso = (minutes: number) => at(minutes).toISOString();

const breakRow = (from: number, to: number | null, half: 1 | 2 = 1) => ({
  id: `b-${from}`,
  reason: "medical",
  note: "No. 9, head injury",
  half,
  minute: from + 1,
  addedMinute: null,
  startedAt: iso(from),
  endedAt: to === null ? null : iso(to),
});

const clock = (over: Record<string, unknown> = {}) => ({
  halfLength: 45,
  half: 1,
  phase: "running",
  addedFirst: null,
  addedSecond: null,
  firstHalfStartedAt: iso(0),
  secondHalfStartedAt: null,
  ...over,
});

describe("readClock with breaks", () => {
  it("reads a clock with no breaks exactly as it did before", () => {
    expect(readClock(clock())).toEqual(clock());
    expect(readClock(clock())).not.toHaveProperty("breaks");
  });

  it("keeps the on_break phase and the open break", () => {
    const read = readClock(clock({ phase: "on_break", breaks: [breakRow(10, null)] }));
    expect(read?.phase).toBe("on_break");
    expect(read?.breaks?.[0]).toMatchObject({ reason: "medical", endedAt: null });
  });

  it("does not leave a clock on a break with none open", () => {
    expect(readClock(clock({ phase: "on_break" }))?.phase).toBe("running");
    expect(readClock(clock({ phase: "on_break", addedFirst: 3 }))?.phase).toBe("added_running");
    expect(readClock(clock({ phase: "on_break", half: 2, addedFirst: 3 }))?.phase).toBe("running");
  });

  it("drops an open break from a clock that is playing, which would hold it still", () => {
    expect(readClock(clock({ breaks: [breakRow(10, null)] }))?.breaks).toBeUndefined();
  });
});

const candidate = (over: Partial<IdleCandidate> = {}): IdleCandidate => ({
  matchId: "m",
  sheetStatus: "live",
  clockPhase: "running",
  lastEventAt: at(10),
  halfStartedAt: at(0),
  idleLockedAt: null,
  isTraining: false,
  ...over,
});

describe("a break is not an abandoned recording", () => {
  const limit = IDLE_LIMIT_MS / 60_000;

  it("never stops a recording during a break, however long it runs", () => {
    const verdict = assessIdle(
      candidate({ clockPhase: "on_break", breaks: [breakRow(12, null) as never] }),
      at(600)
    );
    expect(verdict).toEqual({ idle: false, reason: "not_running" });
  });

  it("does not count a finished break as quiet time", () => {
    const fifteenMinuteStoppage = [breakRow(12, 27) as never];
    /* Last event at 10, stopped 12 to 27, so at 30 only 5 quiet minutes have passed. */
    expect(assessIdle(candidate({ breaks: fifteenMinuteStoppage }), at(30))).toEqual({
      idle: false,
      reason: "within_limit",
    });
    /* Without the break, the same moment would have locked it. */
    expect(assessIdle(candidate(), at(30))).toMatchObject({ idle: true });
  });

  it("still stops a recording left quiet after the break", () => {
    const verdict = assessIdle(candidate({ breaks: [breakRow(12, 27) as never] }), at(15 + 10 + limit));
    expect(verdict).toMatchObject({ idle: true, quietMs: IDLE_LIMIT_MS });
    /* The reported start of the silence leaves out the break, so its length reads true. */
    if (verdict.idle) expect(verdict.since).toEqual(at(25));
  });

  it("measures from the half's start when nothing has been filed", () => {
    expect(
      assessIdle(candidate({ lastEventAt: null, breaks: [breakRow(5, 15) as never] }), at(25))
    ).toEqual({ idle: false, reason: "within_limit" });
  });

  it("leaves the verdict and its start time alone with no breaks", () => {
    expect(assessIdle(candidate(), at(10 + limit))).toEqual({
      idle: true,
      since: at(10),
      quietMs: IDLE_LIMIT_MS,
    });
  });
});

describe("the public minute during and after a break", () => {
  const state = (over: Record<string, unknown>, now: number) =>
    publicLiveState({
      liveEnabled: true,
      sheetStatus: "live",
      matchStatus: "scheduled",
      clock: readClock(clock(over)) as ClockState,
      idleLocked: false,
      minute: null,
      now: at(now).getTime(),
    });

  it("reads as live and holds the minute during a break", () => {
    const onBreak = { phase: "on_break", breaks: [breakRow(10, null)] };
    expect(state(onBreak, 12)).toEqual({ status: "live", minute: 11 });
    expect(state(onBreak, 50)).toEqual({ status: "live", minute: 11 });
  });

  it("takes the break off the minute once play resumes", () => {
    expect(state({ breaks: [breakRow(10, 15)] }, 20)).toEqual({ status: "live", minute: 16 });
  });

  it("takes off only the current half's breaks", () => {
    const second = {
      half: 2,
      secondHalfStartedAt: iso(60),
      breaks: [breakRow(10, 15), breakRow(70, 72, 2)],
    };
    expect(state(second, 75)).toEqual({ status: "live", minute: 45 + 14 });
  });
});
