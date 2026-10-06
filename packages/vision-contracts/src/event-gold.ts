import { NON_PLAY_SEGMENT_KINDS, VISION_EVENT_TYPES, type VisionEventType } from "./events";

export const EVENT_GOLD_SCHEMA_VERSION = "event-gold/v1";
export const MAX_GOLD_EVENTS = 200;
export type GoldEvent = { id: string; type: VisionEventType; startMs: number; endMs: number; actorMatchSquadPlayerId: string | null };
export type GoldNonPlayWindow = { startMs: number; endMs: number; kind: "replay" | "intro" | "halftime" };
export type EventGoldLabels = { events: GoldEvent[]; nonPlayWindows: GoldNonPlayWindow[] };

/** A complete, bounded source-time reference. Empty arrays explicitly mean nothing was found. */
export function validateEventGoldLabels(raw: unknown, window: { startMs: number; endMs: number }): { labels: EventGoldLabels | null; problems: string[] } {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { labels: null, problems: ["Labels must contain events and nonPlayWindows arrays."] };
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.events) || !Array.isArray(value.nonPlayWindows)) return { labels: null, problems: ["Both events and nonPlayWindows must be arrays, including when empty."] };
  if (value.events.length > MAX_GOLD_EVENTS || value.nonPlayWindows.length > MAX_GOLD_EVENTS) return { labels: null, problems: ["Split the window: at most 200 events or non-play windows per reference."] };
  const validWindow = (entry: Record<string, unknown>, instant: boolean) => Number.isSafeInteger(entry.startMs) && Number.isSafeInteger(entry.endMs)
    && Number(entry.startMs) >= window.startMs && Number(entry.startMs) < window.endMs
    && Number(entry.endMs) <= window.endMs && Number(entry.endMs) >= Number(entry.startMs)
    && (instant || Number(entry.endMs) > Number(entry.startMs));
  const events: GoldEvent[] = [];
  const nonPlayWindows: GoldNonPlayWindow[] = [];
  const ids = new Set<string>();
  for (const [index, rawEvent] of value.events.entries()) {
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) { problems.push(`Event ${index + 1} must be an object.`); continue; }
    const event = rawEvent as Record<string, unknown>;
    if (typeof event.id !== "string" || !event.id.trim() || event.id.length > 80 || ids.has(event.id)) problems.push(`Event ${index + 1} needs a unique, nonempty id of at most 80 characters.`);
    else ids.add(event.id);
    if (!(VISION_EVENT_TYPES as readonly unknown[]).includes(event.type)) problems.push(`Event ${index + 1} has an unknown event type.`);
    if (!validWindow(event, true)) problems.push(`Event ${index + 1} must use integer source milliseconds inside the reference window.`);
    if (event.actorMatchSquadPlayerId !== null && (typeof event.actorMatchSquadPlayerId !== "string" || !event.actorMatchSquadPlayerId.trim() || event.actorMatchSquadPlayerId.length > 200)) problems.push(`Event ${index + 1} must name a roster slot or explicitly use null for an unknown actor.`);
    events.push({ id: event.id as string, type: event.type as VisionEventType, startMs: event.startMs as number, endMs: event.endMs as number, actorMatchSquadPlayerId: event.actorMatchSquadPlayerId as string | null });
  }
  for (const [index, rawRange] of value.nonPlayWindows.entries()) {
    if (!rawRange || typeof rawRange !== "object" || Array.isArray(rawRange)) { problems.push(`Non-play window ${index + 1} must be an object.`); continue; }
    const range = rawRange as Record<string, unknown>;
    if (!validWindow(range, false) || !(NON_PLAY_SEGMENT_KINDS as readonly unknown[]).includes(range.kind)) problems.push(`Non-play window ${index + 1} needs a positive source-time window and replay, intro or halftime kind.`);
    nonPlayWindows.push({ startMs: range.startMs as number, endMs: range.endMs as number, kind: range.kind as GoldNonPlayWindow["kind"] });
  }
  const ranges = [...nonPlayWindows].sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < ranges.length; i++) if (ranges[i]!.startMs < ranges[i - 1]!.endMs) problems.push("Non-play windows must not overlap.");
  for (const event of events) if (nonPlayWindows.some((range) => event.startMs < range.endMs && Math.max(event.endMs, event.startMs + 1) > range.startMs)) problems.push(`Event ${event.id} overlaps non-play footage. Label live events only.`);
  return { labels: problems.length ? null : { events, nonPlayWindows }, problems };
}
