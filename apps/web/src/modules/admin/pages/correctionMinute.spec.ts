import { describe, expect, it } from "vitest";
import type { RecordedEvent } from "../../../api/adminMatchStats";
import { checkTypedMinute, halfForMinute, placeChronologically } from "./correctionMinute";

const event = (id: string, over: Partial<RecordedEvent> = {}): RecordedEvent => ({
  id,
  type: "foul",
  minute: 10,
  addedMinute: null,
  side: "home",
  playerNumber: 4,
  secondaryPlayerNumber: null,
  half: 1,
  ...over,
});

describe("a typed minute takes the shape the clock gives one", () => {
  it("falls in the half the clock would number it in", () => {
    expect(halfForMinute(45, 45)).toBe(1);
    expect(halfForMinute(46, 45)).toBe(2);
    expect(checkTypedMinute("30", "", 45)).toEqual({ ok: true, minute: 30, added: null, half: 1 });
    expect(checkTypedMinute("62", "", 45)).toEqual({ ok: true, minute: 62, added: null, half: 2 });
  });

  it("takes added time on the last minute of either half, and nowhere else", () => {
    expect(checkTypedMinute("45", "2", 45)).toEqual({ ok: true, minute: 45, added: 2, half: 1 });
    expect(checkTypedMinute("90", "4", 45)).toEqual({ ok: true, minute: 90, added: 4, half: 2 });
    expect(checkTypedMinute("30", "2", 45).ok).toBe(false);
    expect(checkTypedMinute("30", "0", 45)).toMatchObject({ ok: true, added: null });
  });

  it("follows the half length the match was played to", () => {
    expect(checkTypedMinute("35", "1", 35)).toMatchObject({ ok: true, half: 1, added: 1 });
    expect(checkTypedMinute("71", "", 35).ok).toBe(false);
  });

  it("refuses a minute outside the match, a blank and a fraction", () => {
    for (const minute of ["", "0", "91", "-3", "12.5", "abc"]) {
      expect(checkTypedMinute(minute, "", 45).ok).toBe(false);
    }
    expect(checkTypedMinute("90", "31", 45).ok).toBe(false);
  });

  it("allows 0' only when editing an event already there, the kick-off", () => {
    expect(checkTypedMinute("0", "", 45, { allowZero: true })).toMatchObject({ ok: true, half: 1 });
  });
});

describe("a typed event lands where it happened", () => {
  const log = [
    event("ko", { type: "kick_off", minute: 0 }),
    event("a", { minute: 12 }),
    event("b", { minute: 45, addedMinute: 2 }),
    event("c", { minute: 60, half: 2 }),
    event("ft", { type: "full_time", minute: 90, addedMinute: 3, half: 2 }),
  ];
  const ids = (events: RecordedEvent[]) => events.map((e) => e.id);

  it("goes between the events either side of it", () => {
    expect(ids(placeChronologically(log, event("n", { minute: 30 })))).toEqual(["ko", "a", "n", "b", "c", "ft"]);
    expect(ids(placeChronologically(log, event("n", { minute: 45, addedMinute: 1 })))).toEqual([
      "ko", "a", "n", "b", "c", "ft",
    ]);
  });

  it("goes after an event in the same minute, keeping the order they were entered in", () => {
    expect(ids(placeChronologically(log, event("n", { minute: 12 })))).toEqual(["ko", "a", "n", "b", "c", "ft"]);
  });

  it("never goes after full time, even in the last minute of added time", () => {
    expect(ids(placeChronologically(log, event("n", { minute: 90, addedMinute: 5, half: 2 })))).toEqual([
      "ko", "a", "b", "c", "n", "ft",
    ]);
  });

  it("goes on the end of a log with no full time", () => {
    expect(ids(placeChronologically(log.slice(0, 4), event("n", { minute: 80, half: 2 })))).toEqual([
      "ko", "a", "b", "c", "n",
    ]);
  });
});
