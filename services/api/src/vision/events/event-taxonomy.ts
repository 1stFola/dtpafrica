/**
 * The rules under event candidates that need no database: which types exist,
 * which have a recorder event to promote into, when a segment means an event is
 * not play, and which recorder event a candidate is the same event as.
 *
 * The recorder's pitch-side event is canonical (docs/vision/13 Q7). Promotion
 * enriches it where one matches and creates one only where the recorder logged
 * nothing; the matching here is deliberately narrow, and when it cannot choose
 * it says so rather than picking.
 */

import {
  NON_PLAY_SEGMENT_KINDS,
  PROMOTION_MINUTE_TOLERANCE,
  SCOREBOARD_TYPE_OF,
  VISION_EVENT_TYPES,
  type VisionEventType,
} from "@dtp/vision-contracts";

export function isEventType(type: string): type is VisionEventType {
  return (VISION_EVENT_TYPES as readonly string[]).includes(type);
}

/** The ScoreBoard type a candidate type promotes into, or null when the recorder has no such event. */
export function scoreboardTypeOf(type: VisionEventType): string | null {
  return SCOREBOARD_TYPE_OF[type] ?? null;
}

/** Whether an event inside a segment of this kind is play. No segment (null) is taken as play: nothing says otherwise. */
export function isPlay(segmentKind: string | null): boolean {
  return segmentKind === null || !(NON_PLAY_SEGMENT_KINDS as readonly string[]).includes(segmentKind);
}

export type RecorderEvent = { id: string; type: string; minute: number; teamId: string | null; playerId: string | null };

export type MatchOutcome =
  | { kind: "matched"; event: RecorderEvent; minutesApart: number }
  | { kind: "ambiguous"; events: RecorderEvent[] }
  | { kind: "none"; nearest: RecorderEvent | null };

/**
 * The recorder event a candidate is the same event as: same ScoreBoard type,
 * within the minute tolerance, and not contradicting the candidate's team or
 * player where both sides know them. Nearest in minutes wins; two equally near
 * is ambiguous, and ambiguity is refused upstream rather than resolved here.
 */
export function matchRecorderEvent(
  candidate: { scoreboardType: string; minute: number; sbTeamId: string | null; actorPlayerId: string | null },
  events: readonly RecorderEvent[]
): MatchOutcome {
  const sameType = events.filter((e) => e.type === candidate.scoreboardType);
  const compatible = sameType.filter(
    (e) =>
      (candidate.sbTeamId === null || e.teamId === null || e.teamId === candidate.sbTeamId) &&
      (candidate.actorPlayerId === null || e.playerId === null || e.playerId === candidate.actorPlayerId)
  );
  const within = compatible
    .map((event) => ({ event, minutesApart: Math.abs(event.minute - candidate.minute) }))
    .filter((m) => m.minutesApart <= PROMOTION_MINUTE_TOLERANCE)
    .sort((a, b) => a.minutesApart - b.minutesApart);
  if (!within.length) {
    const nearest = compatible.reduce<RecorderEvent | null>((best, e) => (best === null || Math.abs(e.minute - candidate.minute) < Math.abs(best.minute - candidate.minute) ? e : best), null);
    return { kind: "none", nearest };
  }
  const best = within[0]!;
  const ties = within.filter((m) => m.minutesApart === best.minutesApart);
  if (ties.length > 1) return { kind: "ambiguous", events: ties.map((m) => m.event) };
  return { kind: "matched", event: best.event, minutesApart: best.minutesApart };
}

/**
 * The second to write beside the recorder's minute when a candidate enriches
 * its event: Vision's own, and only when its minute *is* the recorder's and the
 * recorder gave none. A second under a different minute would be a lie about
 * the recorder's row; a second the recorder entered is the recorder's word.
 * `null` means write nothing.
 */
export function secondToWrite(candidateSecond: number, minutesApart: number, existingSecond: number | null): number | null {
  if (minutesApart !== 0) return null;
  if (existingSecond !== null) return null;
  return candidateSecond;
}

/** A window inside the asset, start no later than end. */
export function windowProblem(startMs: number, endMs: number, durationMs: number | null): string | null {
  if (startMs < 0) return "The window starts before the footage.";
  if (endMs < startMs) return "The window ends before it starts.";
  if (durationMs !== null && endMs > durationMs) return `The window runs past the footage, which is ${durationMs}ms long.`;
  return null;
}
