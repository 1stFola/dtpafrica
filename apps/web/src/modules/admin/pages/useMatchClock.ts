import { useCallback, useEffect, useMemo, useState } from "react";
import {
  breakMsInHalf,
  matchBreakSeconds,
  openMatchBreak,
  type MatchBreak,
  type MatchBreakReason,
} from "@dtp/engines/match-breaks";
import type { ClockState } from "../../../api/adminMatchStats";
import { serverNow, syncServerClock } from "../../../lib/server-clock";

/** Clock ticks once a second; anything finer is wasted work pitch-side. */
const TICK_MS = 1000;

/** Half lengths offered on real fixtures. */
export const HALF_LENGTH_CHOICES = [30, 35, 40, 45];

/**
 * Training fixtures get short halves only: the point is to walk the whole flow
 * quickly, and offering a 45-minute practice half would just strand a trainee.
 */
export const TRAINING_HALF_LENGTH_CHOICES = [5, 10];

export const DEFAULT_CLOCK: ClockState = {
  halfLength: 45,
  half: 1,
  phase: "pre_kickoff",
  addedFirst: null,
  addedSecond: null,
  firstHalfStartedAt: null,
  secondHalfStartedAt: null,
};

export function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "40+2'" while in added time, otherwise "12'". */
export function displayMinute(minute: number, added: number | null): string {
  return added && added > 0 ? `${minute}+${added}'` : `${minute}'`;
}

/**
 * The match clock, derived from stored wall-clock anchors rather than a counter.
 *
 * Keeping it derived is what lets the clock survive switching tabs, reloading
 * the page, the phone locking, and background timer throttling — none of which
 * can lose time that was never being counted in the first place.
 *
 * Anchors are stamped and read on the server's clock (lib/server-clock), not this
 * device's: the public match page counts from the same anchors on other devices, and a
 * recorder's phone running a minute off would otherwise put every viewer a minute out.
 */
export function useMatchClock(
  clock: ClockState | null,
  onClockChange: (next: ClockState) => void
) {
  const state = clock ?? DEFAULT_CLOCK;
  const { halfLength, half, phase } = state;

  useEffect(() => {
    void syncServerClock();
  }, []);

  /* A bare counter purely to re-render each second; elapsed always comes from
     the anchor below, never from this tick. It IS a dependency of that memo,
     though — without it the memo would hold its first value and the clock
     would sit frozen at 00:00. */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (
      phase !== "running" &&
      phase !== "added_running" &&
      phase !== "awaiting_full_time" &&
      phase !== "on_break"
    ) {
      return;
    }
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [phase]);

  const anchor = half === 1 ? state.firstHalfStartedAt : state.secondHalfStartedAt;
  const addedAllowance = (half === 1 ? state.addedFirst : state.addedSecond) ?? 0;
  const breaks = state.breaks;
  const currentBreak = openMatchBreak(breaks);

  const elapsed = useMemo(() => {
    if (!anchor) return 0;
    const started = new Date(anchor).getTime();
    if (!Number.isFinite(started)) return 0;
    /* Less the time stopped in this half. An open break counts up to now, so the two
       cancel out and the reading holds still until play resumes. */
    const now = serverNow();
    const raw = Math.floor((now - started - breakMsInHalf(breaks, half, now)) / 1000);
    const ceiling =
      phase === "awaiting_added"
        ? halfLength * 60
        : phase === "awaiting_second_half" ||
            phase === "penalty_shootout" ||
            phase === "finished" ||
            phase === "correction"
          ? (halfLength + addedAllowance) * 60
          : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(raw, ceiling));
  }, [anchor, halfLength, phase, addedAllowance, breaks, half, tick]);

  const patch = useCallback(
    (next: Partial<ClockState>) => onClockChange({ ...state, ...next }),
    [onClockChange, state]
  );

  /* Auto-stop at the configured half length, then ask for added time. */
  useEffect(() => {
    if (phase !== "running") return;
    if (elapsed >= halfLength * 60) patch({ phase: "awaiting_added" });
  }, [phase, elapsed, halfLength, patch]);

  /* Added time runs out -> the second-half prompt takes over and stays put. */
  useEffect(() => {
    if (phase !== "added_running") return;
    if (elapsed >= (halfLength + addedAllowance) * 60) {
      patch({ phase: half === 1 ? "awaiting_second_half" : "awaiting_full_time" });
    }
  }, [phase, elapsed, halfLength, addedAllowance, half, patch]);

  /** The minute a tap would log right now. */
  const liveMinute = useMemo(() => {
    const played = Math.floor(elapsed / 60) + 1;
    if (half === 1) return Math.min(played, halfLength);
    return halfLength + Math.min(played, halfLength);
  }, [elapsed, half, halfLength]);

  /**
   * Stopwatch reading. Runs continuously across the interval: a 30-minute-half
   * game shows 30:00 at half-time and keeps climbing to 60:00, rather than
   * dropping back to 00:00 when the second half starts.
   */
  const displayElapsed = useMemo(
    () => (half === 1 ? elapsed : halfLength * 60 + elapsed),
    [elapsed, half, halfLength]
  );

  /** Added-time offset, kept separate so the minute stays football-correct. */
  const liveAdded = useMemo(() => {
    const played = Math.floor(elapsed / 60);
    return played > halfLength ? played - halfLength : null;
  }, [elapsed, halfLength]);

  const kickOff = useCallback(
    (chosenHalfLength: number) =>
      patch({
        halfLength: chosenHalfLength,
        half: 1,
        phase: "running",
        firstHalfStartedAt: new Date(serverNow()).toISOString(),
      }),
    [patch]
  );

  const confirmAddedTime = useCallback(
    (minutes: number) => {
      const value = Math.max(0, Math.floor(minutes || 0));
      const key = half === 1 ? "addedFirst" : "addedSecond";
      patch({
        [key]: value,
        phase:
          value === 0
            ? half === 1
              ? "awaiting_second_half"
              : "awaiting_full_time"
            : "added_running",
      } as Partial<ClockState>);
    },
    [half, patch]
  );

  const startSecondHalf = useCallback(
    () => patch({ half: 2, phase: "running", secondHalfStartedAt: new Date(serverNow()).toISOString() }),
    [patch]
  );

  const playAdditionalMinute = useCallback(() => {
    const key = half === 1 ? "addedFirst" : "addedSecond";
    const nextAllowance = addedAllowance + 1;
    patch({
      [key]: nextAllowance,
      phase: "added_running",
    } as Partial<ClockState>);
  }, [addedAllowance, half, patch]);

  const endGame = useCallback(() => patch({ phase: "finished" }), [patch]);

  /** Stop the clock for a water break, a medical emergency or the like. */
  const startBreak = useCallback(
    (reason: MatchBreakReason) => {
      if (phase !== "running" && phase !== "added_running") return;
      const started = new Date(serverNow()).toISOString();
      const next: MatchBreak = {
        id: `break-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        reason,
        note: null,
        half,
        minute: liveMinute,
        addedMinute: liveAdded,
        startedAt: started,
        endedAt: null,
      };
      patch({ phase: "on_break", breaks: [...(breaks ?? []), next] });
    },
    [phase, half, liveMinute, liveAdded, breaks, patch]
  );

  /* Back to what the clock was doing: added time is running once this half's is set. */
  const playingPhase = (half === 1 ? state.addedFirst : state.addedSecond) != null
    ? "added_running"
    : "running";

  const resumeFromBreak = useCallback(() => {
    if (phase !== "on_break") return;
    const ended = new Date(serverNow()).toISOString();
    patch({
      phase: playingPhase,
      breaks: (breaks ?? []).map((b) => (b.endedAt ? b : { ...b, endedAt: ended })),
    });
  }, [phase, playingPhase, breaks, patch]);

  const updateBreak = useCallback(
    (change: { reason?: MatchBreakReason; note?: string | null }) =>
      patch({ breaks: (breaks ?? []).map((b) => (b.endedAt ? b : { ...b, ...change })) }),
    [breaks, patch]
  );

  /** A break tapped by mistake: gone, and the clock reads as if it never stopped. */
  const discardBreak = useCallback(() => {
    if (phase !== "on_break") return;
    patch({ phase: playingPhase, breaks: (breaks ?? []).filter((b) => b.endedAt) });
  }, [phase, playingPhase, breaks, patch]);

  const startPenaltyShootout = useCallback(
    () => patch({ phase: "penalty_shootout" }),
    [patch]
  );

  return {
    state,
    phase,
    half,
    halfLength,
    elapsed,
    displayElapsed,
    liveMinute,
    liveAdded,
    started: phase !== "pre_kickoff",
    onBreak: phase === "on_break",
    /** A break can start only while the match clock is actually running. */
    canBreak: phase === "running" || phase === "added_running",
    breaks: breaks ?? [],
    currentBreak,
    /** The break's own timer, in seconds. */
    breakSeconds: currentBreak ? matchBreakSeconds(currentBreak, serverNow()) : 0,
    startBreak,
    resumeFromBreak,
    updateBreak,
    discardBreak,
    /** Reopened after full time: the clock stays stopped and every minute is typed. */
    correcting: phase === "correction",
    kickOff,
    confirmAddedTime,
    startSecondHalf,
    playAdditionalMinute,
    endGame,
    startPenaltyShootout,
  };
}
