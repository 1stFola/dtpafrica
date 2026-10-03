-- Bootstrap and worker tokens were told apart by nothing (docs/vision/50, C3): both lived
-- in `token_hash` and one lookup accepted either, so an unredeemed bootstrap token could
-- claim jobs, and a worker token handed to `register` minted a fresh one indefinitely.
--
-- Existing rows are workers that registered long ago or bootstrap tokens past their hour,
-- so `worker` is the right default for them; `mintBootstrap` writes `bootstrap` explicitly.

-- IF NOT EXISTS: until PR-2 the API image runs `db push` on start, which adds this column
-- before `migrate deploy` ever sees the migration. Safe either way.
-- AlterTable
ALTER TABLE "vision_workers" ADD COLUMN IF NOT EXISTS "token_kind" TEXT NOT NULL DEFAULT 'worker';
