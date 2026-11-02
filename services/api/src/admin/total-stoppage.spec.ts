import { describe, expect, it } from "vitest";
import {
  clockAfterStoppage,
  isStaleAfterStoppage,
  minuteOfStoppage,
  rescheduleRefusal,
  stoppageRefusal,
  type StoppageClock,
} from "./total-stoppage";

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 2, 15, minutes));
const iso = (minutes: number) => at(minutes).toISOString();

const clock = (over: Partial<StoppageClock> = {}): StoppageClock => ({
  halfLength: 45,
  half: 1,
  phase: "running",
  addedFirst: null,
  addedSecond: null,
  firstHalfStartedAt: iso(0),
  secondHalfStartedAt: null,
  ...over,
});

describe("stoppageRefusal", () => {
  it("allows a match in play, on a break, at half-time or at the end of a half", () => {
    for (const phase of ["running", "added_running", "on_break", "awaiting_added", "awaiting_second_half", "awaiting_full_time", "penalty_shootout"]) {
      expect(stoppageRefusal(clock({ phase }), "live", false)).toBeNull();
    }
  });

  it("refuses a match that has not kicked off", () => {
    expect(stoppageRefusal(null, "live", false)).toMatch(/not kicked off/);
    expect(stoppageRefusal(clock({ phase: "pre_kickoff" }), "live", false)).toMatch(/not kicked off/);
    expect(stoppageRefusal(clock({ firstHalfStartedAt: null }), "live", false)).toMatch(/not kicked off/);
  });

  it("refuses a finished, submitted, approved or reopened record", () => {
    expect(stoppageRefusal(clock({ phase: "finished" }), "live", false)).toMatch(/finished/);
    expect(stoppageRefusal(clock({ phase: "correction" }), "live", false)).toMatch(/finished/);
    expect(stoppageRefusal(clock(), "submitted", false)).toMatch(/finished/);
    expect(stoppageRefusal(clock(), "approved", false)).toMatch(/finished/);
  });

  it("refuses a second stoppage while the first waits", () => {
    expect(stoppageRefusal(clock(), "live", true)).toMatch(/already/);
  });
});

describe("minuteOfStoppage", () => {
  it("reads the minute in play", () => {
    expect(minuteOfStoppage(clock(), at(20).getTime())).toBe(21);
  });

  it("carries on from the half length in the second half", () => {
    const second = clock({ half: 2, secondHalfStartedAt: iso(60) });
    expect(minuteOfStoppage(second, at(70).getTime())).toBe(45 + 11);
  });

  it("leaves break time out, and holds during an open break", () => {
    const breaks = [{ id: "b", reason: "medical", note: null, half: 1, minute: 11, addedMinute: null, startedAt: iso(10), endedAt: null }] as const;
    expect(minuteOfStoppage(clock({ phase: "on_break", breaks }), at(40).getTime())).toBe(11);
  });

  it("stops climbing at the end of the half and its added time", () => {
    expect(minuteOfStoppage(clock({ phase: "awaiting_second_half", addedFirst: 2 }), at(58).getTime())).toBe(47);
  });

  it("reads nothing with no start time", () => {
    expect(minuteOfStoppage(clock({ firstHalfStartedAt: null }), at(5).getTime())).toBeNull();
  });
});

describe("isStaleAfterStoppage", () => {
  it("refuses a clock that kicked off before the stoppage", () => {
    expect(isStaleAfterStoppage(iso(0), iso(30))).toBe(true);
  });

  it("lets the rearranged game through", () => {
    expect(isStaleAfterStoppage(iso(90), iso(30))).toBe(false);
  });

  it("has nothing to say with no kick-off or no stoppage", () => {
    expect(isStaleAfterStoppage(null, iso(30))).toBe(false);
    expect(isStaleAfterStoppage(iso(0), null)).toBe(false);
  });
});

describe("clockAfterStoppage", () => {
  it("goes back to before kick-off with no start times or breaks, keeping the half length", () => {
    const reset = clockAfterStoppage(clock({ halfLength: 30, half: 2, addedFirst: 3, secondHalfStartedAt: iso(50) }));
    expect(reset).toEqual({ halfLength: 30, half: 1, phase: "pre_kickoff", addedFirst: null, addedSecond: null, firstHalfStartedAt: null, secondHalfStartedAt: null });
  });
});

describe("rescheduleRefusal", () => {
  it("needs a time still to come", () => {
    expect(rescheduleRefusal(at(10), at(20).getTime())).toMatch(/still to come/);
    expect(rescheduleRefusal(at(20), at(20).getTime())).toMatch(/still to come/);
    expect(rescheduleRefusal(at(30), at(20).getTime())).toBeNull();
  });
});
