-- Catch-up migration: schema that reached databases through `prisma db push`
-- but was never recorded as a migration.
--
-- Between 20260703130000_sb_match_formations and the Vision work, the admin
-- RBAC tables, support reports, the match statistics/sheet-log tables, academy
-- change requests and several columns were applied with `db push` only. The
-- baseline plus the 14 incremental migrations therefore did not add up to
-- schema.prisma. This file closes that gap.
--
-- Generated with:
--   prisma migrate diff --from-migrations ./prisma/migrations --     --to-schema-datamodel ./prisma/schema.prisma --     --shadow-database-url <scratch db> --script
--
-- Existing databases already have all of this; they are baselined with
-- `prisma migrate resolve --applied` -- see infra/DEPLOYMENT.md.

-- AlterTable
ALTER TABLE "academies" ADD COLUMN     "founded_year" INTEGER;

-- AlterTable
ALTER TABLE "players" ADD COLUMN     "academy_id" TEXT;

-- AlterTable
ALTER TABLE "sb_competitions" ADD COLUMN     "logo_url" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'upcoming';

-- AlterTable
ALTER TABLE "sb_teams" ADD COLUMN     "academy_id" TEXT;

-- CreateTable
CREATE TABLE "academy_change_requests" (
    "id" TEXT NOT NULL,
    "academy_id" TEXT NOT NULL,
    "player_id" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "admin_notes" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academy_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_reports" (
    "id" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'internal_admin',
    "reporter_name" TEXT,
    "reporter_email" TEXT,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "page_url" TEXT,
    "recommendation_key" TEXT,
    "context" JSONB,
    "admin_notes" TEXT,
    "resolution_summary" TEXT,
    "playbook_outcome" TEXT NOT NULL DEFAULT 'not_reviewed',
    "playbook_proposal" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "support_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sb_match_statistics" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'live',
    "events_status" TEXT NOT NULL DEFAULT 'live',
    "events_submitted_by" TEXT,
    "events_submitted_by_name" TEXT,
    "events_submitted_at" TIMESTAMP(3),
    "events_approved_by" TEXT,
    "events_approved_by_name" TEXT,
    "events_approved_at" TIMESTAMP(3),
    "events_sent_back_by" TEXT,
    "events_sent_back_by_name" TEXT,
    "events_sent_back_at" TIMESTAMP(3),
    "events_sent_back_note" TEXT,
    "tallies" JSONB NOT NULL DEFAULT '{}',
    "events" JSONB NOT NULL DEFAULT '[]',
    "clock" JSONB,
    "kits" JSONB,
    "correction_requested_section" TEXT,
    "correction_requested_by" TEXT,
    "correction_requested_by_name" TEXT,
    "correction_requested_at" TIMESTAMP(3),
    "correction_request_note" TEXT,
    "recorder_id" TEXT,
    "recorder_name" TEXT,
    "submitted_by" TEXT,
    "submitted_by_name" TEXT,
    "submitted_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_by_name" TEXT,
    "approved_at" TIMESTAMP(3),
    "sent_back_by" TEXT,
    "sent_back_by_name" TEXT,
    "sent_back_at" TIMESTAMP(3),
    "sent_back_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sb_match_statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sb_match_sheet_log" (
    "id" TEXT NOT NULL,
    "sheet_id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT,
    "actor_role" TEXT,
    "note" TEXT,
    "summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sb_match_sheet_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_roles" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_permissions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "admin_role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password_hash" TEXT,
    "role_id" TEXT,
    "competition_id" TEXT,
    "all_competitions" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_user_competitions" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "competition_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_competitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "academy_change_requests_academy_id_status_idx" ON "academy_change_requests"("academy_id", "status");

-- CreateIndex
CREATE INDEX "academy_change_requests_status_created_at_idx" ON "academy_change_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "academy_change_requests_player_id_idx" ON "academy_change_requests"("player_id");

-- CreateIndex
CREATE INDEX "support_reports_status_severity_idx" ON "support_reports"("status", "severity");

-- CreateIndex
CREATE INDEX "support_reports_category_idx" ON "support_reports"("category");

-- CreateIndex
CREATE INDEX "support_reports_playbook_outcome_idx" ON "support_reports"("playbook_outcome");

-- CreateIndex
CREATE INDEX "support_reports_created_at_idx" ON "support_reports"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sb_match_statistics_match_id_key" ON "sb_match_statistics"("match_id");

-- CreateIndex
CREATE INDEX "sb_match_statistics_status_idx" ON "sb_match_statistics"("status");

-- CreateIndex
CREATE INDEX "sb_match_statistics_events_status_idx" ON "sb_match_statistics"("events_status");

-- CreateIndex
CREATE INDEX "sb_match_statistics_correction_requested_at_idx" ON "sb_match_statistics"("correction_requested_at");

-- CreateIndex
CREATE INDEX "sb_match_sheet_log_match_id_created_at_idx" ON "sb_match_sheet_log"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "sb_match_sheet_log_sheet_id_created_at_idx" ON "sb_match_sheet_log"("sheet_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_slug_key" ON "admin_roles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "admin_permissions_slug_key" ON "admin_permissions"("slug");

-- CreateIndex
CREATE INDEX "admin_permissions_resource_action_idx" ON "admin_permissions"("resource", "action");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_role_id_idx" ON "admin_users"("role_id");

-- CreateIndex
CREATE INDEX "admin_users_competition_id_idx" ON "admin_users"("competition_id");

-- CreateIndex
CREATE INDEX "admin_user_competitions_admin_user_id_idx" ON "admin_user_competitions"("admin_user_id");

-- CreateIndex
CREATE INDEX "admin_user_competitions_competition_id_idx" ON "admin_user_competitions"("competition_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_competitions_admin_user_id_competition_id_key" ON "admin_user_competitions"("admin_user_id", "competition_id");

-- CreateIndex
CREATE INDEX "players_academy_id_idx" ON "players"("academy_id");

-- CreateIndex
CREATE INDEX "sb_match_events_team_id_idx" ON "sb_match_events"("team_id");

-- CreateIndex
CREATE INDEX "sb_match_events_player_label_idx" ON "sb_match_events"("player_label");

-- CreateIndex
CREATE INDEX "sb_match_events_player_label2_idx" ON "sb_match_events"("player_label2");

-- CreateIndex
CREATE INDEX "sb_match_events_assist_label_idx" ON "sb_match_events"("assist_label");

-- CreateIndex
CREATE INDEX "sb_team_squad_team_id_player_id_idx" ON "sb_team_squad"("team_id", "player_id");

-- CreateIndex
CREATE INDEX "sb_teams_academy_id_idx" ON "sb_teams"("academy_id");

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_change_requests" ADD CONSTRAINT "academy_change_requests_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academy_change_requests" ADD CONSTRAINT "academy_change_requests_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_teams" ADD CONSTRAINT "sb_teams_academy_id_fkey" FOREIGN KEY ("academy_id") REFERENCES "academies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_match_statistics" ADD CONSTRAINT "sb_match_statistics_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "sb_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sb_match_sheet_log" ADD CONSTRAINT "sb_match_sheet_log_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "sb_match_statistics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_role_permissions" ADD CONSTRAINT "admin_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_role_permissions" ADD CONSTRAINT "admin_role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "admin_permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "admin_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "sb_competitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_competitions" ADD CONSTRAINT "admin_user_competitions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_competitions" ADD CONSTRAINT "admin_user_competitions_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "sb_competitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

