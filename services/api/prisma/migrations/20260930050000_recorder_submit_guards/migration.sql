-- The two timestamps the submit guards need. `full_time_at` is when the match clock
-- reached the end, which is what starts the five-minute auto-submit countdown;
-- `auto_submitted_at` records that nobody submitted it and the sweep did.
--
-- `IF NOT EXISTS` for the same reason as the migration before it: every database that
-- exists today was built by `db push`, and a staging box that has already run this code
-- will have these columns.
ALTER TABLE "sb_match_statistics"
  ADD COLUMN IF NOT EXISTS "full_time_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "auto_submitted_at" TIMESTAMP(3);
