import type { RejectionReason } from "../../../api/vision";

/** Why a reviewer sent work back, in the words the reviewer picked them by. */
export const REJECTION_LABELS: Record<RejectionReason, string> = {
  wrong_box: "Box is wrong",
  wrong_identity: "Wrong player",
  camera_cut: "Camera cut mid-window",
  ball_invisible: "Ball not visible",
  event_ambiguous: "Event genuinely ambiguous",
  roster_error: "Roster is wrong",
  rights_issue: "Rights problem",
};

export function rejectionLabel(reason: string | null | undefined): string {
  if (!reason) return "no reason given";
  return REJECTION_LABELS[reason as RejectionReason] ?? reason;
}

/**
 * A short, stable name for a labelling task: the first eight characters of its id.
 * Frames from one clip a few seconds apart look alike in a list; the reference is
 * the same on the queue, the reviewed list and the task screen.
 */
export function taskRef(taskId: string): string {
  return `#${taskId.slice(0, 8)}`;
}
