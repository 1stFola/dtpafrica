import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClockState } from "../../../api/adminMatchStats";

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
 */
export function useMatchClock(
  clock: ClockState | null,
  onClockChange: (next: ClockState) => void
) {
  const state = clock ?? DEFAULT_CLOCK;
  const { halfLength, half, phase } = state;

  /* A bare counter purely to re-render each second; elapsed always comes from
     the anchor below, never from this tick. It IS a dependency of that memo,
     though — without it the memo would hold its first value and the clock
     would sit frozen at 00:00. */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (phase !== "running" && phase !== "added_running") return;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [phase]);

  const anchor = half === 1 ? state.firstHalfStartedAt : state.secondHalfStartedAt;
  const addedAllowance = (half === 1 ? state.addedFirst : state.addedSecond) ?? 0;

  const elapsed = useMemo(() => {
    if (!anchor) return 0;
    const started = new Date(anchor).getTime();
    if (!Number.isFinite(started)) return 0;
    const raw = Math.floor((Date.now() - started) / 1000);
    const ceiling =
      phase === "awaiting_added"
        ? halfLength * 60
        : phase === "awaiting_second_half" ||
            phase === "awaiting_full_time" ||
            phase === "penalty_shootout" ||
            phase === "finished"
          ? (halfLength + addedAllowance) * 60
          : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(raw, ceiling));
  }, [anchor, halfLength, phase, addedAllowance, tick]);

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
    const played = Math.floor(elapsed / 60);
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
        firstHalfStartedAt: new Date().toISOString(),
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
    () => patch({ half: 2, phase: "running", secondHalfStartedAt: new Date().toISOString() }),
    [patch]
  );

  const playAdditionalMinute = useCallback(() => {
    const key = half === 1 ? "addedFirst" : "addedSecond";
    const nextAllowance = addedAllowance + 1;
    const elapsedAtRestart = (halfLength + addedAllowance) * 60;
    const anchorAt = new Date(Date.now() - elapsedAtRestart * 1000).toISOString();
    patch({
      [key]: nextAllowance,
      phase: "added_running",
      ...(half === 1 ? { firstHalfStartedAt: anchorAt } : { secondHalfStartedAt: anchorAt }),
    } as Partial<ClockState>);
  }, [addedAllowance, half, halfLength, patch]);

  const endGame = useCallback(() => patch({ phase: "finished" }), [patch]);

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
    kickOff,
    confirmAddedTime,
    startSecondHalf,
    playAdditionalMinute,
    endGame,
    startPenaltyShootout,
  };
}
