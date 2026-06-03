-- Backfill missing player slugs before NOT NULL constraint
UPDATE "players"
SET "slug" = LOWER(REGEXP_REPLACE(TRIM("display_name"), '[^a-zA-Z0-9]+', '-', 'g'))
WHERE "slug" IS NULL OR TRIM("slug") = '';

UPDATE "players"
SET "slug" = "slug" || '-' || SUBSTRING("id"::text, 1, 8)
WHERE "id" IN (
  SELECT p."id"
  FROM "players" p
  INNER JOIN "players" q ON q."slug" = p."slug" AND q."id" <> p."id"
);

ALTER TABLE "players" ALTER COLUMN "slug" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "players_slug_idx" ON "players"("slug");
