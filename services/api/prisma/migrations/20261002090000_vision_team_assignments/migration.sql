-- Which side a track is on, by kit appearance. One row per (track, identify job).

-- CreateTable
CREATE TABLE "vision_team_assignments" (
    "id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "inference_job_id" TEXT NOT NULL,
    "team" TEXT,
    "confidence" DOUBLE PRECISION,
    "method" TEXT NOT NULL,
    "kit_description" TEXT,
    "identify_version_id" TEXT,
    "review_state" TEXT NOT NULL DEFAULT 'unreviewed',
    "superseded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_team_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vision_team_assignments_track_id_inference_job_id_key" ON "vision_team_assignments"("track_id", "inference_job_id");

-- CreateIndex
CREATE INDEX "vision_team_assignments_inference_job_id_idx" ON "vision_team_assignments"("inference_job_id");

-- AddForeignKey
ALTER TABLE "vision_team_assignments" ADD CONSTRAINT "vision_team_assignments_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "vision_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
