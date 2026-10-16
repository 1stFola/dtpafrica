import { snapSourceTimeMs } from "./annotation-boxes";
/** Clamp the padded proxy before snapping: padding is never a source event frame. */
export function goldPlayheadSourceMs(proxyMs: number, media: { fps: number | null; sourceOffsetMs: number; sourceDurationMs: number | null }, windowEndMs: number): number {
  const end = Math.min(windowEndMs - 1, media.sourceDurationMs ?? Infinity);
  return snapSourceTimeMs(Math.min(Math.max(0, proxyMs), Math.max(0, end - media.sourceOffsetMs)), media.fps, media.sourceOffsetMs);
}

/**
 * A clip time as a person types it: `1:37`, `1:37.5`, `01:37.040`, or plain seconds
 * (`97.04`). Null when it is none of those. Minutes need a colon: `1.37` is 1.37 seconds,
 * which is why the editor shows every time back as m:ss beside the box (docs/vision/97).
 */
export function parseClipTime(text: string): number | null {
  const t = text.trim();
  const clock = /^(\d{1,3}):([0-5]?\d(?:\.\d{1,3})?)$/.exec(t);
  if (clock) return Math.round((Number(clock[1]) * 60 + Number(clock[2])) * 1000);
  if (/^\d+(?:\.\d{1,3})?$/.test(t)) return Math.round(Number(t) * 1000);
  return null;
}

/** 97040 -> "01:37.040". */
export function formatClipTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = (total % 60000) / 1000;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}
