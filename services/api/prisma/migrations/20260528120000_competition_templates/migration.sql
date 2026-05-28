-- ScoreBoard competition template engine schema

ALTER TABLE "sb_competitions" ADD COLUMN IF NOT EXISTS "format_type" TEXT;
ALTER TABLE "sb_competitions" ADD COLUMN IF NOT EXISTS "format_config" JSONB;

CREATE INDEX IF NOT EXISTS "sb_competitions_format_type_idx" ON "sb_competitions"("format_type");

CREATE TABLE IF NOT EXISTS "sb_competition_stages" (
    "id" TEXT NOT NULL,
    "competition_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage_type" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sb_competition_stages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sb_competition_stages_competition_id_key_key" ON "sb_competition_stages"("competition_id", "key");

ALTER TABLE "sb_competition_stages" ADD CONSTRAINT "sb_competition_stages_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "sb_competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sb_teams" ADD COLUMN IF NOT EXISTS "group_key" TEXT;

ALTER TABLE "sb_matches" ADD COLUMN IF NOT EXISTS "stage_id" TEXT;
ALTER TABLE "sb_matches" ADD COLUMN IF NOT EXISTS "stage_key" TEXT;
ALTER TABLE "sb_matches" ADD COLUMN IF NOT EXISTS "matchday" INTEGER;
ALTER TABLE "sb_matches" ADD COLUMN IF NOT EXISTS "meta" JSONB;

CREATE INDEX IF NOT EXISTS "sb_matches_stage_key_idx" ON "sb_matches"("stage_key");
CREATE INDEX IF NOT EXISTS "sb_matches_stage_id_idx" ON "sb_matches"("stage_id");

ALTER TABLE "sb_matches" ADD CONSTRAINT "sb_matches_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "sb_competition_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
