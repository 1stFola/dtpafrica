CREATE TABLE "vision_possession_runs" (
 "id" TEXT NOT NULL, "video_asset_id" TEXT NOT NULL, "inference_job_id" TEXT NOT NULL,
 "attempt_number" INTEGER NOT NULL, "index_key" TEXT NOT NULL, "index_checksum" TEXT NOT NULL,
 "source_checksum" TEXT NOT NULL, "window_start_ms" INTEGER NOT NULL, "window_end_ms" INTEGER NOT NULL,
 "track_job_id" TEXT NOT NULL, "calculation_version" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
 "created_by" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "vision_possession_runs_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "vision_possession_run_window" CHECK ("window_start_ms" >= 0 AND "window_end_ms" > "window_start_ms" AND "attempt_number" > 0)
);
CREATE TABLE "vision_possession_segments" (
 "id" TEXT NOT NULL, "run_id" TEXT NOT NULL, "ordinal" INTEGER NOT NULL,
 "start_ms" INTEGER NOT NULL, "end_ms" INTEGER NOT NULL, "frames" INTEGER NOT NULL,
 "source_state" TEXT NOT NULL, "reason" TEXT, "camera_segment_id" TEXT,
 "trajectory_id" INTEGER, "local_track_id" INTEGER, "actor_track_id" TEXT, "evidence_confidence" DOUBLE PRECISION,
 CONSTRAINT "vision_possession_segments_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "vision_possession_segment_window" CHECK ("start_ms" >= 0 AND "end_ms" > "start_ms" AND "frames" > 0 AND "ordinal" >= 0),
 CONSTRAINT "vision_possession_segment_state" CHECK (
  ("source_state" = 'candidate' AND "reason" IS NULL AND "local_track_id" IS NOT NULL AND "local_track_id" >= 0 AND "actor_track_id" IS NOT NULL AND "camera_segment_id" IS NOT NULL AND "trajectory_id" IS NOT NULL AND "trajectory_id" > 0 AND "evidence_confidence" IS NOT NULL AND "evidence_confidence" BETWEEN 0 AND 1)
  OR ("source_state" = 'unknown' AND "reason" IS NOT NULL AND "local_track_id" IS NULL AND "actor_track_id" IS NULL AND "evidence_confidence" IS NULL))
);
CREATE TABLE "vision_possession_decisions" (
 "id" TEXT NOT NULL, "segment_id" TEXT NOT NULL, "decision" TEXT NOT NULL, "reason" TEXT,
 "reviewed_by" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "vision_possession_decisions_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "vision_possession_decision_valid" CHECK ("decision" IN ('accepted','rejected') AND ("decision" <> 'rejected' OR ("reason" IS NOT NULL AND LENGTH(TRIM("reason")) > 0)))
);
CREATE UNIQUE INDEX "vision_possession_runs_inference_job_id_attempt_number_key" ON "vision_possession_runs"("inference_job_id", "attempt_number");
CREATE INDEX "vision_possession_runs_video_asset_id_created_at_idx" ON "vision_possession_runs"("video_asset_id", "created_at");
CREATE UNIQUE INDEX "vision_possession_segments_run_id_ordinal_key" ON "vision_possession_segments"("run_id", "ordinal");
CREATE INDEX "vision_possession_segments_run_id_start_ms_idx" ON "vision_possession_segments"("run_id", "start_ms");
CREATE UNIQUE INDEX "vision_possession_decisions_segment_id_key" ON "vision_possession_decisions"("segment_id");
ALTER TABLE "vision_possession_runs" ADD CONSTRAINT "vision_possession_runs_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vision_possession_segments" ADD CONSTRAINT "vision_possession_segments_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "vision_possession_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vision_possession_decisions" ADD CONSTRAINT "vision_possession_decisions_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "vision_possession_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
