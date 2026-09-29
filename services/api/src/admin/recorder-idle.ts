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
