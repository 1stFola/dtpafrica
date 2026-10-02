/**
 * The arithmetic under the identity review screen, kept out of the component so it
 * can be tested without a browser.
 *
 * Three things live here. Where a track is on the frame being shown (its
 * positions come from the track artifact in object storage, read through the
 * control plane because a browser cannot read the bucket, in proxy pixels, and
 * drawn as percentages so they follow the picture). What window an action
 * covers, with the API's own rules mirrored so a reviewer is told before the round
 * trip. And how a candidate, an assignment and a track are described, in words
 * the reviewer reads a hundred times a match.
 */

import type {
  VisionIdentityAssignment,
  VisionReviewMatch,
  VisionReviewTrack,
  VisionRosterCandidate,
} from "../../../api/vision";
import { frameIndexAt } from "./annotation-time";

export type TrackPosition = {
  frameIndex: number;
  proxyTimeMs: number;
  sourceTimeMs: number;
  box: { x: number; y: number; width: number; height: number };
  confidence?: number;
};

export type Rect = { x: number; y: number; width: number; height: number };
export type Window = { from: number; to: number };

/** Positions in frame order, whatever order the artifact wrote them. */
export function sortPositions(positions: TrackPosition[]): TrackPosition[] {
  return [...positions].sort((a, b) => a.frameIndex - b.frameIndex);
}

/**
 * The track's position on the frame at `proxyMs`, or null when it was not seen
 * there. Exact frame match when the proxy has a rate; within 50ms when it does
 * not. A track that was hidden for a gap has no position in the gap, and nothing
 * is interpolated here either: the box shown is a box the tracker saw.
 */
export function positionAt(
  positions: TrackPosition[],
  proxyMs: number,
  fps: number | null
): TrackPosition | null {
  const frame = frameIndexAt(proxyMs, fps);
  if (frame !== null) {
    return positions.find((p) => p.frameIndex === frame) ?? null;
  }
  let best: TrackPosition | null = null;
  for (const p of positions) {
    const d = Math.abs(p.proxyTimeMs - proxyMs);
    if (d <= 50 && (best === null || d < Math.abs(best.proxyTimeMs - proxyMs))) best = p;
  }
  return best;
}

/** A box in proxy pixels as a fraction of the picture, clamped to it. */
export function toPercentBox(box: Rect, width: number | null, height: number | null): Rect | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x = clamp(box.x / width);
  const y = clamp(box.y / height);
  return {
    x,
    y,
    width: Math.min(clamp(box.width / width), 1 - x),
    height: Math.min(clamp(box.height / height), 1 - y),
  };
}

/** The API's window rules, so the reviewer hears them before the round trip. */
export function windowProblem(track: { startMs: number; endMs: number }, window: Window): string | null {
  if (!Number.isInteger(window.from) || !Number.isInteger(window.to)) return "The window must be whole milliseconds.";
  if (window.from < track.startMs || window.to > track.endMs) {
    return `The window must lie inside the track (${formatSeconds(track.startMs)}–${formatSeconds(track.endMs)}).`;
  }
  if (window.to <= window.from) return "The window is empty.";
  return null;
}

/**
 * The two windows a split at `atSourceMs` makes, or null when the playhead is at
 * or beyond either end -- a split there would leave an empty half.
 */
export function splitAt(track: { startMs: number; endMs: number }, atSourceMs: number): { before: Window; after: Window } | null {
  const at = Math.round(atSourceMs);
  if (at <= track.startMs || at >= track.endMs) return null;
  return { before: { from: track.startMs, to: at }, after: { from: at, to: track.endMs } };
}

/** Candidates whose number is exactly, or whose name contains, the query. */
export function filterCandidates(candidates: VisionRosterCandidate[], query: string): VisionRosterCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    return candidates.filter((c) => c.jerseyNumber === n);
  }
  return candidates.filter((c) => c.name.toLowerCase().includes(q));
}

export function candidateLabel(c: VisionRosterCandidate): string {
  const number = c.jerseyNumber === null ? "—" : `#${c.jerseyNumber}`;
  const tail = [c.position, c.isStarter ? "starter" : null].filter(Boolean).join(", ");
  return `${number} ${c.name}${tail ? ` (${tail})` : ""}`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** What an assignment says, for the list under a track. */
export function describeAssignment(
  a: VisionIdentityAssignment,
  nameOfSlot: (matchSquadPlayerId: string) => string | undefined
): string {
  const who = a.matchSquadPlayerId ? (nameOfSlot(a.matchSquadPlayerId) ?? a.matchSquadPlayerId.slice(0, 8)) : "unknown";
  const how = a.method === "propagated" ? " · merged" : "";
  return `${who} ${formatSeconds(a.validFromMs)}–${formatSeconds(a.validToMs)}${how} · ${a.reviewState}`;
}

/** Only this may ever reach anyone outside the review room. */
export function isPublic(a: VisionIdentityAssignment): boolean {
  return a.reviewState === "accepted" && a.playerId !== null && a.supersededBy === null;
}

/** Whether the signed-in person may accept this one: a second person, never the first. */
export function mayAccept(a: VisionIdentityAssignment, userId: string | undefined): boolean {
  return Boolean(userId) && a.decidedBy !== userId && a.reviewState === "unreviewed" && a.supersededBy === null;
}

/** `A · red → Home FC`, `B · blue → ?` (side not yet decided), or `no side`. */
export function sideLabel(track: VisionReviewTrack, match: VisionReviewMatch | null): string {
  if (!track.team || !track.team.team) return track.team?.method === "not_clustered" ? "not clustered" : "no side";
  const kit = track.team.kitDescription ? ` · ${track.team.kitDescription}` : "";
  const teamName = track.sbTeamId ? (teamNameOf(track.sbTeamId, match) ?? track.sbTeamId.slice(0, 8)) : "?";
  const corrected = track.team.reviewState === "corrected" ? " (overruled)" : "";
  return `${track.team.team}${kit} → ${teamName}${corrected}`;
}

export function teamNameOf(sbTeamId: string, match: VisionReviewMatch | null): string | undefined {
  if (!match) return undefined;
  if (match.homeTeam.id === sbTeamId) return match.homeTeam.name;
  if (match.awayTeam.id === sbTeamId) return match.awayTeam.name;
  return undefined;
}

/** One line per track for the list: who it is now, or that nobody has said. */
export function identitySummary(
  track: VisionReviewTrack,
  nameOfSlot: (matchSquadPlayerId: string) => string | undefined
): string {
  const current = track.identities.filter((a) => a.supersededBy === null);
  if (!current.length) return "nobody has said";
  return current
    .map((a) => (a.matchSquadPlayerId ? (nameOfSlot(a.matchSquadPlayerId) ?? "…") : "unknown") + (a.reviewState === "accepted" ? " ✓" : ""))
    .join(" / ");
}

/**
 * The identify job whose sides a decision applies to: the one the tracks' latest
 * kit assignments came from. Null when no track has been sided yet.
 */
export function identifyJobOf(tracks: VisionReviewTrack[]): string | null {
  const counts = new Map<string, number>();
  for (const t of tracks) if (t.team) counts.set(t.team.inferenceJobId, (counts.get(t.team.inferenceJobId) ?? 0) + 1);
  let best: string | null = null;
  for (const [id, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = id;
  return best;
}
