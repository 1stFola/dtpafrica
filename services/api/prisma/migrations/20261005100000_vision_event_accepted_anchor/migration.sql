-- The clock a candidate was accepted on (docs/vision/55): the id of the anchor governing
-- its start when the second person accepted. Promotion writes the match minute only
-- under that anchor, so one reviewer re-anchoring a half afterwards cannot move a
-- reviewed minute alone. Nullable: every existing row keeps a null, and an accepted
-- candidate with a null is reviewed again before it can be promoted.
--
-- The folder is dated after 20261005090000 on purpose. That migration and the one
-- before it are future-dated and already applied on live (docs/vision/50 section 4),
-- and the table this alters is created by the earlier of them, so a real date would
-- sort this file before its own table on an empty database.

-- AlterTable
ALTER TABLE "vision_event_candidates" ADD COLUMN "accepted_anchor_id" TEXT;
