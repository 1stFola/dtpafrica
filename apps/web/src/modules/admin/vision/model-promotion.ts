/**
 * What the registry screen may offer for a model version, kept out of the
 * component so it can be tested without a browser.
 *
 * It mirrors the promotions service: a version is promotable from `benchmarked`
 * (to staging) and from `staging` (to production); one request waits at a time;
 * a different person decides it; a production version can be rolled back. The
 * screen used to wait for a stage called `promotion_requested`, which does not
 * exist -- a request is a row beside the version, not a stage of it -- so
 * Approve and Reject were never shown (docs/vision/50 C7).
 */

import type { VisionModelVersionRow } from "../../../api/vision";

/** The stage a request from this stage asks for, or null when the stage is not promotable. */
export function nextStage(stage: string): "staging" | "production" | null {
  if (stage === "benchmarked") return "staging";
  if (stage === "staging") return "production";
  return null;
}

export type PromotionActions = {
  /** Offer "Request promotion", and to which stage. */
  request: "staging" | "production" | null;
  /** A request is waiting, and this person may decide it. */
  decide: boolean;
  /** A request is waiting and it is this person's own: a second person decides. */
  yours: boolean;
  /** A request is waiting; the line to show beside the buttons. */
  waiting: string | null;
  rollback: boolean;
};

export function promotionActions(version: Pick<VisionModelVersionRow, "stage" | "pendingPromotion">, me: string | undefined, can: { train: boolean; promote: boolean }): PromotionActions {
  const pending = version.pendingPromotion ?? null;
  const yours = Boolean(pending && me && pending.requestedBy === me);
  return {
    request: can.train && !pending ? nextStage(version.stage) : null,
    decide: Boolean(pending) && can.promote && !yours,
    yours,
    waiting: pending ? `promotion to ${pending.toStage} requested${pending.requestedByEmail ? ` by ${pending.requestedByEmail}` : ""}${yours ? "; yours, so a second person decides" : ""}` : null,
    rollback: can.promote && version.stage === "production",
  };
}
