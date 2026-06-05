-- ScoreBoard → scouting player profile pipeline

ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "normalized_name" TEXT;
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "career_goals" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "career_assists" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "career_appearances" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "career_minutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "career_clean_sheets" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "players_normalized_name_key" ON "players"("normalized_name");

ALTER TABLE "sb_competitions" ADD COLUMN IF NOT EXISTS "standings_snapshot" JSONB;
ALTER TABLE "sb_competitions" ADD COLUMN IF NOT EXISTS "standings_updated_at" TIMESTAMP(3);

ALTER TABLE "sb_match_events" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE TABLE IF NOT EXISTS "sb_player_competition_stats" (
    "id" TEXT NOT NULL,
    "competition_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "appearances" INTEGER NOT NULL DEFAULT 0,
    "minutes_played" INTEGER NOT NULL DEFAULT 0,
    "clean_sheets" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sb_player_competition_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sb_player_competition_stats_competition_id_player_id_key" ON "sb_player_competition_stats"("competition_id", "player_id");
CREATE INDEX IF NOT EXISTS "sb_player_competition_stats_competition_id_goals_idx" ON "sb_player_competition_stats"("competition_id", "goals");

ALTER TABLE "sb_player_competition_stats" ADD CONSTRAINT "sb_player_competition_stats_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "sb_competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sb_player_competition_stats" ADD CONSTRAINT "sb_player_competition_stats_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
