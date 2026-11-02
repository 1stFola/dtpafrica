-- A match that could not go on. Additive and nullable: every existing sheet reads as never stopped.
ALTER TABLE "sb_match_statistics" ADD COLUMN "total_stoppage_at" TIMESTAMP(3);
ALTER TABLE "sb_match_statistics" ADD COLUMN "total_stoppage" JSONB;

CREATE INDEX "sb_match_statistics_total_stoppage_at_idx" ON "sb_match_statistics"("total_stoppage_at");
