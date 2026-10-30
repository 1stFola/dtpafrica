import type { ClockState } from "./api";

/*
 * What the console says about the Edge's clock (Phase 5.6, F11). The Edge asks its kernel
 * whether a time daemon is disciplining the clock, so the warning is shown when it is true,
 * not always. Only wall times depend on it: offsets between cameras are measured on the one
 * Edge clock and hold whatever its error.
 */

const ALIGNMENT = "Offsets between cameras are measured on this one clock and are unaffected.";

/** "0.8 s", "12 s", "3 min": the clock's possible error, never understated. */
export function errorLabel(ms: number): string {
  if (ms < 10_000) return `${Math.ceil(ms / 100) / 10} s`;
  if (ms < 120_000) return `${Math.ceil(ms / 1000)} s`;
  return `${Math.ceil(ms / 60_000)} min`;
}

/** The banner for a clock with no time source, or one that may have drifted. Null otherwise. */
export function clockBanner(clock: ClockState | undefined): string | null {
  if (clock?.ntpState === "unsynced") {
    return `The Edge clock has no time source: it is not synchronised, so its wall times can be off by any amount. Compare kick-off and incident times with the match console before relying on them. ${ALIGNMENT}`;
  }
  if (clock?.ntpState === "drifting") {
    const by = clock.sync?.maxErrorMs != null ? ` by up to ${errorLabel(clock.sync.maxErrorMs)}` : "";
    return `The Edge clock has not been synchronised lately and may be off${by}. Compare wall times with the match console. ${ALIGNMENT}`;
  }
  return null;
}

/** The quieter line: the state could not be read here. Null when it was. */
export function clockNote(clock: ClockState | undefined): string | null {
  if (clock?.ntpState === "unknown" && clock.sync?.settling) {
    return "The Edge clock's sync is being checked: compare with the match console before relying on wall times.";
  }
  if (!clock || clock.ntpState === "unknown") {
    return "The Edge clock's sync could not be checked on this machine: compare with the match console before relying on wall times.";
  }
  return null;
}
