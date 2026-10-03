/**
 * How a recorder event reads on the match clock now that a row may carry a
 * second beside its minute (docs/vision/49). Every row the recorder entered has
 * none and reads as it always did, `47'`; a row Vision placed reads `47'12"`.
 * The second never changes the order of two events in different minutes, and
 * within a minute a row with none sorts as the minute's start.
 */

export type EventClock = { minute: number; secondInMinute?: number | null };

export function eventClockLabel(ev: EventClock): string {
  const second = ev.secondInMinute;
  if (second === null || second === undefined) return `${ev.minute}'`;
  return `${ev.minute}'${String(second).padStart(2, "0")}"`;
}

/** Negative when `a` is earlier; zero when the clock cannot tell them apart. */
export function compareEventClock(a: EventClock, b: EventClock): number {
  const minuteDiff = a.minute - b.minute;
  if (minuteDiff !== 0) return minuteDiff;
  return (a.secondInMinute ?? 0) - (b.secondInMinute ?? 0);
}
