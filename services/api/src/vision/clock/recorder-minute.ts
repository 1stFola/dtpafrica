/**
 * The match clock as the recorder writes it.
 *
 * Vision's own clock (`match-clock.ts`) is a stopwatch: 46:12 is forty-six
 * minutes and twelve seconds after a kick-off. The match record is not written
 * that way. The recorder's console (`apps/web/.../useMatchClock.ts`) logs the
 * minute being played, counted from one, stops it at the half's own length,
 * and keeps what ran past that beside it:
 *
 *   - the minute is `floor(elapsed / 60) + 1`, never more than `halfLength`;
 *   - the second half starts at `halfLength`, whatever that is for this match
 *     -- a youth game of 30-minute halves reads 31' a minute after the restart;
 *   - added time is `floor(elapsed / 60) - halfLength` once that is above zero,
 *     stored as `metadata.addedMinute`, with `metadata.half` saying which half.
 *
 * Promotion writes into that record and matches against it, so it reads the
 * footage on this convention and no other (docs/vision/50 C1). The recorder has
 * no extra time; a reading in halves 3 or 4 has no recorder minute.
 */

import type { Half } from "./match-clock";

export const DEFAULT_HALF_LENGTH = 45;

export type RecorderMinute = {
  half: 1 | 2;
  /** The minute being played, capped at the half's length. */
  minute: number;
  /** Whole minutes past the half's length, or null inside it. */
  addedMinute: number | null;
  /** Seconds into the minute being played. */
  second: number;
};

/** What the recorder's console would have logged at this moment of a half. Null in extra time. */
export function recorderMinuteAt(reading: { half: Half; elapsedMs: number }, halfLength: number): RecorderMinute | null {
  if (reading.half !== 1 && reading.half !== 2) return null;
  const totalSeconds = Math.floor(Math.max(0, reading.elapsedMs) / 1000);
  const whole = Math.floor(totalSeconds / 60);
  const played = Math.min(whole + 1, halfLength);
  return {
    half: reading.half,
    minute: reading.half === 1 ? played : halfLength + played,
    addedMinute: whole > halfLength ? whole - halfLength : null,
    second: totalSeconds % 60,
  };
}

/** Whether a moment of a half is past the half's own length: added time, which only a marked whistle bounds. */
export function isPastHalfLength(elapsedMs: number, halfLength: number): boolean {
  return elapsedMs >= halfLength * 60_000;
}

/** Where a minute sits inside its half, added time counted on: 45+2 is two past 45. Comparable only within one half. */
export function positionInHalf(m: { minute: number; addedMinute: number | null }): number {
  return m.minute + (m.addedMinute ?? 0);
}

/** `45+2'`, or `23'`. */
export function formatRecorderMinute(m: { minute: number; addedMinute: number | null }): string {
  return m.addedMinute && m.addedMinute > 0 ? `${m.minute}+${m.addedMinute}'` : `${m.minute}'`;
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

/**
 * The half length this match was played to: what the recorder kicked off with,
 * else what the competition declares, else 45. The sheet's clock carries a
 * default before kick-off, so it counts only once the first half has started.
 */
export function recorderHalfLength(sheetClock: unknown, competitionFormatConfig: unknown): number {
  const clock = record(sheetClock);
  if (typeof clock.firstHalfStartedAt === "string" && typeof clock.halfLength === "number" && clock.halfLength > 0) return Math.floor(clock.halfLength);
  const declared = record(competitionFormatConfig).halfLengthMinutes;
  if (typeof declared === "number" && declared > 0) return Math.floor(declared);
  return DEFAULT_HALF_LENGTH;
}

/**
 * The half and added minute of an event already in the match record. The
 * recorder's rows say both in their metadata; a row entered another way says
 * neither, and its half is read from its minute: at or under the half length
 * is the first half, because the second starts one past it.
 */
export function recordedMinuteOf(event: { minute: number; metadata: unknown }, halfLength: number): { half: 1 | 2; minute: number; addedMinute: number | null } {
  const meta = record(event.metadata);
  const half = meta.half === 1 || meta.half === 2 ? meta.half : event.minute <= halfLength ? 1 : 2;
  const added = typeof meta.addedMinute === "number" && Number.isFinite(meta.addedMinute) && meta.addedMinute > 0 ? Math.floor(meta.addedMinute) : null;
  return { half, minute: event.minute, addedMinute: added };
}
