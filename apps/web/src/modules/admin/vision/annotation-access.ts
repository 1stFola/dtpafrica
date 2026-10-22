import type { VisionAnnotationTask } from "../../../api/vision";

/**
 * Who may open the Annotation page and a task's workstation: whoever labels, and whoever
 * reviews what was labelled. A reviewer-only account needs both screens to do its one job,
 * because the review list lives on the Annotation page and the verdict buttons on the
 * workstation. What each person may *do* there is still checked per action, here and by
 * the API: claiming and submitting need `vision.annotate`, a verdict `vision.review`.
 */
export const ANNOTATION_SCREEN_PERMISSIONS = ["vision.annotate", "vision.review"];

type ReviewedTask = Pick<VisionAnnotationTask, "state" | "versions">;

/**
 * The verdict that sent a task back, while it is back.
 *
 * The labeller fixing it needs the reviewer's words, not just the button they pressed.
 * Once it is resubmitted the latest attempt has no review yet, so this is null again.
 */
export function sentBackReview(task: ReviewedTask | null) {
  const review = task?.versions?.[0]?.reviews[0];
  return task?.state === "rejected" && review?.decision === "rejected" ? review : null;
}
