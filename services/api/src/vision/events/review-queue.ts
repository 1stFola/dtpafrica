/**
 * The review queue: what a second person should look at next.
 *
 * Every claim in Vision that needs a second person's word is a row that
 * starts `unreviewed` and was decided by someone: an identity assignment on a
 * window of a track, an event candidate on a window of the footage. The queue
 * is those rows, current and undecided, that are *not the reader's own* --
 * the self-acceptance rule applied before the round trip. Oldest-first remains
 * the API default; confidence order brings the lowest stored claim score first.
 * The workstation walks loaded claims on one asset with `,` and `.`.
 */

import { compareReviewClaims, type ReviewQueueKind, type ReviewQueueOrder } from "@dtp/vision-contracts";

export type QueueEventRow = {
  confidence: number;
  id: string;
  videoAssetId: string;
  type: string;
  startMs: number;
  endMs: number;
  actorTrackId: string | null;
  decidedBy: string;
  createdAt: Date;
};

export type QueueIdentityRow = {
  confidence: number;
  id: string;
  trackId: string;
  videoAssetId: string;
  localTrackId: number;
  matchSquadPlayerId: string | null;
  validFromMs: number;
  validToMs: number;
  decidedBy: string;
  createdAt: Date;
};

export type QueueItem =
  | ({ kind: ReviewQueueKind & "event"; sourceMs: number } & QueueEventRow)
  | ({ kind: ReviewQueueKind & "identity"; sourceMs: number } & QueueIdentityRow);

/**
 * The queue for one person: both kinds merged in the requested order, theirs left out,
 * cut to `limit`. `waiting` counts what is in the queue before the cut, so a
 * page can say how deep it is.
 */
export function buildQueue(me: string, events: readonly QueueEventRow[], identities: readonly QueueIdentityRow[], limit: number, order: ReviewQueueOrder = "oldest"): { items: QueueItem[]; waiting: { events: number; identities: number } } {
  const mine = (row: { decidedBy: string }) => row.decidedBy === me;
  const eventItems: QueueItem[] = events.filter((e) => !mine(e)).map((e) => ({ kind: "event", sourceMs: e.startMs, ...e }));
  const identityItems: QueueItem[] = identities.filter((a) => !mine(a)).map((a) => ({ kind: "identity", sourceMs: a.validFromMs, ...a }));
  const all = [...eventItems, ...identityItems].sort((a, b) => compareReviewClaims(a, b, order));
  return { items: all.slice(0, Math.max(0, limit)), waiting: { events: eventItems.length, identities: identityItems.length } };
}
