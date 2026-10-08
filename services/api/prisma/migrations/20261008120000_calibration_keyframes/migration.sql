-- Keyframe calibrations (docs/vision/93). Additive: every existing row stays a
-- whole-segment calibration (frame_index NULL) and reads exactly as before.
ALTER TABLE "vision_pitch_calibrations" ADD COLUMN "frame_index" INTEGER,
  ADD COLUMN "withdrawn_at" TIMESTAMP(3),
  ADD COLUMN "withdrawn_by" TEXT;
ALTER TABLE "vision_pitch_calibrations" ADD CONSTRAINT "pitch_calibration_frame_index_bounds" CHECK ("frame_index" IS NULL OR "frame_index" >= 0);
ALTER TABLE "vision_pitch_calibrations" ADD CONSTRAINT "pitch_calibration_withdrawal_complete" CHECK (("withdrawn_at" IS NULL) = ("withdrawn_by" IS NULL));
CREATE INDEX "vision_pitch_calibrations_camera_segment_id_frame_index_idx" ON "vision_pitch_calibrations"("camera_segment_id", "frame_index");
