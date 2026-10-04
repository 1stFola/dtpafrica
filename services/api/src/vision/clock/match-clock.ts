/**
 * The match clock, anchored to the footage.
 *
 * Nothing in a file says which millisecond is kick-off. A person pauses on the
 * whistle and says so, once per half, and from then on any source millisecond
 * has a match minute and any match minute has a source millisecond. Everything
 * reported about a match -- substitutions, events, a scout's "the 73rd minute" --
 * is on this clock, and until it is anchored the footage and the record cannot
 * be joined.
 *
 * Minutes are the broadcast kind: the second half starts at 45, extra time at 90
 * and 105, and added time runs past the base (47:12 is two minutes into the
 * second half). A half may record where its whistle ended; after that and before
 * the next kick-off is *between halves*, and a track there is nobody's minute.
 */

export const HALVES = [
  { half: 1, baseMinute: 0, name: "1st half" },
  { half: 2, baseMinute: 45, name: "2nd half" },
  { half: 3, baseMinute: 90, name: "1st half of extra time" },
  { half: 4, baseMinute: 105, name: "2nd half of extra time" },
] as const;
export type Half = (typeof HALVES)[number]["half"];

export type ClockAnchor = {
  half: Half;
  /** Source millisecond of the kick-off of this half: its minute 0. */
  sourceMs: number;
  /** Source millisecond of the whistle ending this half, when a person marked it. */
  endMs: number | null;
};

export type ClockReading =
  | { status: "on"; half: Half; minute: number; second: number; elapsedMs: number; display: string }
  | { status: "unanchored" | "before_kickoff" | "between_halves" | "after_play"; display: string };

export function halfInfo(half: Half) {
  return HALVES.find((h) => h.half === half)!;
}

/** The anchors in play order, one per half, latest first replaced by the caller before this. */
export function sortAnchors(anchors: readonly ClockAnchor[]): ClockAnchor[] {
  return [...anchors].sort((a, b) => a.half - b.half);
}

/** Where a source millisecond falls on the match clock. */
export function clockAt(anchors: readonly ClockAnchor[], sourceMs: number): ClockReading {
  const ordered = sortAnchors(anchors);
  if (!ordered.length) return { status: "unanchored", display: "not anchored" };
  let current: ClockAnchor | null = null;
  for (const a of ordered) if (a.sourceMs <= sourceMs) current = a;
  if (!current) return { status: "before_kickoff", display: "before kick-off" };
  if (current.endMs !== null && sourceMs > current.endMs) {
    const later = ordered.some((a) => a.half > current!.half);
    return later ? { status: "between_halves", display: "between halves" } : { status: "after_play", display: "after the final whistle" };
  }
  const elapsedMs = sourceMs - current.sourceMs;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minute = halfInfo(current.half).baseMinute + Math.floor(totalSeconds / 60);
  const second = totalSeconds % 60;
  return { status: "on", half: current.half, minute, second, elapsedMs, display: `${minute}:${String(second).padStart(2, "0")}` };
}

/** The source millisecond of a match minute (broadcast kind) in a given half, or null when that half is not anchored. */
export function sourceMsAt(anchors: readonly ClockAnchor[], half: Half, minute: number, second = 0): number | null {
  const anchor = anchors.find((a) => a.half === half);
  if (!anchor) return null;
  const inHalf = minute - halfInfo(half).baseMinute;
  if (inHalf < 0) return null;
  return anchor.sourceMs + inHalf * 60_000 + second * 1000;
}

/** A source window as a continuous match-minute window, or null unless both ends are on the clock. */
export function windowOnClock(anchors: readonly ClockAnchor[], fromMs: number, toMs: number): { fromMinute: number; toMinute: number; display: string } | null {
  const a = clockAt(anchors, fromMs);
  const b = clockAt(anchors, toMs);
  if (a.status !== "on" || b.status !== "on") return null;
  return { fromMinute: a.minute + a.second / 60, toMinute: b.minute + b.second / 60, display: `${a.display}–${b.display}` };
}

/** The half a recorded minute belongs to when the record did not say: by the base minutes. */
export function halfOfMinute(minute: number): Half {
  let found: Half = 1;
  for (const h of HALVES) if (minute >= h.baseMinute) found = h.half;
  return found;
}

export type Substitution = {
  teamId: string;
  minute: number;
  offPlayerId: string | null;
  offNumber: number | null;
  onNumber: number | null;
  /**
   * The stretch of play the recorded minute stands for, on the timeline of
   * `recorder-minute.ts`. Without it the minute is read as a point on the same
   * scale as the window, which is only right when both are in the same units.
   */
  span?: { from: number; to: number };
};

/**
 * A substitution event as ScoreBoard stores it: the outgoing player by id (or
 * number), the incoming by number in the recorder's metadata, or, for rows
 * entered by hand, in the detail text `#19 off, #14 on`.
 */
export function parseSubstitution(event: { teamId: string | null; minute: number; playerId: string | null; detail: string | null; metadata: unknown }): Substitution | null {
  if (!event.teamId) return null;
  const meta = event.metadata && typeof event.metadata === "object" ? (event.metadata as Record<string, unknown>) : {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null);
  const off = event.detail?.match(/#(\d+)\s*off/i);
  const on = event.detail?.match(/#(\d+)\s*on/i);
  return {
    teamId: event.teamId,
    minute: event.minute,
    offPlayerId: event.playerId,
    offNumber: num(meta.playerNumber) ?? (off ? Number(off[1]) : null),
    onNumber: num(meta.secondaryPlayerNumber) ?? (on ? Number(on[1]) : null),
  };
}

export type OnPitch = "yes" | "no" | "partly";

/**
 * Whether a roster slot was on the pitch for a window: a starter from kick-off
 * until taken off, a substitute from when they came on, and either until taken
 * off again. `partly` is a window that crosses the change.
 *
 * The window and the substitutions must be on one scale. The footage is read on
 * a stopwatch and the record is in the recorder's minutes, which differ by one
 * and by more in a second half or a short one (docs/vision/55); the identity
 * service puts both on the timeline of `recorder-minute.ts` and gives each
 * substitution the `span` of play its minute stands for. A change is then
 * somewhere in its span: a window wholly before it has the old player, one
 * wholly after has the new, and one that touches it is `partly`.
 */
export function onPitchFor(slot: { isStarter: boolean; jerseyNumber: number | null; playerId: string | null }, subs: readonly Substitution[], window: { fromMinute: number; toMinute: number }): OnPitch {
  const spanOf = (s: Substitution) => s.span ?? { from: s.minute, to: s.minute };
  const cameOn = subs.filter((s) => s.onNumber !== null && s.onNumber === slot.jerseyNumber).map(spanOf);
  const wentOff = subs.filter((s) => (s.offPlayerId !== null && s.offPlayerId === slot.playerId) || (s.offPlayerId === null && s.offNumber !== null && s.offNumber === slot.jerseyNumber)).map(spanOf);
  const earliest = (spans: { from: number; to: number }[]) => spans.reduce<{ from: number; to: number } | null>((best, s) => (best === null || s.from < best.from ? s : best), null);
  const on = slot.isStarter ? { from: Number.NEGATIVE_INFINITY, to: Number.NEGATIVE_INFINITY } : earliest(cameOn);
  if (on === null) return "no";
  const off = earliest(wentOff.filter((s) => s.from >= on.from)) ?? { from: Number.POSITIVE_INFINITY, to: Number.POSITIVE_INFINITY };
  if (window.toMinute <= on.from || window.fromMinute >= off.to) return "no";
  if (window.fromMinute >= on.to && window.toMinute <= off.from) return "yes";
  return "partly";
}
