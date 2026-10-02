-- The match clock anchored to the footage: a half's kick-off (and end) in source milliseconds.

-- CreateTable
CREATE TABLE "vision_clock_anchors" (
    "id" TEXT NOT NULL,
    "video_asset_id" TEXT NOT NULL,
    "half" INTEGER NOT NULL,
    "source_ms" INTEGER NOT NULL,
    "end_ms" INTEGER,
    "decided_by" TEXT NOT NULL,
    "superseded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_clock_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vision_clock_anchors_video_asset_id_half_idx" ON "vision_clock_anchors"("video_asset_id", "half");

-- AddForeignKey
ALTER TABLE "vision_clock_anchors" ADD CONSTRAINT "vision_clock_anchors_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "vision_video_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
