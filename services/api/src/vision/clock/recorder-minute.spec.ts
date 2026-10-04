import { describe, expect, it } from "vitest";
import { HALF_SPAN, formatRecorderMinute, isPastHalfLength, positionInHalf, recordedMinuteOf, recorderHalfLength, recorderMinuteAt, timelineOfReading, timelineSpanOfRecorded } from "./recorder-minute";

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

describe("one timeline for the footage and the record", () => {
  it("puts a moment of the footage at its minutes of play, each half apart", () => {
    expect(timelineOfReading(at(1, 12, 30))).toBe(12.5);
    expect(timelineOfReading(at(2, 0))).toBe(HALF_SPAN);
    expect(timelineOfReading(at(2, 15, 30))).toBe(HALF_SPAN + 15.5);
    // First-half added time is still the first half: nowhere near the second.
    expect(timelineOfReading(at(1, 47))).toBe(47);
    expect(timelineOfReading(at(3, 1))).toBe(2 * HALF_SPAN + 1);
  });

  it("reads a recorded minute as the stretch of play it stands for", () => {
    // The 23rd minute is play from 22:00 to 23:00.
    expect(timelineSpanOfRecorded({ half: 1, minute: 23, addedMinute: null }, 45)).toEqual({ from: 22, to: 23 });
    expect(timelineSpanOfRecorded({ half: 1, minute: 1, addedMinute: null }, 45)).toEqual({ from: 0, to: 1 });
    // 61' in the second half of a 45-minute game is the 16th minute of that half.
    expect(timelineSpanOfRecorded({ half: 2, minute: 61, addedMinute: null }, 45)).toEqual({ from: HALF_SPAN + 15, to: HALF_SPAN + 16 });
    // With 30-minute halves, 40' is the 10th minute of the second half, not the 40th of anything.
    expect(timelineSpanOfRecorded({ half: 2, minute: 40, addedMinute: null }, 30)).toEqual({ from: HALF_SPAN + 9, to: HALF_SPAN + 10 });
    // 45+2 is the minute from 47:00.
    expect(timelineSpanOfRecorded({ half: 1, minute: 45, addedMinute: 2 }, 45)).toEqual({ from: 47, to: 48 });
    // The capped minute with nothing added is two minutes of play: the console logs 44:xx and 45:xx both as 45.
    expect(timelineSpanOfRecorded({ half: 1, minute: 45, addedMinute: null }, 45)).toEqual({ from: 44, to: 46 });
    expect(timelineSpanOfRecorded({ half: 2, minute: 90, addedMinute: null }, 45)).toEqual({ from: HALF_SPAN + 44, to: HALF_SPAN + 46 });
  });

  it("holds every moment inside the span of the minute the console would have logged for it", () => {
    for (const halfLength of [30, 45]) {
      for (const half of [1, 2] as const) {
        for (let elapsed = 0; elapsed <= (halfLength + 8) * 60; elapsed += 7) {
          const reading = { half, elapsedMs: elapsed * 1000 };
          const span = timelineSpanOfRecorded(recorderMinuteAt(reading, halfLength)!, halfLength);
          const t = timelineOfReading(reading);
          expect(t >= span.from && t < span.to, `half ${half}, ${halfLength}-minute halves, ${elapsed}s`).toBe(true);
        }
      }
    }
  });
});
