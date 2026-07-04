CREATE TABLE "sb_match_squad_players" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "squad_id" TEXT,
    "player_id" TEXT,
    "player_name" TEXT NOT NULL,
    "jersey_number" INTEGER,
    "position" TEXT,
    "is_starter" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sb_match_squad_players_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sb_match_squad_players_match_id_team_id_idx" ON "sb_match_squad_players"("match_id", "team_id");
CREATE INDEX "sb_match_squad_players_team_id_idx" ON "sb_match_squad_players"("team_id");
CREATE INDEX "sb_match_squad_players_player_id_idx" ON "sb_match_squad_players"("player_id");
CREATE INDEX "sb_match_squad_players_squad_id_idx" ON "sb_match_squad_players"("squad_id");

ALTER TABLE "sb_match_squad_players"
  ADD CONSTRAINT "sb_match_squad_players_match_id_fkey"
  FOREIGN KEY ("match_id") REFERENCES "sb_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sb_match_squad_players"
  ADD CONSTRAINT "sb_match_squad_players_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "sb_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sb_match_squad_players"
  ADD CONSTRAINT "sb_match_squad_players_squad_id_fkey"
  FOREIGN KEY ("squad_id") REFERENCES "sb_team_squad"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sb_match_squad_players"
  ADD CONSTRAINT "sb_match_squad_players_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;
