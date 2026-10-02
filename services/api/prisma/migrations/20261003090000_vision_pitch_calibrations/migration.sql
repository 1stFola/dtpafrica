-- A homography from the proxy's pixels to the pitch in metres, per camera segment, with its quality.

-- CreateTable
CREATE TABLE "vision_pitch_calibrations" (
    "id" TEXT NOT NULL,
    "camera_segment_id" TEXT NOT NULL,
    "pitch_length_m" DOUBLE PRECISION NOT NULL,
    "pitch_width_m" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "model_version_id" TEXT,
    "points" JSONB NOT NULL,
    "homography" JSONB NOT NULL,
    "reprojection_error_m" DOUBLE PRECISION NOT NULL,
    "max_point_error_m" DOUBLE PRECISION NOT NULL,
    "reprojection_error_px" DOUBLE PRECISION NOT NULL,
    "points_used" INTEGER NOT NULL,
    "quality" TEXT NOT NULL,
    "thresholds_version" TEXT NOT NULL,
    "decided_by" TEXT,
    "superseded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_pitch_calibrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vision_pitch_calibrations_camera_segment_id_created_at_idx" ON "vision_pitch_calibrations"("camera_segment_id", "created_at");

-- AddForeignKey
ALTER TABLE "vision_pitch_calibrations" ADD CONSTRAINT "vision_pitch_calibrations_camera_segment_id_fkey" FOREIGN KEY ("camera_segment_id") REFERENCES "vision_camera_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
