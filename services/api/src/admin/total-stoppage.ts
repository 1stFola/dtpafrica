import { breakMsInHalf, type MatchBreak } from "@dtp/engines";

/**
 * A match that cannot go on: the pitch flooded, a serious incident, the referee abandoned it.
 *
 * A break pauses a match and expects it to resume. A total stoppage ends this attempt at the
 * fixture: the sheet goes back to before kick-off, the fixture reads as postponed, and it
 * waits on a ScoreBoard admin to give it a new date.
 *
 * **The reset never destroys the record.** What the recorder had filed is copied into the
 * sheet's history before the sheet is cleared, so an incident report can be written from it
 * and a stoppage declared by mistake is not the end of a match's data.
 *
 * **A phone that missed it must not bring the match back.** A second device, or one out of
 * signal when the stoppage was declared, still holds the old clock and goes on saving it. So
 * saves are refused while the fixture waits, and afterwards any clock that kicked off before
 * the stoppage is refused too: that is the abandoned attempt, not the rearranged game.
 *
 * Nothing here reads a clock or a database, so every rule is testable as it stands.
 */

export type StoppageClock = {
  halfLength: number;
  half: 1 | 2;
  phase: string;
  addedFirst: number | null;
  addedSecond: number | null;
  firstHalfStartedAt: string | null;
  secondHalfStartedAt: string | null;
  breaks?: readonly MatchBreak[];
};

/** What the sheet keeps about the incident. Never sent to the public. */
export type TotalStoppage = {
  at: string;
  note: string;
  half: 1 | 2;
  minute: number | null;
  byName: string | null;
  events: number;
  score: { home: number; away: number };
  rescheduledTo?: string;
  rescheduledAt?: string;
  rescheduledByName?: string | null;
};

export const TOTAL_STOPPAGE_NOTE_MAX = 500;

/** Why the console cannot save while the fixture waits for a new date. */
export const STOPPAGE_PENDING_MESSAGE =
  "This match was stopped and reset. A ScoreBoard admin needs to reschedule it before it can kick off again.";

/** Why a device still holding the abandoned attempt cannot save over the rearranged game. */
export const STOPPAGE_STALE_MESSAGE =
  "This match was stopped and reset after this device started recording it. Reload the page to continue.";

/** The phases a match can be stopped from: kicked off, and not yet over. */
const STOPPABLE_PHASES = new Set([
  "running",
  "added_running",
  "on_break",
  "awaiting_added",
  "awaiting_second_half",
  "awaiting_full_time",
  "penalty_shootout",
]);

export function stoppageRefusal(
  clock: StoppageClock | null,
  sheetStatus: string,
  alreadyPending: boolean
): string | null {
  if (alreadyPending) return "This match has already been stopped and is waiting to be rescheduled.";
  if (!clock?.firstHalfStartedAt || clock.phase === "pre_kickoff") {
    return "This match has not kicked off, so there is nothing to stop.";
  }
  if (sheetStatus !== "live" || !STOPPABLE_PHASES.has(clock.phase)) {
    return "This match has finished. Request a correction instead.";
  }
  return null;
}

/**
 * The minute play had reached, for the admin to read.
 *
 * Capped at the half's length plus its added time, because the wall clock keeps climbing
 * through half-time and the prompts at the end of a half.
 */
export function minuteOfStoppage(clock: StoppageClock, nowMs: number): number | null {
  const anchor = clock.half === 2 ? clock.secondHalfStartedAt : clock.firstHalfStartedAt;
  const started = anchor ? Date.parse(anchor) : NaN;
  if (!Number.isFinite(started)) return null;
  const halfLength = Math.max(1, clock.halfLength);
  const added = (clock.half === 2 ? clock.addedSecond : clock.addedFirst) ?? 0;
  const played = Math.floor((nowMs - started - breakMsInHalf(clock.breaks, clock.half, nowMs)) / 60_000) + 1;
  const inHalf = Math.min(Math.max(1, played), halfLength + added);
  return clock.half === 2 ? halfLength + inHalf : inHalf;
}

/** Whether a save is the abandoned attempt: a clock that kicked off before the stoppage. */
export function isStaleAfterStoppage(
  sentFirstHalfStartedAt: string | null | undefined,
  stoppedAt: string | null | undefined
): boolean {
  if (!sentFirstHalfStartedAt || !stoppedAt) return false;
  return Date.parse(sentFirstHalfStartedAt) <= Date.parse(stoppedAt);
}

/** The clock a stopped sheet goes back to. The half length stays, as the competition's own. */
export function clockAfterStoppage(clock: StoppageClock | null) {
  return {
    halfLength: clock?.halfLength ?? 45,
    half: 1 as const,
    phase: "pre_kickoff" as const,
    addedFirst: null,
    addedSecond: null,
    firstHalfStartedAt: null,
    secondHalfStartedAt: null,
  };
}

/** A new kick-off has to be ahead of now: a date already gone is no rearrangement. */
export function rescheduleRefusal(kickoff: Date, nowMs: number): string | null {
  return kickoff.getTime() <= nowMs ? "Choose a new kick-off time that is still to come." : null;
}
