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
import { positionInHalf } from "../clock/recorder-minute";

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

export type RecorderEvent = { id: string; type: string; half: 1 | 2; minute: number; addedMinute: number | null; teamId: string | null; playerId: string | null };

export type MatchOutcome =
  | { kind: "matched"; event: RecorderEvent; minutesApart: number; sameMinute: boolean }
  | { kind: "ambiguous"; events: RecorderEvent[] }
  | { kind: "none"; nearest: RecorderEvent | null };

/**
 * The recorder event a candidate is the same event as: same ScoreBoard type,
 * in the same half, within the minute tolerance, and not contradicting the
 * candidate's team or player where both sides know them. Both sides are on the
 * recorder's convention (`clock/recorder-minute.ts`), so the distance counts
 * added time on: 45+2 is two past 45 and one past 45+1, and it is never near
 * the second half's 47'. Nearest wins; two equally near is ambiguous, and
 * ambiguity is refused upstream rather than resolved here.
 */
export function matchRecorderEvent(
  candidate: { scoreboardType: string; half: 1 | 2; minute: number; addedMinute: number | null; sbTeamId: string | null; actorPlayerId: string | null },
  events: readonly RecorderEvent[]
): MatchOutcome {
  const sameType = events.filter((e) => e.type === candidate.scoreboardType);
  const compatible = sameType.filter(
    (e) =>
      (candidate.sbTeamId === null || e.teamId === null || e.teamId === candidate.sbTeamId) &&
      (candidate.actorPlayerId === null || e.playerId === null || e.playerId === candidate.actorPlayerId)
  );
  const at = positionInHalf(candidate);
  const sameHalf = compatible.filter((e) => e.half === candidate.half).map((event) => ({ event, minutesApart: Math.abs(positionInHalf(event) - at) }));
  const within = sameHalf.filter((m) => m.minutesApart <= PROMOTION_MINUTE_TOLERANCE).sort((a, b) => a.minutesApart - b.minutesApart);
  if (!within.length) {
    // The nearest in this half; with none there, the other half's nearest edge, so the refusal can still name something.
    const inHalf = sameHalf.reduce<(typeof sameHalf)[number] | null>((best, m) => (best === null || m.minutesApart < best.minutesApart ? m : best), null);
    if (inHalf) return { kind: "none", nearest: inHalf.event };
    const other = compatible.reduce<RecorderEvent | null>((best, e) => (best === null || Math.abs(e.minute - candidate.minute) < Math.abs(best.minute - candidate.minute) ? e : best), null);
    return { kind: "none", nearest: other };
  }
  const best = within[0]!;
  const ties = within.filter((m) => m.minutesApart === best.minutesApart);
  if (ties.length > 1) return { kind: "ambiguous", events: ties.map((m) => m.event) };
  const sameMinute = best.event.minute === candidate.minute && best.event.addedMinute === candidate.addedMinute;
  return { kind: "matched", event: best.event, minutesApart: best.minutesApart, sameMinute };
}

/**
 * The second to write beside the recorder's minute when a candidate enriches
 * its event: Vision's own, and only when its minute *is* the recorder's -- the
 * same minute and the same added minute -- and the recorder gave none. A second
 * under a different minute would be a lie about the recorder's row; a second
 * the recorder entered is the recorder's word. `null` means write nothing.
 */
export function secondToWrite(candidateSecond: number, sameMinute: boolean, existingSecond: number | null): number | null {
  if (!sameMinute) return null;
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
