export const REVIEW_QUEUE_ORDERS = ["oldest", "confidence"] as const;
export type ReviewQueueOrder = (typeof REVIEW_QUEUE_ORDERS)[number];

export function reviewQueueOrder(value: unknown): ReviewQueueOrder {
  return value === "confidence" ? "confidence" : "oldest";
}

/** Confidence is the stored claim score, not measured accuracy. Age breaks ties. */
export function compareReviewClaims(
  a: { confidence: number; createdAt: Date | string; kind: string; id: string },
  b: { confidence: number; createdAt: Date | string; kind: string; id: string },
  order: ReviewQueueOrder,
): number {
  return (order === "confidence" ? a.confidence - b.confidence : 0)
    || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
}
