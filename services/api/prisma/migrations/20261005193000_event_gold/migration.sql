CREATE TABLE "vision_event_gold_sets" (
 "id" TEXT NOT NULL, "label" TEXT NOT NULL, "video_asset_id" TEXT NOT NULL,
 "source_checksum" TEXT NOT NULL, "window_start_ms" INTEGER NOT NULL, "window_end_ms" INTEGER NOT NULL,
 "tolerance_ms" INTEGER NOT NULL, "taxonomy_version" TEXT NOT NULL,
 "reviewer_a_id" TEXT NOT NULL, "reviewer_b_id" TEXT NOT NULL, "created_by" TEXT NOT NULL,
 "current_proposal_id" TEXT, "revision" INTEGER NOT NULL DEFAULT 0,
 "frozen_at" TIMESTAMP(3), "frozen_by" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "vision_event_gold_sets_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "vision_event_gold_reviewers_distinct" CHECK ("reviewer_a_id" <> "reviewer_b_id"),
 CONSTRAINT "vision_event_gold_window_valid" CHECK ("window_start_ms" >= 0 AND "window_end_ms" > "window_start_ms" AND "tolerance_ms" BETWEEN 0 AND 10000)
);
CREATE TABLE "vision_event_gold_submissions" (
 "id" TEXT NOT NULL, "gold_set_id" TEXT NOT NULL, "reviewer_id" TEXT NOT NULL,
 "payload_key" TEXT NOT NULL, "payload_checksum" TEXT NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "vision_event_gold_submissions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "vision_event_gold_proposals" (
 "id" TEXT NOT NULL, "gold_set_id" TEXT NOT NULL, "proposed_by" TEXT NOT NULL,
 "reason" TEXT NOT NULL, "payload_key" TEXT NOT NULL, "payload_checksum" TEXT NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "vision_event_gold_proposals_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "vision_event_gold_runs" (
 "id" TEXT NOT NULL, "gold_set_id" TEXT NOT NULL, "requested_by" TEXT NOT NULL,
 "snapshot_key" TEXT NOT NULL, "snapshot_checksum" TEXT NOT NULL,
 "report_key" TEXT NOT NULL, "report_checksum" TEXT NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "vision_event_gold_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vision_event_gold_sets_label_key" ON "vision_event_gold_sets"("label");
CREATE INDEX "vision_event_gold_sets_video_asset_id_idx" ON "vision_event_gold_sets"("video_asset_id");
CREATE UNIQUE INDEX "vision_event_gold_submissions_gold_set_id_reviewer_id_key" ON "vision_event_gold_submissions"("gold_set_id", "reviewer_id");
CREATE INDEX "vision_event_gold_proposals_gold_set_id_created_at_idx" ON "vision_event_gold_proposals"("gold_set_id", "created_at");
CREATE INDEX "vision_event_gold_runs_gold_set_id_created_at_idx" ON "vision_event_gold_runs"("gold_set_id", "created_at");
ALTER TABLE "vision_event_gold_sets" ADD CONSTRAINT "vision_event_gold_sets_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vision_event_gold_submissions" ADD CONSTRAINT "vision_event_gold_submissions_gold_set_id_fkey" FOREIGN KEY ("gold_set_id") REFERENCES "vision_event_gold_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vision_event_gold_proposals" ADD CONSTRAINT "vision_event_gold_proposals_gold_set_id_fkey" FOREIGN KEY ("gold_set_id") REFERENCES "vision_event_gold_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vision_event_gold_runs" ADD CONSTRAINT "vision_event_gold_runs_gold_set_id_fkey" FOREIGN KEY ("gold_set_id") REFERENCES "vision_event_gold_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
