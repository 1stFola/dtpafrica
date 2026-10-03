/**
 * The arithmetic under the event review screen, kept out of the component so it
 * can be tested without a browser.
 *
 * A candidate lives in source time; the timeline is the proxy clip, so each
 * candidate becomes a fraction of the clip's width. The playhead chooses which
 * candidate is "here", the keyboard walks to the next and the previous, and a
 * proposal at the playhead takes its actor from the selected track and the
 * roster slot that track was said to be at that moment. The API's window rules
 * are mirrored so a reviewer is told before the round trip.
 */

import type { VisionEventCandidate, VisionReviewTrack } from "../../../api/vision";

export const EVENT_TYPES = ["pass", "carry", "shot", "cross", "header", "tackle", "interception", "recovery", "clearance", "throw_in", "corner", "free_kick", "save", "goal_candidate"] as const;

export type TimelineMark = { candidate: VisionEventCandidate; left: number; width: number };

/** Where each current candidate sits on the clip, as fractions of its width; a candidate outside the clip is dropped. */
export function timelineMarks(candidates: readonly VisionEventCandidate[], offsetMs: number, clipMs: number): TimelineMark[] {
  if (clipMs <= 0) return [];
  return candidates
    .filter((c) => !c.supersededBy)
    .map((c) => {
      const from = Math.max(0, c.startMs - offsetMs);
      const to = Math.min(clipMs, Math.max(c.endMs, c.startMs) - offsetMs);
      return { candidate: c, left: from / clipMs, width: Math.max((to - from) / clipMs, 0.004) };
    })
    .filter((m) => m.left >= 0 && m.left <= 1);
}

/** The candidate whose window holds the playhead, nearest start first; within half a second of an instant counts. */
export function candidateAt(candidates: readonly VisionEventCandidate[], sourceMs: number, toleranceMs = 500): VisionEventCandidate | null {
  const current = candidates.filter((c) => !c.supersededBy);
  const inside = current.filter((c) => sourceMs >= c.startMs - toleranceMs && sourceMs <= Math.max(c.endMs, c.startMs) + toleranceMs);
  if (!inside.length) return null;
  return inside.sort((a, b) => Math.abs(a.startMs - sourceMs) - Math.abs(b.startMs - sourceMs))[0] ?? null;
}

/** The next candidate after the playhead, or the previous before it, by start; null at either end. */
export function stepCandidate(candidates: readonly VisionEventCandidate[], sourceMs: number, direction: 1 | -1): VisionEventCandidate | null {
  const current = candidates.filter((c) => !c.supersededBy).sort((a, b) => a.startMs - b.startMs);
  if (direction === 1) return current.find((c) => c.startMs > sourceMs + 1) ?? null;
  return [...current].reverse().find((c) => c.startMs < sourceMs - 1) ?? null;
}

export type Uncertainty = { kind: "event" | "identity"; id: string; trackId: string | null; sourceMs: number };

/**
 * What a second person has to decide on this footage, by source time: every
 * current, unreviewed candidate and identity window that is not theirs. The
 * same list the review queue holds for one asset; `,` and `.` walk it.
 */
export function uncertainties(candidates: readonly VisionEventCandidate[], tracks: readonly VisionReviewTrack[], me: string | undefined): Uncertainty[] {
  const events: Uncertainty[] = candidates
    .filter((c) => !c.supersededBy && c.reviewState === "unreviewed" && c.decidedBy !== me)
    .map((c) => ({ kind: "event", id: c.id, trackId: c.actorTrackId, sourceMs: c.startMs }));
  const identities: Uncertainty[] = tracks.flatMap((t) =>
    t.identities.filter((a) => a.supersededBy === null && a.reviewState === "unreviewed" && a.decidedBy !== me).map((a) => ({ kind: "identity" as const, id: a.id, trackId: t.id, sourceMs: a.validFromMs }))
  );
  return [...events, ...identities].sort((a, b) => a.sourceMs - b.sourceMs || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

/** The next uncertainty after the playhead, or the previous before it; null at either end. */
export function stepUncertainty(items: readonly Uncertainty[], sourceMs: number, direction: 1 | -1): Uncertainty | null {
  if (direction === 1) return items.find((i) => i.sourceMs > sourceMs + 1) ?? null;
  return [...items].reverse().find((i) => i.sourceMs < sourceMs - 1) ?? null;
}

/** The roster slot a track was said to be at a moment: its current identity covering that millisecond, if it names one. */
export function slotAt(track: VisionReviewTrack | null, sourceMs: number): string | null {
  if (!track) return null;
  const covering = track.identities.filter((a) => a.supersededBy === null && a.validFromMs <= sourceMs && a.validToMs >= sourceMs && a.matchSquadPlayerId);
  return covering.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.matchSquadPlayerId ?? null;
}

/** What a proposal at the playhead would carry. */
export function proposalAt(track: VisionReviewTrack | null, sourceMs: number): { actorTrackId: string | null; actorMatchSquadPlayerId: string | null; sbTeamId: string | null } {
  return { actorTrackId: track?.id ?? null, actorMatchSquadPlayerId: slotAt(track, sourceMs), sbTeamId: track?.sbTeamId ?? null };
}

/** The API's window rule, mirrored: start before end, inside the footage. */
export function windowProblem(startMs: number, endMs: number, durationMs: number | null): string | null {
  if (startMs < 0) return "The window starts before the footage.";
  if (endMs < startMs) return "The window ends before it starts.";
  if (durationMs !== null && endMs > durationMs) return "The window runs past the footage.";
  return null;
}

/** `shot · 12:30 · #4 · unreviewed`, the line the timeline and the list show. */
export function describeCandidate(c: VisionEventCandidate, trackLabel: (trackId: string | null) => string | null): string {
  const parts = [c.type.replace(/_/g, " ")];
  if (c.matchClock) parts.push(c.matchClock);
  const who = trackLabel(c.actorTrackId);
  if (who) parts.push(who);
  parts.push(c.promotedEventId ? `in the match record (${c.promotionKind})` : c.reviewState);
  if (!c.inPlay) parts.push("not play");
  return parts.join(" · ");
}

/** The actions a candidate allows this person, mirrored from the service so the buttons match the refusals. */
export function allowedActions(c: VisionEventCandidate, me: string | undefined, can: { review: boolean; publish: boolean }) {
  const live = !c.supersededBy && !c.promotedEventId;
  return {
    correct: live && can.review,
    accept: live && can.review && c.reviewState === "unreviewed" && c.decidedBy !== me,
    reject: live && can.review && c.reviewState === "unreviewed" && c.decidedBy !== me,
    promote: live && can.publish && c.reviewState === "accepted" && c.promotable && c.inPlay,
    yours: live && c.reviewState === "unreviewed" && c.decidedBy === me,
  };
}
