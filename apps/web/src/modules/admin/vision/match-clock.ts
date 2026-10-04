/**
 * The match clock, read in the browser from the anchors the API holds, so the
 * playhead can show the match minute as it moves. A mirror of the API's
 * `clockAt`, kept small on purpose: the API is the authority, and this only has
 * to agree with it for display.
 */

import { MATCH_HALVES } from "@dtp/vision-contracts";

export type ClockAnchor = { half: number; sourceMs: number; endMs: number | null };

/* From the contract: the table the API reads the clock with. This was a second copy of the numbers. */
const BASE_MINUTE: Record<number, number> = Object.fromEntries(MATCH_HALVES.map((h) => [h.half, h.baseMinute]));
export const HALF_NAMES: Record<number, string> = { 1: "1st half", 2: "2nd half", 3: "ET 1st half", 4: "ET 2nd half" };

export type ClockReading =
  | { status: "on"; half: number; minute: number; second: number; display: string }
  | { status: "unanchored" | "before_kickoff" | "between_halves" | "after_play"; display: string };

export function clockAt(anchors: readonly ClockAnchor[], sourceMs: number): ClockReading {
  const ordered = [...anchors].sort((a, b) => a.half - b.half);
  if (!ordered.length) return { status: "unanchored", display: "not anchored" };
  let current: ClockAnchor | null = null;
  for (const a of ordered) if (a.sourceMs <= sourceMs) current = a;
  if (!current) return { status: "before_kickoff", display: "before kick-off" };
  if (current.endMs !== null && sourceMs > current.endMs) {
    const later = ordered.some((a) => a.half > current!.half);
    return later ? { status: "between_halves", display: "between halves" } : { status: "after_play", display: "after the final whistle" };
  }
  const totalSeconds = Math.floor((sourceMs - current.sourceMs) / 1000);
  const minute = (BASE_MINUTE[current.half] ?? 0) + Math.floor(totalSeconds / 60);
  const second = totalSeconds % 60;
  return { status: "on", half: current.half, minute, second, display: `${minute}:${String(second).padStart(2, "0")}` };
}

/** `47:12 · 2nd half`, or the reason there is no reading. */
export function describeClock(anchors: readonly ClockAnchor[], sourceMs: number): string {
  const r = clockAt(anchors, sourceMs);
  return r.status === "on" ? `${r.display} · ${HALF_NAMES[r.half] ?? `half ${r.half}`}` : r.display;
}

/** The next half a reviewer would anchor: the first without an anchor, up to extra time. */
export function nextHalfToAnchor(anchors: readonly ClockAnchor[]): number {
  for (const h of [1, 2, 3, 4]) if (!anchors.some((a) => a.half === h)) return h;
  return 4;
}
