import type { RecordedEvent } from "../../../api/adminMatchStats";
import { SHOOTOUT_TYPES } from "./shootout";

/**
 * Typed minutes for a match reopened for corrections.
 *
 * Live, the minute comes from the running clock and cannot be typed, so an event is never
 * filed against a minute nobody saw. Once the match is over there is no clock to read, so
 * the recorder types it -- held to the same shape the clock would have produced: a minute
 * inside one of the two halves, and added time only on the last minute of a half (`45+2'`,
 * never `30+2'`).
 */

export type TypedMinute = { minute: number; added: number | null; half: 1 | 2 };

export type MinuteCheck = ({ ok: true } & TypedMinute) | { ok: false; reason: string };

/** The longest added time the clock's own prompt would accept, with room for "More time". */
const MAX_ADDED = 30;

/** Which half a minute falls in, the way the clock numbers them: 1-45 then 46-90. */
export function halfForMinute(minute: number, halfLength: number): 1 | 2 {
  return minute <= halfLength ? 1 : 2;
}

function wholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * Check a typed minute and added time.
 *
 * `allowZero` is for editing an event already at 0' (the kick-off): the event grid never
 * files one, so a new event starts at the first minute.
 */
export function checkTypedMinute(
  minuteInput: string,
  addedInput: string,
  halfLength: number,
  options: { allowZero?: boolean } = {}
): MinuteCheck {
  const fullLength = halfLength * 2;
  const minute = wholeNumber(minuteInput);
  const lowest = options.allowZero ? 0 : 1;
  if (minute == null || minute < lowest || minute > fullLength) {
    return { ok: false, reason: `Enter a minute from ${lowest} to ${fullLength}.` };
  }
  const added = addedInput.trim() === "" ? 0 : wholeNumber(addedInput);
  if (added == null || added > MAX_ADDED) {
    return { ok: false, reason: `Added time is a whole number of minutes, at most ${MAX_ADDED}.` };
  }
  if (added > 0 && minute !== halfLength && minute !== fullLength) {
    return {
      ok: false,
      reason: `Added time goes on the last minute of a half: ${halfLength}+${added}′ or ${fullLength}+${added}′.`,
    };
  }
  return { ok: true, minute, added: added > 0 ? added : null, half: halfForMinute(minute, halfLength) };
}

/** Full time and the shootout close the log; nothing typed goes after them. */
export function closesTheMatch(event: RecordedEvent): boolean {
  return event.type === "full_time" || event.type === "penalty_shootout" || SHOOTOUT_TYPES.has(event.type);
}

function comesAfter(a: RecordedEvent, b: RecordedEvent): boolean {
  if (a.half !== b.half) return a.half > b.half;
  if (a.minute !== b.minute) return a.minute > b.minute;
  return (a.addedMinute ?? 0) > (b.addedMinute ?? 0);
}

/**
 * Place a typed event where it happened rather than at the end of the log.
 *
 * Live, the log is in the order things were filed, which is the order they happened. A
 * correction typed after the match would otherwise read as the latest event -- on the
 * console and on any view that orders by filing. It goes after everything at or before
 * its minute, so two events in one minute keep the order they were entered in, and never
 * after full time or the shootout.
 */
export function placeChronologically(events: RecordedEvent[], next: RecordedEvent): RecordedEvent[] {
  const at = events.findIndex((event) => closesTheMatch(event) || comesAfter(event, next));
  if (at === -1) return [...events, next];
  return [...events.slice(0, at), next, ...events.slice(at)];
}
