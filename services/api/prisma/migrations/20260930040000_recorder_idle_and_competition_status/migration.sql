-- Catch-up. These reached schema.prisma without a migration, so `prisma/migrations/`
-- would build a database missing them -- which is the one thing that directory is for.
-- Staging already has them: the API image's CMD runs `db:push` on start.
--
-- `IF NOT EXISTS` throughout, which a Prisma-generated migration would not use. It is
-- here because every database that exists today was built by `db push` and already has
-- these columns, so a migration that assumed otherwise could only ever be applied to a
-- brand-new database. This one is safe on both.

-- The recorder idle-lock: when a sheet last saw an event, when it was locked for running
-- 20 minutes without one, and who released it.
ALTER TABLE "sb_match_statistics"
  ADD COLUMN IF NOT EXISTS "last_event_at"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "idle_locked_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "idle_locked_since_at"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "idle_released_by"       TEXT,
  ADD COLUMN IF NOT EXISTS "idle_released_by_name"  TEXT,
  ADD COLUMN IF NOT EXISTS "idle_released_at"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "idle_release_note"      TEXT;

-- The sweep runs every minute and asks for locked sheets; without this it is a table scan
-- of every match statistics row ever recorded.
CREATE INDEX IF NOT EXISTS "sb_match_statistics_idle_locked_at_idx"
  ON "sb_match_statistics"("idle_locked_at");

-- A competition with no explicit status is scheduled, not archived or draft: the default
-- decides whether an unset row shows on the ScoreBoard, and defaulting to hidden would
-- disappear competitions nobody had touched.
ALTER TABLE "sb_competitions" ALTER COLUMN "status" SET DEFAULT 'scheduled';
