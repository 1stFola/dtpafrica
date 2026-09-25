-- Baseline migration.
--
-- Reconstructed from schema.prisma as it stood at commit c8b9130^ -- the state
-- immediately before 20260528120000_competition_templates, the first migration
-- ever committed to this repo. Until this file existed, every migration here
-- assumed a schema that `prisma db push` had already created, so
-- `prisma migrate deploy` against an empty database failed on the first one.
--
-- Generated with:
--   git show c8b9130^:services/api/prisma/schema.prisma > /tmp/baseline.prisma
--   prisma migrate diff --from-empty --to-schema-datamodel /tmp/baseline.prisma --script
--
-- Do not edit. Databases that already contain these tables are baselined with
-- `prisma migrate resolve --applied` -- see infra/DEPLOYMENT.md.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "date_of_birth" DATE,
    "age" INTEGER,
    "age_group" TEXT,
    "nationality" TEXT,
    "height_cm" INTEGER,
    "weight_kg" DOUBLE PRECISION,
    "dominant_foot" TEXT,
    "position_primary" TEXT NOT NULL,
    "position_secondary" TEXT,
    "player_photo_url" TEXT,
    "video_url" TEXT,
    "biography" TEXT,
    "slug" TEXT,
    "city" TEXT,
    "state" TEXT,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "registration_status" TEXT NOT NULL DEFAULT 'approved',
    "guardian_name" TEXT,
    "guardian_email" TEXT,
    "guardian_phone" TEXT,
    "overall_rating" INTEGER,
    "offensive_rating" INTEGER,
    "defensive_rating" INTEGER,
    "rating_attributes" JSONB,
    "benchmark_metadata" JSONB,
    "media_items" JSONB,
    "scouting_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" TEXT NOT NULL,
    "cover_image_url" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academies" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "description" TEXT,
    "logo_url" TEXT,
    "website_url" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "static_content" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "static_content_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" TEXT NOT NULL,
    "external_ref" TEXT,
    "competition" TEXT,
    "season" TEXT,
    "played_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_match_metrics" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "minutes_played" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ball_touches" INTEGER NOT NULL DEFAULT 0,
    "one_touch_possessions" INTEGER NOT NULL DEFAULT 0,
    "multi_touch_possessions" INTEGER NOT NULL DEFAULT 0,
    "possession_duration_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "release_laces_count" INTEGER NOT NULL DEFAULT 0,
    "release_inside_foot_count" INTEGER NOT NULL DEFAULT 0,
    "release_other_footzone_count" INTEGER NOT NULL DEFAULT 0,
    "left_foot_touch_count" INTEGER NOT NULL DEFAULT 0,
    "right_foot_touch_count" INTEGER NOT NULL DEFAULT 0,
    "left_foot_release_count" INTEGER NOT NULL DEFAULT 0,
    "right_foot_release_count" INTEGER NOT NULL DEFAULT 0,
    "left_foot_receive_count" INTEGER NOT NULL DEFAULT 0,
    "right_foot_receive_count" INTEGER NOT NULL DEFAULT 0,
    "left_foot_kicking_power_mph" DOUBLE PRECISION,
    "right_foot_kicking_power_mph" DOUBLE PRECISION,
    "total_distance_miles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sprint_distance_yards" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "first_step_accelerations" INTEGER NOT NULL DEFAULT 0,
    "intense_accelerations" INTEGER NOT NULL DEFAULT 0,
    "kicking_power_mph" DOUBLE PRECISION,
    "top_speed_mph" DOUBLE PRECISION,
    "sprints" INTEGER NOT NULL DEFAULT 0,
    "intense_turns" INTEGER NOT NULL DEFAULT 0,
    "avg_turn_entry_speed_mph" DOUBLE PRECISION,
    "avg_turn_exit_speed_mph" DOUBLE PRECISION,
    "left_turns" INTEGER NOT NULL DEFAULT 0,
    "right_turns" INTEGER NOT NULL DEFAULT 0,
    "back_turns" INTEGER NOT NULL DEFAULT 0,
    "distance_with_ball_yards" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "top_speed_with_ball_mph" DOUBLE PRECISION,
    "intense_turns_with_ball" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_match_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_aggregated_metrics" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "season" TEXT NOT NULL DEFAULT 'rolling',
    "matches_played" INTEGER NOT NULL DEFAULT 0,
    "minutes_played" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "raw_averages" JSONB NOT NULL,
    "derived_metrics" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_aggregated_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tactical_scores" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "gegenpress_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tiki_taka_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "counter_attack_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_football_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "high_line_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "winger_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "low_block_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quick_release_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ball_retention_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "technical_cleanliness_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "direct_play_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "flair_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "press_resistance_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "possession_hub_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transition_explosiveness_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isolation_threat_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "two_footedness_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tactical_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "philosophy_fit_profiles" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "formation" TEXT NOT NULL,
    "philosophy" TEXT NOT NULL,
    "position_slot" TEXT,
    "philosophy_fit_score" DOUBLE PRECISION NOT NULL,
    "position_fit_score" DOUBLE PRECISION NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "philosophy_fit_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_fit_snapshots" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "primary_position_fit" TEXT NOT NULL,
    "secondary_position_fit" TEXT,
    "hybrid_fit" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_fit_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tactical_benchmarks" (
    "id" TEXT NOT NULL,
    "player_name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "country" TEXT,
    "club_style" TEXT,
    "tactical_archetype" TEXT,
    "dominant_foot" TEXT,
    "gegenpress_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tiki_taka_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "counter_attack_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_football_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "high_line_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "winger_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "low_block_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "best_system_fit" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tactical_benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sb_competitions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'tournament',
    "country" TEXT DEFAULT 'Nigeria',
    "description" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sb_competitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sb_teams" (
    "id" TEXT NOT NULL,
    "competition_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "logo_url" TEXT,
    "city" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sb_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sb_team_squad" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "player_id" TEXT,
    "shirt_number" INTEGER,
    "display_name" TEXT NOT NULL,
    "position" TEXT,

    CONSTRAINT "sb_team_squad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sb_matches" (
    "id" TEXT NOT NULL,
    "competition_id" TEXT NOT NULL,
    "home_team_id" TEXT NOT NULL,
    "away_team_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "minute" INTEGER,
    "home_score" INTEGER NOT NULL DEFAULT 0,
    "away_score" INTEGER NOT NULL DEFAULT 0,
    "kickoff_at" TIMESTAMP(3),
    "venue" TEXT,
    "round_label" TEXT,
    "stats" JSONB,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "sip_match_id" TEXT,
    "sip_ingest_status" TEXT NOT NULL DEFAULT 'pending',
    "sip_ingested_at" TIMESTAMP(3),
    "sip_ingest_summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sb_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sb_sip_ingest_audits" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sb_sip_ingest_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sb_match_events" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "team_id" TEXT,
    "player_id" TEXT,
    "assist_player_id" TEXT,
    "player_label" TEXT,
    "assist_label" TEXT,
    "type" TEXT NOT NULL,
    "minute" INTEGER NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sb_match_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sb_highlights" (
    "id" TEXT NOT NULL,
    "competition_id" TEXT,
    "match_id" TEXT,
    "event_id" TEXT,
    "title" TEXT NOT NULL,
    "youtube_url" TEXT NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sb_highlights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mvce_valuation_runs" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "base_score" DOUBLE PRECISION NOT NULL,
    "adjusted_score" DOUBLE PRECISION NOT NULL,
    "confidence_label" TEXT NOT NULL,
    "market_value_label" TEXT NOT NULL,
    "market_value_min_eur" INTEGER,
    "market_value_max_eur" INTEGER,
    "factors" JSONB NOT NULL,
    "multipliers" JSONB NOT NULL,
    "strengths" JSONB NOT NULL,
    "weaknesses" JSONB NOT NULL,
    "scout_notes" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mvce_valuation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "players_slug_key" ON "players"("slug");

-- CreateIndex
CREATE INDEX "players_position_primary_idx" ON "players"("position_primary");

-- CreateIndex
CREATE INDEX "players_age_group_idx" ON "players"("age_group");

-- CreateIndex
CREATE INDEX "players_overall_rating_idx" ON "players"("overall_rating");

-- CreateIndex
CREATE INDEX "players_is_featured_is_public_idx" ON "players"("is_featured", "is_public");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "academies_slug_key" ON "academies"("slug");

-- CreateIndex
CREATE INDEX "contact_messages_created_at_idx" ON "contact_messages"("created_at");

-- CreateIndex
CREATE INDEX "contact_messages_read_at_archived_at_idx" ON "contact_messages"("read_at", "archived_at");

-- CreateIndex
CREATE INDEX "player_match_metrics_player_id_idx" ON "player_match_metrics"("player_id");

-- CreateIndex
CREATE INDEX "player_match_metrics_match_id_idx" ON "player_match_metrics"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_match_metrics_player_id_match_id_key" ON "player_match_metrics"("player_id", "match_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_aggregated_metrics_player_id_season_key" ON "player_aggregated_metrics"("player_id", "season");

-- CreateIndex
CREATE UNIQUE INDEX "tactical_scores_player_id_key" ON "tactical_scores"("player_id");

-- CreateIndex
CREATE INDEX "tactical_scores_gegenpress_score_idx" ON "tactical_scores"("gegenpress_score");

-- CreateIndex
CREATE INDEX "tactical_scores_tiki_taka_score_idx" ON "tactical_scores"("tiki_taka_score");

-- CreateIndex
CREATE INDEX "tactical_scores_counter_attack_score_idx" ON "tactical_scores"("counter_attack_score");

-- CreateIndex
CREATE INDEX "tactical_scores_total_football_score_idx" ON "tactical_scores"("total_football_score");

-- CreateIndex
CREATE INDEX "tactical_scores_winger_score_idx" ON "tactical_scores"("winger_score");

-- CreateIndex
CREATE INDEX "tactical_scores_high_line_score_idx" ON "tactical_scores"("high_line_score");

-- CreateIndex
CREATE INDEX "tactical_scores_low_block_score_idx" ON "tactical_scores"("low_block_score");

-- CreateIndex
CREATE INDEX "philosophy_fit_profiles_player_id_philosophy_formation_idx" ON "philosophy_fit_profiles"("player_id", "philosophy", "formation");

-- CreateIndex
CREATE UNIQUE INDEX "position_fit_snapshots_player_id_key" ON "position_fit_snapshots"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "sb_competitions_slug_key" ON "sb_competitions"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "sb_teams_competition_id_slug_key" ON "sb_teams"("competition_id", "slug");

-- CreateIndex
CREATE INDEX "sb_team_squad_team_id_idx" ON "sb_team_squad"("team_id");

-- CreateIndex
CREATE INDEX "sb_team_squad_player_id_idx" ON "sb_team_squad"("player_id");

-- CreateIndex
CREATE INDEX "sb_matches_competition_id_status_idx" ON "sb_matches"("competition_id", "status");

-- CreateIndex
CREATE INDEX "sb_matches_sip_ingest_status_idx" ON "sb_matches"("sip_ingest_status");

-- CreateIndex
CREATE INDEX "sb_matches_kickoff_at_idx" ON "sb_matches"("kickoff_at");

-- CreateIndex
CREATE INDEX "sb_sip_ingest_audits_match_id_created_at_idx" ON "sb_sip_ingest_audits"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "sb_match_events_match_id_minute_idx" ON "sb_match_events"("match_id", "minute");

-- CreateIndex
CREATE INDEX "sb_match_events_player_id_idx" ON "sb_match_events"("player_id");

-- CreateIndex
CREATE INDEX "sb_match_events_assist_player_id_idx" ON "sb_match_events"("assist_player_id");

-- CreateIndex
CREATE INDEX "sb_highlights_event_id_idx" ON "sb_highlights"("event_id");

-- CreateIndex
CREATE INDEX "mvce_valuation_runs_player_id_created_at_idx" ON "mvce_valuation_runs"("player_id", "created_at");

-- AddForeignKey
ALTER TABLE "player_match_metrics" ADD CONSTRAINT "player_match_metrics_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_match_metrics" ADD CONSTRAINT "player_match_metrics_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_aggregated_metrics" ADD CONSTRAINT "player_aggregated_metrics_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tactical_scores" ADD CONSTRAINT "tactical_scores_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "philosophy_fit_profiles" ADD CONSTRAINT "philosophy_fit_profiles_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_fit_snapshots" ADD CONSTRAINT "position_fit_snapshots_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_teams" ADD CONSTRAINT "sb_teams_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "sb_competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_team_squad" ADD CONSTRAINT "sb_team_squad_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "sb_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_team_squad" ADD CONSTRAINT "sb_team_squad_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_matches" ADD CONSTRAINT "sb_matches_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "sb_competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_matches" ADD CONSTRAINT "sb_matches_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "sb_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_matches" ADD CONSTRAINT "sb_matches_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "sb_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_sip_ingest_audits" ADD CONSTRAINT "sb_sip_ingest_audits_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "sb_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_match_events" ADD CONSTRAINT "sb_match_events_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "sb_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_match_events" ADD CONSTRAINT "sb_match_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "sb_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_match_events" ADD CONSTRAINT "sb_match_events_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_match_events" ADD CONSTRAINT "sb_match_events_assist_player_id_fkey" FOREIGN KEY ("assist_player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_highlights" ADD CONSTRAINT "sb_highlights_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "sb_competitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_highlights" ADD CONSTRAINT "sb_highlights_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "sb_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_highlights" ADD CONSTRAINT "sb_highlights_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "sb_match_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mvce_valuation_runs" ADD CONSTRAINT "mvce_valuation_runs_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

