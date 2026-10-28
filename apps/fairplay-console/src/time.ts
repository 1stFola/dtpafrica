/*
 * Time on the console. Every position is held as an Edge-clock instant (milliseconds since
 * the epoch, UTC). A source's recording runs on its ingest clock: ingest = edge + offset,
 * where a positive offset means the source lags (docs/fairplay/architecture.md §5). The
 * match clock is never inferred from these; it comes from the period marks.
 *
 * Browser seeks land on keyframes, so a displayed position is "about" — the UI writes it
 * with a leading ≈ and never offers frame accuracy.
 */

export const toMs = (iso: string): number => Date.parse(iso);

export const toIso = (ms: number): string => new Date(ms).toISOString();

export const edgeToIngest = (edgeMs: number, offsetMs: number): number => edgeMs + offsetMs;

export const ingestToEdge = (ingestMs: number, offsetMs: number): number => ingestMs - offsetMs;

/** "14:03:11.2" in UTC: tenths, because the footage does not support more. */
export function clockLabel(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${Math.floor(d.getUTCMilliseconds() / 100)}`;
}

export function signedMs(ms: number): string {
  return `${ms >= 0 ? "+" : "−"}${Math.abs(Math.round(ms))} ms`;
}

/** Match clock from a period start, as the console shows it: 67:42 for 67 min 42 s elapsed. */
export function matchClock(atMs: number, periodStartMs: number, periodOffsetMin: number): string {
  const elapsed = Math.max(0, Math.floor((atMs - periodStartMs) / 1000)) + periodOffsetMin * 60;
  return `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
}

export const PERIOD_OFFSET_MIN: Record<string, number> = { "1": 0, "2": 45, "3": 90, "4": 105, penalties: 120 };

/** The replay window to load so that `edgeMs` is `leadMs` into it, on a source with this offset. */
export function windowFor(edgeMs: number, offsetMs: number, leadMs: number, durationMs: number) {
  const startIngest = edgeToIngest(edgeMs, offsetMs) - leadMs;
  return { startIngestMs: startIngest, durationMs };
}

/** The Edge-clock instant shown at `currentTimeS` into a window starting at `startIngestMs`. */
export function positionEdgeMs(startIngestMs: number, currentTimeS: number, offsetMs: number): number {
  return ingestToEdge(startIngestMs + currentTimeS * 1000, offsetMs);
}

/**
 * A time typed by the operator: a full ISO instant, or a UTC time of day ("23:55", "23:55:00.4")
 * meaning its most recent occurrence at or before `referenceMs` — so "23:55" typed just after
 * midnight UTC is last night's, not tonight's. Null if it is not one of those.
 */
export function parseTypedTime(text: string, referenceMs: number): number | null {
  const value = text.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const ms = Date.parse(value.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
    return Number.isNaN(ms) ? null : ms;
  }
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!m) return null;
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || min > 59 || s > 59) return null;
  const day = new Date(referenceMs);
  const ms = Number((m[4] ?? "0").padEnd(3, "0"));
  const sameDay = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, min, s, ms);
  return sameDay > referenceMs ? sameDay - 24 * 3600 * 1000 : sameDay;
}

export function mediaPath(source: string, startIngestMs: number, durationMs: number): string {
  return `/edge/v1/media/${encodeURIComponent(source)}?start=${encodeURIComponent(toIso(startIngestMs))}&durationMs=${Math.round(durationMs)}`;
}
