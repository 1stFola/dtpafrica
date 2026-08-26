import type {
  EventCaptureMap,
  Half,
  RecordedEvent,
  SidePair,
  SplitTally,
  TallyValue,
} from "../../../api/adminMatchStats";

/**
 * Applying the server's event-to-statistic map on the client.
 *
 * The map itself is not duplicated here — it arrives on the sheet as
 * `eventCapture`, so there is only ever one definition of which event feeds
 * which statistic. These helpers only apply it, which they do locally so the
 * counters move on the tap rather than a save round-trip later.
 */

/** True when tapping this event also files a statistic. Drives the "+" flourish. */
export function capturesStat(map: EventCaptureMap, type: string): boolean {
  return Boolean(map[type]?.length);
}

/** What an event will capture, worded for the button's tooltip. */
export function captureSummary(
  map: EventCaptureMap,
  type: string,
  statLabels: Record<string, string>
): string | null {
  const captures = map[type];
  if (!captures?.length) return null;
  const names = [...new Set(captures.map((c) => statLabels[c.key] ?? c.key))];
  return `Also counts toward ${names.join(" and ")}`;
}

const pair = (): SidePair => ({ home: 0, away: 0 });

/**
 * Recompute the event log's contribution from scratch.
 *
 * Never accumulated as events arrive: recomputing means a deleted event takes
 * its contribution with it, with no running counter to fall out of step.
 */
export function capturedFromEvents(
  map: EventCaptureMap,
  events: RecordedEvent[],
  splitKeys: ReadonlySet<string>
): Record<string, TallyValue> {
  const out: Record<string, TallyValue> = {};

  const ensure = (key: string): TallyValue => {
    if (!out[key]) out[key] = splitKeys.has(key) ? { "1st": pair(), "2nd": pair() } : pair();
    return out[key];
  };

  for (const event of events) {
    const captures = map[event.type];
    if (!captures) continue;

    for (const capture of captures) {
      const side =
        capture.side === "same" ? event.side : event.side === "home" ? "away" : "home";
      const target = ensure(capture.key);

      if (splitKeys.has(capture.key)) {
        const half: Half = event.half === 2 ? "2nd" : "1st";
        (target as SplitTally)[half][side] += 1;
      } else {
        (target as SidePair)[side] += 1;
      }
    }
  }

  return out;
}
