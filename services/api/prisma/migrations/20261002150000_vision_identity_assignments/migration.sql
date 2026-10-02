-- Which team a kit cluster is, and who a track is for a window of it.

-- CreateTable
CREATE TABLE "vision_team_sides" (
    "id" TEXT NOT NULL,
    "inference_job_id" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "sb_team_id" TEXT NOT NULL,
    "decided_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_team_sides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_identity_assignments" (
    "id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "player_id" TEXT,
    "match_squad_player_id" TEXT,
    "sb_team_squad_id" TEXT,
    "sb_team_id" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "valid_from_ms" INTEGER NOT NULL,
    "valid_to_ms" INTEGER NOT NULL,
    "review_state" TEXT NOT NULL DEFAULT 'unreviewed',
    "decided_by" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "note" TEXT,
    "superseded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_identity_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vision_team_sides_inference_job_id_team_key" ON "vision_team_sides"("inference_job_id", "team");

-- CreateIndex
CREATE INDEX "vision_identity_assignments_track_id_idx" ON "vision_identity_assignments"("track_id");

-- CreateIndex
CREATE INDEX "vision_identity_assignments_player_id_idx" ON "vision_identity_assignments"("player_id");

-- AddForeignKey
ALTER TABLE "vision_team_sides" ADD CONSTRAINT "vision_team_sides_inference_job_id_fkey" FOREIGN KEY ("inference_job_id") REFERENCES "vision_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_identity_assignments" ADD CONSTRAINT "vision_identity_assignments_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "vision_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_identity_assignments" ADD CONSTRAINT "vision_identity_assignments_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;
