-- `auto_approved_at` records that nobody approved the sheet and the sweep did, ten
-- minutes after the recorder submitted it with every shirt number named.
--
-- `IF NOT EXISTS` because every database that exists today was built by `db push`.
ALTER TABLE "sb_match_statistics"
  ADD COLUMN IF NOT EXISTS "auto_approved_at" TIMESTAMP(3);
