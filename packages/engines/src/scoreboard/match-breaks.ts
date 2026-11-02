/**
 * Breaks in play: a water break, a medical emergency, anything that stops the game.
 *
 * The match clock is derived from wall-clock anchors, the moment each half started, so it
 * keeps counting through a reload or a locked phone. A stoppage has to take its time back
 * out of that reading.
 *
 * **The anchors are never moved.** Pushing a half's start forward on resume would be
 * simpler to read back, but it rewrites when the half kicked off, and it leaves no record
 * of the break. Each break is kept with its own start and end instead, and the clock is
 * anchor to now, less the breaks in that half. The same record is what logs how long the
 * break took, so there is one account of it rather than two that can disagree.
 *
 * **A break is not a recorder going missing.** The idle sweep exists to stop a recording
 * nobody is at, and a long stoppage looks exactly like that unless break time is taken out
 * of the quiet time: see `assessIdle`.
 *
 * **The note is the recorder's, not the public's.** It can say whose injury stopped the
 * game, so it stays on the sheet: `publicMatchBreaks` strips it from anything the public
 * reads, and the timeline line is built from the reason alone.
 *
 * Shared by the API and the console, so the public minute and the recorder's minute are
 * the same arithmetic.
 */

export const MATCH_BREAK_REASONS = [
  "water_break",
  "medical",
  "weather",
  "pitch_or_crowd",
  "other",
] as const;

export type MatchBreakReason = (typeof MATCH_BREAK_REASONS)[number];

export const MATCH_BREAK_REASON_LABELS: Record<MatchBreakReason, string> = {
  water_break: "Water break",
  medical: "Medical emergency",
  weather: "Weather",
  pitch_or_crowd: "Pitch or crowd incident",
  other: "Other stoppage",
};

export type MatchBreak = {
  id: string;
  reason: MatchBreakReason;
  /** The recorder's own words. Never published. */
  note: string | null;
  half: 1 | 2;
  /** The match minute the clock stopped on, in the same terms as a recorded event. */
  minute: number;
  addedMinute: number | null;
  startedAt: string;
  /** Null while the break is still going on. */
  endedAt: string | null;
};

export const MATCH_BREAK_NOTE_MAX = 200;

/** Far past any real match: a limit on what a client can make the sheet store. */
const MATCH_BREAKS_MAX = 50;

const REASON_SET = new Set<string>(MATCH_BREAK_REASONS);

function readInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * The breaks from whatever a client sent, dropping what cannot be read.
 *
 * Only one break can be open, and only while the clock says it is on one. An open break on
 * a clock in any other phase would hold that clock still for good, so it is dropped rather
 * than trusted: a break exists to stop the clock while somebody can see it has stopped.
 */
export function readMatchBreaks(input: unknown, onBreak: boolean): MatchBreak[] {
  if (!Array.isArray(input)) return [];
  const out: MatchBreak[] = [];
  for (const raw of input.slice(-MATCH_BREAKS_MAX)) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const startedAt = readInstant(b.startedAt);
    if (!startedAt || typeof b.id !== "string" || !b.id) continue;
    const endedAt = readInstant(b.endedAt);
    if (endedAt && Date.parse(endedAt) < Date.parse(startedAt)) continue;
    const note = typeof b.note === "string" ? b.note.trim().slice(0, MATCH_BREAK_NOTE_MAX).trim() : "";
    out.push({
      id: b.id.slice(0, 100),
      reason:
        typeof b.reason === "string" && REASON_SET.has(b.reason)
          ? (b.reason as MatchBreakReason)
          : "other",
      note: note || null,
      half: b.half === 2 ? 2 : 1,
      minute: typeof b.minute === "number" && Number.isFinite(b.minute) ? Math.max(0, Math.floor(b.minute)) : 0,
      addedMinute:
        typeof b.addedMinute === "number" && Number.isFinite(b.addedMinute) && b.addedMinute > 0
          ? Math.floor(b.addedMinute)
          : null,
      startedAt,
      endedAt,
    });
  }
  const lastOpen = onBreak ? out.map((b) => b.endedAt).lastIndexOf(null) : -1;
  return out.filter((b, index) => b.endedAt !== null || index === lastOpen);
}

/** The break under way, if there is one. */
export function openMatchBreak(breaks: readonly MatchBreak[] | undefined): MatchBreak | null {
  return breaks?.find((b) => b.endedAt === null) ?? null;
}

function endOf(b: MatchBreak, nowMs: number): number {
  return b.endedAt ? Date.parse(b.endedAt) : nowMs;
}

/**
 * Time stopped in one half, to take off that half's clock. An open break counts up to now,
 * which is what holds the clock still: both sides of the subtraction grow together.
 */
export function breakMsInHalf(
  breaks: readonly MatchBreak[] | undefined,
  half: 1 | 2,
  nowMs: number
): number {
  let total = 0;
  for (const b of breaks ?? []) {
    if (b.half === half) total += Math.max(0, endOf(b, nowMs) - Date.parse(b.startedAt));
  }
  return total;
}

/** How much of a stretch of time was spent on breaks, however they overlap its ends. */
export function breakMsWithin(
  breaks: readonly MatchBreak[] | undefined,
  fromMs: number,
  toMs: number
): number {
  let total = 0;
  for (const b of breaks ?? []) {
    const from = Math.max(fromMs, Date.parse(b.startedAt));
    const to = Math.min(toMs, endOf(b, toMs));
    if (to > from) total += to - from;
  }
  return total;
}

/** A break's own timer, in whole seconds. */
export function matchBreakSeconds(b: MatchBreak, nowMs: number): number {
  return Math.max(0, Math.floor((endOf(b, nowMs) - Date.parse(b.startedAt)) / 1000));
}

/** "3 min 12 s", "45 s", "4 min". */
export function formatBreakLength(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes === 0) return `${seconds} s`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** What the public may read of the breaks: everything but the recorder's note. */
export function publicMatchBreaks(breaks: readonly MatchBreak[]): MatchBreak[] {
  return breaks.map((b) => ({ ...b, note: null }));
}

/** The timeline already knows a water break, so that reason keeps the type and its icon. */
export function matchBreakEventType(b: MatchBreak): "water_break" | "match_break" {
  return b.reason === "water_break" ? "water_break" : "match_break";
}

/** The timeline's line for a break. Built from the reason alone, never the note. */
export function matchBreakComment(b: MatchBreak, nowMs: number): string {
  const minute =
    b.addedMinute && b.addedMinute > 0 ? `${b.minute}+${b.addedMinute}'` : `${b.minute}'`;
  const label = MATCH_BREAK_REASON_LABELS[b.reason];
  return b.endedAt
    ? `${minute} - ${label}. Play was stopped for ${formatBreakLength(matchBreakSeconds(b, nowMs))}.`
    : `${minute} - ${label}. Play is stopped.`;
}

const CLOSING_TYPES = new Set(["full_time", "penalty_shootout", "shootout_goal", "shootout_miss"]);

type PlacedEvent = { type: string; half: 1 | 2; minute: number; addedMinute: number | null };

function comesAfterBreak(event: PlacedEvent, b: MatchBreak): boolean {
  if (event.half !== b.half) return event.half > b.half;
  const eventAt = event.minute + (event.addedMinute ?? 0);
  const breakAt = b.minute + (b.addedMinute ?? 0);
  if (eventAt !== breakAt) return eventAt > breakAt;
  /* An event in the same minute reads as before the stoppage, except the match's ending. */
  return CLOSING_TYPES.has(event.type);
}

/**
 * Where each event and break sits in the timeline's order: the sequence numbers the public
 * page sorts a minute's rows by. Events keep the order they were recorded in, and a break
 * goes in ahead of the first event that came after it.
 */
export function sequenceWithBreaks(
  events: readonly PlacedEvent[],
  breaks: readonly MatchBreak[]
): { eventSequence: number[]; breakSequence: number[] } {
  const ordered = breaks
    .map((b, index) => ({ b, index }))
    .sort((x, y) => Date.parse(x.b.startedAt) - Date.parse(y.b.startedAt));
  const eventSequence: number[] = [];
  const breakSequence: number[] = new Array(breaks.length).fill(0);
  let next = 0;
  let waiting = 0;
  for (const event of events) {
    while (waiting < ordered.length && comesAfterBreak(event, ordered[waiting].b)) {
      breakSequence[ordered[waiting].index] = next++;
      waiting += 1;
    }
    eventSequence.push(next++);
  }
  for (; waiting < ordered.length; waiting += 1) {
    breakSequence[ordered[waiting].index] = next++;
  }
  return { eventSequence, breakSequence };
}
