-- docs/vision/63: who first proposed an event, kept through every correction.
--
-- A correction writes a new row that supersedes the old one, and the new row's
-- `decided_by` is the corrector. Self-acceptance was checked against that alone,
-- so the person who proposed an event could accept it once anyone else had
-- corrected it. `proposed_by` is the author of the first row in the chain.
--
-- One nullable column and a backfill. Safe to run twice: the column is added only
-- if absent and the backfill touches only rows where it is still null.

ALTER TABLE "vision_event_candidates" ADD COLUMN IF NOT EXISTS "proposed_by" TEXT;

-- A chain runs old -> new through `superseded_by`. Its first row is the one no
-- other row points at; every row after it takes that row's author.
WITH RECURSIVE chain(id, root_by) AS (
  SELECT c."id", c."decided_by"
  FROM "vision_event_candidates" c
  WHERE NOT EXISTS (SELECT 1 FROM "vision_event_candidates" p WHERE p."superseded_by" = c."id")
  UNION ALL
  SELECT n."id", chain.root_by
  FROM chain
  JOIN "vision_event_candidates" o ON o."id" = chain.id
  JOIN "vision_event_candidates" n ON n."id" = o."superseded_by"
)
UPDATE "vision_event_candidates" c
SET "proposed_by" = chain.root_by
FROM chain
WHERE c."id" = chain.id AND c."proposed_by" IS NULL;
