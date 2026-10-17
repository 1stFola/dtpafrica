-- Admin-managed YouTube live streams for the public Live Games page. Additive; the
-- local and staging databases were built by `db push`, hence IF NOT EXISTS throughout.
CREATE TABLE IF NOT EXISTS "sb_live_streams" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "youtube_url" TEXT NOT NULL,
    "match_id" TEXT,
    "competition_id" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sb_live_streams_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sb_live_streams_is_published_sort_order_idx" ON "sb_live_streams"("is_published", "sort_order");
CREATE INDEX IF NOT EXISTS "sb_live_streams_match_id_idx" ON "sb_live_streams"("match_id");
CREATE INDEX IF NOT EXISTS "sb_live_streams_competition_id_idx" ON "sb_live_streams"("competition_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sb_live_streams_match_id_fkey') THEN
    ALTER TABLE "sb_live_streams" ADD CONSTRAINT "sb_live_streams_match_id_fkey"
      FOREIGN KEY ("match_id") REFERENCES "sb_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sb_live_streams_competition_id_fkey') THEN
    ALTER TABLE "sb_live_streams" ADD CONSTRAINT "sb_live_streams_competition_id_fkey"
      FOREIGN KEY ("competition_id") REFERENCES "sb_competitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
