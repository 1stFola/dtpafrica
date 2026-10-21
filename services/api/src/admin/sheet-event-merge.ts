import type { RecordedEvent } from "./admin-match-stats.service";

/**
 * How a recorder's save combines with the event log already on the server.
 *
 * A save used to replace the whole log with the list the console sent. That is only safe
 * when the console has seen everything the server holds, and on a pitch with poor signal it
 * often has not: a recorder whose phone drops out moves to a second phone, records there,
 * and when the first phone finds signal again its older list overwrites the second phone's
 * events -- or the second phone's save overwrites the events the first phone filed offline.
 * Either way recorded events vanish, and nobody sees it happen.
 *
 * So the log is merged by event id. What the save carries wins, in the order it carries it.
 * An event the server holds that the save does not carry is kept, unless the save names it as
 * removed: deleting an event is something a recorder does on purpose, so it has to be said,
 * never inferred from an absence.
 *
 * Kick-off, full time and the shootout marker happen once. When the save carries its own,
 * one the server holds under another id is a second device's copy of the same moment, not a
 * second event, and is dropped.
 *
 * Pure, so the rule is tested without a database.
 */

const ONCE_PER_MATCH = new Set(["kick_off", "full_time", "penalty_shootout"]);
const CLOSES_THE_MATCH = new Set(["full_time", "penalty_shootout", "shootout_goal", "shootout_miss"]);

export type MergedEvents = {
  events: RecordedEvent[];
  /** Events the server held that the save did not carry or remove, kept rather than lost. */
  kept: RecordedEvent[];
};

function comesAfter(a: RecordedEvent, b: RecordedEvent): boolean {
  if (a.half !== b.half) return a.half > b.half;
  if (a.minute !== b.minute) return a.minute > b.minute;
  return (a.addedMinute ?? 0) > (b.addedMinute ?? 0);
}

/** Where a kept event belongs: after everything at or before its minute, and before full time. */
function placeKept(events: RecordedEvent[], kept: RecordedEvent): RecordedEvent[] {
  const at = CLOSES_THE_MATCH.has(kept.type)
    ? -1
    : events.findIndex((event) => CLOSES_THE_MATCH.has(event.type) || comesAfter(event, kept));
  if (at === -1) return [...events, kept];
  return [...events.slice(0, at), kept, ...events.slice(at)];
}

export function mergeRecordedEvents(
  stored: RecordedEvent[],
  incoming: RecordedEvent[],
  removedIds: readonly string[] = []
): MergedEvents {
  const removed = new Set(removedIds);
  const carried = new Set(incoming.map((event) => event.id));
  const carriedOnce = new Set(
    incoming.filter((event) => ONCE_PER_MATCH.has(event.type)).map((event) => event.type)
  );
  const kept = stored.filter(
    (event) =>
      !carried.has(event.id) &&
      !removed.has(event.id) &&
      !(ONCE_PER_MATCH.has(event.type) && carriedOnce.has(event.type))
  );
  return { events: kept.reduce(placeKept, incoming), kept };
}
