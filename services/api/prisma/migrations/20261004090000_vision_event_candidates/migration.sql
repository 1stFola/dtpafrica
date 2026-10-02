-- Event candidates: Vision's proposal that something happened, with evidence links
-- and a review state; promoted into the recorder's match record only by a second
-- person's acceptance and a publisher's hand (docs/vision/44).

-- CreateTable
CREATE TABLE "vision_event_candidates" (
    "id" TEXT NOT NULL,
    "video_asset_id" TEXT NOT NULL,
    "sb_match_id" TEXT,
    "type" TEXT NOT NULL,
    "taxonomy_version" TEXT NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "actor_track_id" TEXT,
    "actor_player_id" TEXT,
    "actor_match_squad_player_id" TEXT,
    "sb_team_id" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "model_version_id" TEXT,
    "camera_segment_id" TEXT,
    "in_play" BOOLEAN NOT NULL DEFAULT true,
    "review_state" TEXT NOT NULL DEFAULT 'unreviewed',
    "decided_by" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "review_note" TEXT,
    "note" TEXT,
    "promoted_event_id" TEXT,
    "promotion_kind" TEXT,
    "promoted_by" TEXT,
    "promoted_at" TIMESTAMP(3),
    "superseded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_event_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_evidence_links" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_evidence_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vision_event_candidates_promoted_event_id_key" ON "vision_event_candidates"("promoted_event_id");

-- CreateIndex
CREATE INDEX "vision_event_candidates_video_asset_id_start_ms_idx" ON "vision_event_candidates"("video_asset_id", "start_ms");

-- CreateIndex
CREATE INDEX "vision_event_candidates_sb_match_id_idx" ON "vision_event_candidates"("sb_match_id");

-- CreateIndex
CREATE INDEX "vision_event_candidates_actor_track_id_idx" ON "vision_event_candidates"("actor_track_id");

-- CreateIndex
CREATE INDEX "vision_evidence_links_candidate_id_idx" ON "vision_evidence_links"("candidate_id");

-- CreateIndex
CREATE INDEX "vision_evidence_links_kind_target_id_idx" ON "vision_evidence_links"("kind", "target_id");

-- AddForeignKey
ALTER TABLE "vision_event_candidates" ADD CONSTRAINT "vision_event_candidates_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_event_candidates" ADD CONSTRAINT "vision_event_candidates_actor_track_id_fkey" FOREIGN KEY ("actor_track_id") REFERENCES "vision_tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_event_candidates" ADD CONSTRAINT "vision_event_candidates_actor_player_id_fkey" FOREIGN KEY ("actor_player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_event_candidates" ADD CONSTRAINT "vision_event_candidates_promoted_event_id_fkey" FOREIGN KEY ("promoted_event_id") REFERENCES "sb_match_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_evidence_links" ADD CONSTRAINT "vision_evidence_links_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "vision_event_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
