CREATE TABLE "vision_event_import_runs" (
 "id" TEXT NOT NULL PRIMARY KEY, "video_asset_id" TEXT NOT NULL,
 "inference_job_id" TEXT NOT NULL, "attempt_number" INTEGER NOT NULL,
 "artifact_key" TEXT NOT NULL, "artifact_checksum" TEXT NOT NULL,
 "source_checksum" TEXT NOT NULL, "event_count" INTEGER NOT NULL,
 "snapshot" JSONB NOT NULL, "created_by" TEXT NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "event_import_bounds" CHECK ("attempt_number" > 0 AND "event_count" BETWEEN 0 AND 200),
 CONSTRAINT "vision_event_import_runs_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "vision_event_import_runs_inference_job_id_attempt_number_key" ON "vision_event_import_runs"("inference_job_id", "attempt_number");
CREATE INDEX "vision_event_import_runs_video_asset_id_created_at_idx" ON "vision_event_import_runs"("video_asset_id", "created_at");
ALTER TABLE "vision_event_candidates" ADD COLUMN "import_run_id" TEXT, ADD COLUMN "import_prediction_id" TEXT;
ALTER TABLE "vision_event_candidates" ADD CONSTRAINT "vision_event_candidates_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "vision_event_import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vision_event_candidates" ADD CONSTRAINT "event_import_prediction_has_run" CHECK ("import_prediction_id" IS NULL OR "import_run_id" IS NOT NULL);
CREATE UNIQUE INDEX "vision_event_candidates_import_run_id_import_prediction_id_key" ON "vision_event_candidates"("import_run_id", "import_prediction_id");
