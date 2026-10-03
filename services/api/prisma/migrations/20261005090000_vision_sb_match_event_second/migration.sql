-- The sub-minute widening of the recorder's event (docs/vision/02 D10, docs/vision/49):
-- a nullable second beside the whole minute. Every existing row keeps a null; nothing the
-- recorder, the public site or ScoreBoard reads changes shape. Vision's promotion writes
-- it when its minute is the recorder's; `minute` itself is never rewritten.

-- AlterTable
ALTER TABLE "sb_match_events" ADD COLUMN "second_in_minute" INTEGER;
