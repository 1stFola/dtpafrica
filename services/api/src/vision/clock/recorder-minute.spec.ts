import { describe, expect, it } from "vitest";
import { formatRecorderMinute, isPastHalfLength, positionInHalf, recordedMinuteOf, recorderHalfLength, recorderMinuteAt } from "./recorder-minute";

const at = (half: 1 | 2 | 3 | 4, minutes: number, seconds = 0) => ({ half, elapsedMs: (minutes * 60 + seconds) * 1000 });

/**
 * What the recorder's console logs for a tap, copied from
 * `apps/web/src/modules/admin/pages/useMatchClock.ts` (`liveMinute`, `liveAdded`)
 * as it stood when this was written. The conversion under test is checked
 * against it second by second, so the two cannot drift apart unnoticed here.
 */
function console(half: 1 | 2, elapsed: number, halfLength: number) {
  const played = Math.floor(elapsed / 60) + 1;
  const liveMinute = half === 1 ? Math.min(played, halfLength) : halfLength + Math.min(played, halfLength);
  const wholeMinutes = Math.floor(elapsed / 60);
  const liveAdded = wholeMinutes > halfLength ? wholeMinutes - halfLength : null;
  return { minute: liveMinute, addedMinute: liveAdded };
}

describe("the minute the recorder would have logged", () => {
  it("counts the minute being played from one, and keeps the second", () => {
    expect(recorderMinuteAt(at(1, 0), 45)).toEqual({ half: 1, minute: 1, addedMinute: null, second: 0 });
    expect(recorderMinuteAt(at(1, 20, 15), 45)).toEqual({ half: 1, minute: 21, addedMinute: null, second: 15 });
    expect(recorderMinuteAt(at(1, 44, 59), 45)).toEqual({ half: 1, minute: 45, addedMinute: null, second: 59 });
  });

  it("stops at the half's length and keeps added time beside it", () => {
    // The console's first minute past the length still reads 45, with nothing added.
    expect(recorderMinuteAt(at(1, 45, 30), 45)).toEqual({ half: 1, minute: 45, addedMinute: null, second: 30 });
    expect(recorderMinuteAt(at(1, 46, 10), 45)).toEqual({ half: 1, minute: 45, addedMinute: 1, second: 10 });
    expect(recorderMinuteAt(at(1, 47, 12), 45)).toEqual({ half: 1, minute: 45, addedMinute: 2, second: 12 });
    expect(recorderMinuteAt(at(2, 48, 0), 45)).toEqual({ half: 2, minute: 90, addedMinute: 3, second: 0 });
  });

  it("starts the second half at the half's own length, not at 45", () => {
    expect(recorderMinuteAt(at(2, 0), 45)).toMatchObject({ half: 2, minute: 46 });
    expect(recorderMinuteAt(at(2, 1, 12), 45)).toMatchObject({ half: 2, minute: 47, second: 12 });
    // A youth game of 30-minute halves: a minute after the restart is the 32nd minute, not the 47th.
    expect(recorderMinuteAt(at(2, 1, 12), 30)).toMatchObject({ half: 2, minute: 32, addedMinute: null });
    expect(recorderMinuteAt(at(2, 29, 59), 30)).toMatchObject({ minute: 60, addedMinute: null });
    expect(recorderMinuteAt(at(2, 32, 0), 30)).toMatchObject({ minute: 60, addedMinute: 2 });
  });

  it("has no minute for extra time: the recorder's record has two halves", () => {
    expect(recorderMinuteAt(at(3, 2), 45)).toBeNull();
    expect(recorderMinuteAt(at(4, 2), 45)).toBeNull();
  });

  it("agrees with the recorder's console at every second of both halves, for every half length in use", () => {
    for (const halfLength of [20, 25, 30, 35, 40, 45]) {
      for (const half of [1, 2] as const) {
        for (let elapsed = 0; elapsed <= (halfLength + 12) * 60; elapsed += 1) {
          const got = recorderMinuteAt({ half, elapsedMs: elapsed * 1000 + 999 }, halfLength)!;
          expect({ minute: got.minute, addedMinute: got.addedMinute }, `half ${half}, ${halfLength}-minute halves, ${elapsed}s`).toEqual(console(half, elapsed, halfLength));
        }
      }
    }
  });

  it("knows when a moment is past the half's length", () => {
    expect(isPastHalfLength(44 * 60_000 + 59_000, 45)).toBe(false);
    expect(isPastHalfLength(45 * 60_000, 45)).toBe(true);
    expect(isPastHalfLength(31 * 60_000, 30)).toBe(true);
  });
});

describe("comparing and printing", () => {
  it("places added time past the capped minute, within one half", () => {
    expect(positionInHalf({ minute: 45, addedMinute: null })).toBe(45);
    expect(positionInHalf({ minute: 45, addedMinute: 2 })).toBe(47);
    expect(formatRecorderMinute({ minute: 45, addedMinute: 2 })).toBe("45+2'");
    expect(formatRecorderMinute({ minute: 23, addedMinute: null })).toBe("23'");
  });
});

describe("the half length a match was played to", () => {
  it("is what the recorder kicked off with, else the competition's, else 45", () => {
    expect(recorderHalfLength({ halfLength: 30, firstHalfStartedAt: "2026-10-03T10:00:00Z" }, { halfLengthMinutes: 35 })).toBe(30);
    // Before kick-off the sheet's clock carries a default, which says nothing about this match.
    expect(recorderHalfLength({ halfLength: 45, firstHalfStartedAt: null }, { halfLengthMinutes: 35 })).toBe(35);
    expect(recorderHalfLength(null, { halfLengthMinutes: 35 })).toBe(35);
    expect(recorderHalfLength(null, null)).toBe(45);
    expect(recorderHalfLength({ halfLength: 0, firstHalfStartedAt: "x" }, { halfLengthMinutes: -1 })).toBe(45);
    expect(recorderHalfLength("nonsense", ["nor this"])).toBe(45);
  });
});

describe("an event already in the record", () => {
  it("says its half and added minute in the recorder's metadata", () => {
    expect(recordedMinuteOf({ minute: 45, metadata: { half: 1, addedMinute: 2, source: "match_recorder" } }, 45)).toEqual({ half: 1, minute: 45, addedMinute: 2 });
    expect(recordedMinuteOf({ minute: 90, metadata: { half: 2, addedMinute: null } }, 45)).toEqual({ half: 2, minute: 90, addedMinute: null });
  });

  it("is read from its minute when it was entered another way", () => {
    expect(recordedMinuteOf({ minute: 45, metadata: null }, 45)).toEqual({ half: 1, minute: 45, addedMinute: null });
    expect(recordedMinuteOf({ minute: 46, metadata: {} }, 45)).toEqual({ half: 2, minute: 46, addedMinute: null });
    // With 30-minute halves the 31st minute is the second half.
    expect(recordedMinuteOf({ minute: 31, metadata: undefined }, 30)).toMatchObject({ half: 2 });
    expect(recordedMinuteOf({ minute: 30, metadata: { addedMinute: 0 } }, 30)).toEqual({ half: 1, minute: 30, addedMinute: null });
  });
});
