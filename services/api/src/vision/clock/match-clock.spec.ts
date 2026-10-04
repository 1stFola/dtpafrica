import { describe, expect, it } from "vitest";
import { clockAt, halfOfMinute, onPitchFor, parseSubstitution, sourceMsAt, windowOnClock, type ClockAnchor } from "./match-clock";

/** Kick-off nine seconds into the file; the first half ends at 45:00; the second kicks off at 50:00 of file time. */
const ANCHORS: ClockAnchor[] = [
  { half: 2, sourceMs: 3_000_000, endMs: null },
  { half: 1, sourceMs: 9000, endMs: 9000 + 45 * 60_000 },
];

describe("where a millisecond falls on the match clock", () => {
  it("reads minutes the broadcast way, into added time and across halves", () => {
    expect(clockAt(ANCHORS, 9000)).toMatchObject({ status: "on", half: 1, minute: 0, second: 0, display: "0:00" });
    expect(clockAt(ANCHORS, 9000 + 12 * 60_000 + 30_000)).toMatchObject({ status: "on", half: 1, minute: 12, second: 30, display: "12:30" });
    expect(clockAt(ANCHORS, 3_000_000 + 2 * 60_000 + 12_000)).toMatchObject({ status: "on", half: 2, minute: 47, second: 12, display: "47:12" });
    // Added time in the second half runs past 90.
    expect(clockAt(ANCHORS, 3_000_000 + 46 * 60_000)).toMatchObject({ half: 2, minute: 91, display: "91:00" });
  });

  it("knows before kick-off, between halves, after the final whistle, and unanchored", () => {
    expect(clockAt(ANCHORS, 5000)).toMatchObject({ status: "before_kickoff" });
    expect(clockAt(ANCHORS, 2_800_000)).toMatchObject({ status: "between_halves" });
    expect(clockAt([{ half: 1, sourceMs: 0, endMs: 1000 }], 2000)).toMatchObject({ status: "after_play" });
    expect(clockAt([], 1000)).toMatchObject({ status: "unanchored", display: "not anchored" });
    // Without an end mark, the half runs on: added time is not between halves.
    expect(clockAt([{ half: 1, sourceMs: 0, endMs: null }, { half: 2, sourceMs: 3_000_000, endMs: null }], 2_800_000)).toMatchObject({ status: "on", half: 1, minute: 46 });
  });

  it("goes the other way, from a match minute to a source millisecond", () => {
    expect(sourceMsAt(ANCHORS, 1, 12, 30)).toBe(9000 + 12 * 60_000 + 30_000);
    expect(sourceMsAt(ANCHORS, 2, 47, 12)).toBe(3_000_000 + 2 * 60_000 + 12_000);
    expect(sourceMsAt(ANCHORS, 2, 30)).toBeNull();
    expect(sourceMsAt(ANCHORS, 3, 91)).toBeNull();
  });

  it("puts a source window on the clock only when both ends are", () => {
    expect(windowOnClock(ANCHORS, 9000 + 600_000, 9000 + 900_000)).toEqual({ fromMinute: 10, toMinute: 15, display: "10:00–15:00" });
    expect(windowOnClock(ANCHORS, 5000, 9000 + 600_000)).toBeNull();
    expect(windowOnClock(ANCHORS, 2_800_000, 3_100_000)).toBeNull();
    // On the clock at the start, between halves at the end: no window either.
    expect(windowOnClock(ANCHORS, 2_600_000, 2_800_000)).toBeNull();
  });

  it("guesses a recorded minute's half by the base minutes", () => {
    expect(halfOfMinute(12)).toBe(1);
    expect(halfOfMinute(45)).toBe(2);
    expect(halfOfMinute(58)).toBe(2);
    expect(halfOfMinute(104)).toBe(3);
    expect(halfOfMinute(110)).toBe(4);
  });
});

describe("substitutions and who was on the pitch", () => {
  it("reads a substitution from the recorder's metadata or from the detail text", () => {
    expect(parseSubstitution({ teamId: "t", minute: 58, playerId: "p-off", detail: "#19 off, #14 on", metadata: null })).toEqual({ teamId: "t", minute: 58, offPlayerId: "p-off", offNumber: 19, onNumber: 14 });
    expect(parseSubstitution({ teamId: "t", minute: 61, playerId: null, detail: null, metadata: { playerNumber: 9, secondaryPlayerNumber: 7 } })).toEqual({ teamId: "t", minute: 61, offPlayerId: null, offNumber: 9, onNumber: 7 });
    expect(parseSubstitution({ teamId: null, minute: 1, playerId: null, detail: null, metadata: null })).toBeNull();
  });

  const subs = [{ teamId: "home", minute: 60, offPlayerId: "p-a", offNumber: 7, onNumber: 14 }];
  const starter = { isStarter: true, jerseyNumber: 7, playerId: "p-a" };
  const bench = { isStarter: false, jerseyNumber: 14, playerId: "p-b" };
  const other = { isStarter: true, jerseyNumber: 3, playerId: "p-c" };

  it("has a starter on until taken off, a substitute on from the minute they came on", () => {
    expect(onPitchFor(starter, subs, { fromMinute: 10, toMinute: 15 })).toBe("yes");
    expect(onPitchFor(starter, subs, { fromMinute: 70, toMinute: 75 })).toBe("no");
    expect(onPitchFor(bench, subs, { fromMinute: 10, toMinute: 15 })).toBe("no");
    expect(onPitchFor(bench, subs, { fromMinute: 70, toMinute: 75 })).toBe("yes");
    expect(onPitchFor(other, subs, { fromMinute: 70, toMinute: 75 })).toBe("yes");
  });

  it("is partly on for a window that crosses the change, and never on for an unused substitute", () => {
    expect(onPitchFor(starter, subs, { fromMinute: 58, toMinute: 62 })).toBe("partly");
    expect(onPitchFor(bench, subs, { fromMinute: 58, toMinute: 62 })).toBe("partly");
    expect(onPitchFor({ isStarter: false, jerseyNumber: 22, playerId: "p-d" }, subs, { fromMinute: 10, toMinute: 90 })).toBe("no");
  });

  it("matches the outgoing player by number when the record has no id", () => {
    const byNumber = [{ teamId: "home", minute: 60, offPlayerId: null, offNumber: 7, onNumber: 14 }];
    expect(onPitchFor(starter, byNumber, { fromMinute: 70, toMinute: 75 })).toBe("no");
    // A substitute taken off again later.
    const twice = [...subs, { teamId: "home", minute: 80, offPlayerId: "p-b", offNumber: 14, onNumber: 9 }];
    expect(onPitchFor(bench, twice, { fromMinute: 70, toMinute: 75 })).toBe("yes");
    expect(onPitchFor(bench, twice, { fromMinute: 85, toMinute: 90 })).toBe("no");
  });
});

describe("who was on the pitch, with the footage and the record on one timeline", () => {
  // Number 7 off for 14, recorded in the 61st minute: play from 15:00 to 16:00 of the second half.
  const subs = [{ teamId: "home", minute: 61, offPlayerId: "p-a", offNumber: 7, onNumber: 14, span: { from: 1015, to: 1016 } }];
  const starter = { isStarter: true, jerseyNumber: 7, playerId: "p-a" };
  const bench = { isStarter: false, jerseyNumber: 14, playerId: "p-b" };

  it("has the old player before the minute of the change and the new one after it", () => {
    expect(onPitchFor(starter, subs, { fromMinute: 1010, toMinute: 1015 })).toBe("yes");
    expect(onPitchFor(bench, subs, { fromMinute: 1010, toMinute: 1015 })).toBe("no");
    expect(onPitchFor(starter, subs, { fromMinute: 1016, toMinute: 1020 })).toBe("no");
    expect(onPitchFor(bench, subs, { fromMinute: 1016, toMinute: 1020 })).toBe("yes");
    // The first half is all before it.
    expect(onPitchFor(starter, subs, { fromMinute: 40, toMinute: 47 })).toBe("yes");
    expect(onPitchFor(bench, subs, { fromMinute: 40, toMinute: 47 })).toBe("no");
  });

  it("is partly for a window inside the minute of the change: the record does not say which second", () => {
    // Read as a point at 61 on the stopwatch's scale this was "yes" for the starter: 60:10-60:40 is before 61.
    expect(onPitchFor(starter, subs, { fromMinute: 1015.17, toMinute: 1015.67 })).toBe("partly");
    expect(onPitchFor(bench, subs, { fromMinute: 1015.17, toMinute: 1015.67 })).toBe("partly");
    expect(onPitchFor(starter, subs, { fromMinute: 1014, toMinute: 1015.5 })).toBe("partly");
    expect(onPitchFor(bench, subs, { fromMinute: 1015.5, toMinute: 1030 })).toBe("partly");
  });

  it("takes a substitute off again at the later change, not the earlier one", () => {
    const twice = [...subs, { teamId: "home", minute: 80, offPlayerId: "p-b", offNumber: 14, onNumber: 9, span: { from: 1034, to: 1035 } }];
    expect(onPitchFor(bench, twice, { fromMinute: 1020, toMinute: 1030 })).toBe("yes");
    expect(onPitchFor(bench, twice, { fromMinute: 1036, toMinute: 1040 })).toBe("no");
    expect(onPitchFor({ isStarter: false, jerseyNumber: 9, playerId: "p-c" }, twice, { fromMinute: 1036, toMinute: 1040 })).toBe("yes");
  });
});
