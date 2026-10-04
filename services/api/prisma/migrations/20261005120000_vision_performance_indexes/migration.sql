-- QA fix 10 (docs/vision/60): the indexes the review queue, the overview, the benchmark
-- lookups and five foreign keys were missing, and a unique constraint that was wrong.
-- Indexes only: no row changes. Every statement is safe to run twice.

-- A job's idempotency key is the worker's proof that this job's completion landed. It is
-- compared on the job's own row and nowhere else, but it was unique across every job, so
-- two jobs sending the same key made the second completion a 500.
DROP INDEX IF EXISTS "vision_jobs_idempotency_key_key";

-- The review queue and the overview: current, undecided, oldest first.
CREATE INDEX IF NOT EXISTS "vision_event_candidates_review_state_superseded_by_created__idx" ON "vision_event_candidates"("review_state", "superseded_by", "created_at");
CREATE INDEX IF NOT EXISTS "vision_identity_assignments_review_state_superseded_by_crea_idx" ON "vision_identity_assignments"("review_state", "superseded_by", "created_at");

-- A track's current identity windows in order. It leads with track_id, so it replaces the
-- single-column index and still serves the foreign key.
CREATE INDEX IF NOT EXISTS "vision_identity_assignments_track_id_superseded_by_valid_fr_idx" ON "vision_identity_assignments"("track_id", "superseded_by", "valid_from_ms");
DROP INDEX IF EXISTS "vision_identity_assignments_track_id_idx";

-- "Is this model version being benchmarked", and the model's side of the foreign key.
CREATE INDEX IF NOT EXISTS "vision_jobs_model_version_id_type_state_idx" ON "vision_jobs"("model_version_id", "type", "state");

-- Foreign keys with no index on the referencing side. vision_dataset_members is ON DELETE
-- RESTRICT, so every asset delete scanned it.
CREATE INDEX IF NOT EXISTS "vision_video_assets_source_video_record_id_idx" ON "vision_video_assets"("source_video_record_id");
CREATE INDEX IF NOT EXISTS "vision_dataset_members_video_asset_id_idx" ON "vision_dataset_members"("video_asset_id");
CREATE INDEX IF NOT EXISTS "vision_active_learning_items_video_asset_id_idx" ON "vision_active_learning_items"("video_asset_id");
CREATE INDEX IF NOT EXISTS "vision_upload_sessions_video_asset_id_idx" ON "vision_upload_sessions"("video_asset_id");
CREATE INDEX IF NOT EXISTS "vision_upload_sessions_grant_id_idx" ON "vision_upload_sessions"("grant_id");
