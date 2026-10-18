-- hard_frames (docs/vision/99): a queued window and the task made from it remember the
-- job whose artifact holds their pre-labels, and the detector that drew them.
ALTER TABLE "vision_active_learning_items" ADD COLUMN "source_job_id" TEXT;
ALTER TABLE "vision_active_learning_items" ADD COLUMN "pre_label_model_version_id" TEXT;
ALTER TABLE "vision_annotation_tasks" ADD COLUMN "pre_label_job_id" TEXT;
