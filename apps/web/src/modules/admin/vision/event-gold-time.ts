import { snapSourceTimeMs } from "./annotation-boxes";
/** Clamp the padded proxy before snapping: padding is never a source event frame. */
export function goldPlayheadSourceMs(proxyMs: number, media: { fps: number | null; sourceOffsetMs: number; sourceDurationMs: number | null }, windowEndMs: number): number {
  const end = Math.min(windowEndMs - 1, media.sourceDurationMs ?? Infinity);
  return snapSourceTimeMs(Math.min(Math.max(0, proxyMs), Math.max(0, end - media.sourceOffsetMs)), media.fps, media.sourceOffsetMs);
}
