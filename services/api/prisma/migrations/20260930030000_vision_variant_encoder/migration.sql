-- The FFmpeg build that produced a variant. Nullable: every existing row was written
-- before the worker reported it, and a proxy with no recorded encoder is still a usable
-- proxy -- it just cannot answer which build made it.
ALTER TABLE "vision_video_variants" ADD COLUMN "encoder" TEXT;
