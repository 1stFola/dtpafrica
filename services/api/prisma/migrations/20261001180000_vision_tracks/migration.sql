-- One track per row; its positions stay in the job's artifact.

-- CreateTable
CREATE TABLE "vision_tracks" (
    "id" TEXT NOT NULL,
    "video_asset_id" TEXT NOT NULL,
    "inference_job_id" TEXT NOT NULL,
    "local_track_id" INTEGER NOT NULL,
    "class" TEXT NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "start_frame" INTEGER NOT NULL,
    "end_frame" INTEGER NOT NULL,
    "detection_count" INTEGER NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT true,
    "tracker_version_id" TEXT,
    "detector_version_id" TEXT,
    "artifact_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vision_tracks_inference_job_id_local_track_id_key" ON "vision_tracks"("inference_job_id", "local_track_id");

-- CreateIndex
CREATE INDEX "vision_tracks_video_asset_id_class_idx" ON "vision_tracks"("video_asset_id", "class");

-- AddForeignKey
ALTER TABLE "vision_tracks" ADD CONSTRAINT "vision_tracks_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_tracks" ADD CONSTRAINT "vision_tracks_inference_job_id_fkey" FOREIGN KEY ("inference_job_id") REFERENCES "vision_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
