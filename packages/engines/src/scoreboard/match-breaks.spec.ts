import { describe, expect, it } from "vitest";
import {
  breakMsInHalf,
  breakMsWithin,
  formatBreakLength,
  matchBreakComment,
  matchBreakEventType,
  matchBreakSeconds,
  openMatchBreak,
  publicMatchBreaks,
  readMatchBreaks,
  sequenceWithBreaks,
  type MatchBreak,
} from "./match-breaks";

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 1, 15, minutes)).toISOString();
const ms = (minutes: number) => Date.parse(at(minutes));

const closed = (over: Partial<MatchBreak> = {}): MatchBreak => ({
  id: "b1",
  reason: "water_break",
  note: null,
  half: 1,
  minute: 20,
  addedMinute: null,
  startedAt: at(20),
  endedAt: at(23),
  ...over,
});

describe("readMatchBreaks", () => {
  it("keeps a good break and tidies its note", () => {
    const [b] = readMatchBreaks(
      [{ id: "b1", reason: "medical", note: "  No. 9, head  ", half: 2, minute: 60.4, addedMinute: 2, startedAt: at(1), endedAt: at(2) }],
      false
    );
    expect(b).toEqual({ id: "b1", reason: "medical", note: "No. 9, head", half: 2, minute: 60, addedMinute: 2, startedAt: at(1), endedAt: at(2) });
  });

  it("reads anything but an array as no breaks, and drops rows it cannot read", () => {
    expect(readMatchBreaks("nope", false)).toEqual([]);
    expect(
      readMatchBreaks(
        [null, "x", { id: "a" }, { id: "b", startedAt: "not a date" }, { startedAt: at(1) }, { id: "c", startedAt: at(5), endedAt: at(4) }],
        false
      )
    ).toEqual([]);
  });

  it("reads an unknown reason as other rather than losing the stoppage", () => {
    expect(readMatchBreaks([closed({ reason: "lunch" as never })], false)[0].reason).toBe("other");
  });

  it("caps the note", () => {
    expect(readMatchBreaks([closed({ note: "x".repeat(500) })], false)[0].note).toHaveLength(200);
  });

  it("drops an open break unless the clock is on one: it would hold the clock still for good", () => {
    const open = closed({ endedAt: null });
    expect(readMatchBreaks([open], false)).toEqual([]);
    expect(readMatchBreaks([open], true)).toEqual([open]);
  });

  it("keeps only the latest open break", () => {
    const older = closed({ id: "old", endedAt: null });
    const newer = closed({ id: "new", endedAt: null, startedAt: at(30) });
    expect(readMatchBreaks([older, closed({ id: "done" }), newer], true).map((b) => b.id)).toEqual(["done", "new"]);
  });
});

describe("the clock's arithmetic", () => {
  it("takes finished breaks off their own half only", () => {
    const breaks = [closed(), closed({ id: "b2", half: 2, startedAt: at(70), endedAt: at(72) })];
    expect(breakMsInHalf(breaks, 1, ms(90))).toBe(3 * 60_000);
    expect(breakMsInHalf(breaks, 2, ms(90))).toBe(2 * 60_000);
    expect(breakMsInHalf(undefined, 1, ms(90))).toBe(0);
  });

  it("holds the clock still through an open break, however late it is read", () => {
    const open = [closed({ endedAt: null })];
    const reading = (now: number) => now - ms(0) - breakMsInHalf(open, 1, now);
    expect(reading(ms(25))).toBe(20 * 60_000);
    expect(reading(ms(59))).toBe(20 * 60_000);
  });

  it("gives a break its own timer", () => {
    expect(matchBreakSeconds(closed(), ms(90))).toBe(180);
    expect(matchBreakSeconds(closed({ endedAt: null }), ms(21))).toBe(60);
  });

  it("counts only the part of a break inside a stretch of time", () => {
    const b = [closed()];
    expect(breakMsWithin(b, ms(0), ms(30))).toBe(3 * 60_000);
    expect(breakMsWithin(b, ms(21), ms(30))).toBe(2 * 60_000);
    expect(breakMsWithin(b, ms(0), ms(22))).toBe(2 * 60_000);
    expect(breakMsWithin(b, ms(25), ms(30))).toBe(0);
    expect(breakMsWithin([closed({ endedAt: null })], ms(0), ms(30))).toBe(10 * 60_000);
  });

  it("finds the open break", () => {
    expect(openMatchBreak([closed()])).toBeNull();
    expect(openMatchBreak(undefined)).toBeNull();
    expect(openMatchBreak([closed(), closed({ id: "o", endedAt: null })])?.id).toBe("o");
  });
});

describe("how a break reads", () => {
  it("formats its length", () => {
    expect(formatBreakLength(45)).toBe("45 s");
    expect(formatBreakLength(240)).toBe("4 min");
    expect(formatBreakLength(192)).toBe("3 min 12 s");
  });

  it("words the timeline from the reason, finished or not", () => {
    expect(matchBreakComment(closed(), ms(90))).toBe("20' - Water break. Play was stopped for 3 min.");
    expect(matchBreakComment(closed({ reason: "medical", addedMinute: 2, minute: 45, endedAt: null }), ms(25))).toBe(
      "45+2' - Medical emergency. Play is stopped."
    );
  });

  it("never lets the note reach the public", () => {
    const withNote = closed({ note: "No. 9, head injury" });
    expect(matchBreakComment(withNote, ms(90))).not.toContain("head injury");
    expect(publicMatchBreaks([withNote])[0].note).toBeNull();
  });

  it("uses the timeline's existing water break type", () => {
    expect(matchBreakEventType(closed())).toBe("water_break");
    expect(matchBreakEventType(closed({ reason: "weather" }))).toBe("match_break");
  });
});

describe("sequenceWithBreaks", () => {
  const event = (type: string, half: 1 | 2, minute: number, addedMinute: number | null = null) => ({ type, half, minute, addedMinute });

  it("puts a break ahead of the first event after it", () => {
    const { eventSequence, breakSequence } = sequenceWithBreaks(
      [event("kick_off", 1, 0), event("foul", 1, 20), event("goal", 1, 30), event("goal", 2, 50)],
      [closed({ minute: 20 }), closed({ id: "b2", half: 2, minute: 46, startedAt: at(70), endedAt: at(71) })]
    );
    expect(eventSequence).toEqual([0, 1, 3, 5]);
    expect(breakSequence).toEqual([2, 4]);
  });

  it("keeps a break ahead of full time in the same minute", () => {
    const { eventSequence, breakSequence } = sequenceWithBreaks(
      [event("foul", 2, 90), event("full_time", 2, 90)],
      [closed({ half: 2, minute: 90 })]
    );
    expect(eventSequence).toEqual([0, 2]);
    expect(breakSequence).toEqual([1]);
  });

  it("leaves events alone when there are no breaks, and copes with no events", () => {
    expect(sequenceWithBreaks([event("foul", 1, 3), event("foul", 1, 2)], []).eventSequence).toEqual([0, 1]);
    expect(sequenceWithBreaks([], [closed(), closed({ id: "b2", startedAt: at(30), endedAt: at(31) })]).breakSequence).toEqual([0, 1]);
  });
});
