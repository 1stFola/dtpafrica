/**
 * When a live recording has been left running with nobody at it.
 *
 * A recorder opens the console at kick-off and the clock runs on wall time, so it keeps
 * counting whether or not anybody is still there. If they close the laptop, walk away or
 * lose signal, the public ScoreBoard goes on showing a match as live — minutes ticking,
 * score frozen — and nothing in the product notices.
 *
 * **Twenty minutes of a running clock with no event filed is the signal.** That threshold
 * is a judgement, not a measurement: on the DYNAMIC FC v HIGHKLASS SA timeline events land
 * every one to three minutes, so twenty is far outside normal recording and well inside a
 * half. It is deliberately generous, because the cost of tripping early is stopping a
 * broadcast that was fine.
 *
 * **Only events count.** A tally bump or a clock action does not reset it. That was a
 * deliberate choice and it has a sharp edge worth stating: a recorder who taps shot counts
 * for twenty minutes without filing an event is treated as absent and locked out. The
 * alert says which it was, so a wrong lock reads as a wrong lock rather than a mystery.
 *
 * Nothing here reads a clock or a database. The caller supplies `now`, which is what makes
 * every boundary in this file testable without waiting twenty minutes.
 */

/** Twenty minutes, in milliseconds. */
export const IDLE_LIMIT_MS = 20 * 60 * 1000;

/** Clock phases during which a recorder is expected to be filing events. */
const RUNNING_PHASES = new Set(["running", "added_running"]);

export type IdleCandidate = {
  matchId: string;
  /** `live`, `submitted` or `approved` — only a live sheet can go idle. */
  sheetStatus: string;
  clockPhase: string;
  /** When an event was last filed, or null when none ever has been. */
  lastEventAt: Date | null;
  /** When the current half started, used when nothing has been filed at all. */
  halfStartedAt: Date | null;
  /** Already locked, so the sweep leaves it alone. */
  idleLockedAt: Date | null;
  /** A training sandbox is somebody practising and is never locked. */
  isTraining: boolean;
};

export type IdleVerdict =
  | { idle: false; reason: "not_running" | "not_live" | "already_locked" | "training" | "within_limit" }
  | { idle: true; since: Date; quietMs: number };

/**
 * Whether this sheet has been left running.
 *
 * Measured from the last event, or from kick-off when none has been filed — a match that
 * starts and records nothing is exactly the walked-away case, and measuring from "the last
 * event" alone would mean it never trips.
 */
export function assessIdle(candidate: IdleCandidate, now: Date): IdleVerdict {
  if (candidate.isTraining) return { idle: false, reason: "training" };
  if (candidate.idleLockedAt) return { idle: false, reason: "already_locked" };
  if (candidate.sheetStatus !== "live") return { idle: false, reason: "not_live" };
  if (!RUNNING_PHASES.has(candidate.clockPhase)) return { idle: false, reason: "not_running" };

  /* Half-time, awaiting added time and awaiting full time are all handled by the phase
     check above: the clock is not running, so a long gap there is somebody waiting rather
     than somebody absent. */
  const since = candidate.lastEventAt ?? candidate.halfStartedAt;
  if (!since) return { idle: false, reason: "not_running" };

  const quietMs = now.getTime() - since.getTime();
  if (quietMs < IDLE_LIMIT_MS) return { idle: false, reason: "within_limit" };
  return { idle: true, since, quietMs };
}

/** How long a lock has been quiet, in whole minutes, for an alert to read out. */
export function quietMinutes(quietMs: number): number {
  return Math.floor(quietMs / 60_000);
}

/**
 * Whether a sheet may be edited, and why not when it may not.
 *
 * The console already refuses edits at full time and once approved. An idle lock is a
 * third reason, and it reads differently on purpose: the other two are things the recorder
 * did, while this one happened to them and needs somebody else to undo.
 */
export function idleLockMessage(quietMs: number): string {
  return (
    `This recording was stopped after ${quietMinutes(quietMs)} minutes with no event filed, ` +
    `and the live broadcast was ended. A ScoreBoard admin can release it from the dashboard.`
  );
}

/** Five minutes, in milliseconds. */
export const AUTO_SUBMIT_DELAY_MS = 5 * 60 * 1000;

export type AutoSubmitCandidate = {
  matchId: string;
  sheetStatus: string;
  clockPhase: string;
  /** When the clock reached full time, or null if it has not. */
  fullTimeAt: Date | null;
  /** A recording the idle sweep stopped. Those wait for a person. */
  idleLockedAt: Date | null;
  /** A recorder has asked for the sheet back; submitting it under them would be rude. */
  correctionRequested: boolean;
  isTraining: boolean;
};

export type AutoSubmitVerdict =
  | { submit: false; reason: "not_full_time" | "not_live" | "locked" | "correction_pending" | "training" | "too_soon" }
  | { submit: true; waitedMs: number };

/**
 * Whether a finished match should be submitted without the recorder pressing the button.
 *
 * A recorder who blows full time and walks away leaves a complete sheet sitting in
 * `live` for ever: the figures are right, nobody can approve them, and the fixture shows
 * no result. Five minutes is long enough for somebody putting their phone away and short
 * enough that the result is not stuck overnight.
 *
 * **A stopped recording is never auto-submitted.** The idle sweep stopped it precisely
 * because nobody was there, so its figures are the ones nobody vouches for -- submitting
 * them would push an unwatched sheet into the approval queue looking exactly like a
 * recorder's own work. Those wait in the dashboard panel for a person.
 */
export function assessAutoSubmit(
  candidate: AutoSubmitCandidate,
  now: Date
): AutoSubmitVerdict {
  if (candidate.isTraining) return { submit: false, reason: "training" };
  if (candidate.idleLockedAt) return { submit: false, reason: "locked" };
  if (candidate.correctionRequested) return { submit: false, reason: "correction_pending" };
  if (candidate.sheetStatus !== "live") return { submit: false, reason: "not_live" };
  if (candidate.clockPhase !== "finished" || !candidate.fullTimeAt) {
    return { submit: false, reason: "not_full_time" };
  }

  const waitedMs = now.getTime() - candidate.fullTimeAt.getTime();
  if (waitedMs < AUTO_SUBMIT_DELAY_MS) return { submit: false, reason: "too_soon" };
  return { submit: true, waitedMs };
}

/**
 * Whether a sheet has reached the point where submitting it makes sense.
 *
 * Not before the second half. A sheet submitted at half-time is half a match: the
 * approver sees a plausible-looking record with forty-five minutes missing, and the
 * recorder has to ask for it back to finish the job they were in the middle of.
 *
 * The second half *starting* is the gate rather than full time, because a recorder
 * whose phone dies in the eighty-eighth minute should still be able to send up what
 * they have. Blocking until full time would lose that.
 */
export function canSubmitYet(clock: { half: 1 | 2; phase: string } | null): boolean {
  if (!clock) return false;
  /* A record reopened for corrections is a whole match, whichever half its clock was
     left in -- an approved sheet can be reopened before its clock reached the second. */
  return clock.half === 2 || clock.phase === "correction";
}

/** Why the button is off, said the way the recorder would ask it. */
export const SUBMIT_TOO_EARLY =
  "The sheet can be sent for approval once the second half is under way.";
