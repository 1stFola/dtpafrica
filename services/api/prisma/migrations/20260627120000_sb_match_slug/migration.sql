-- Add slug column (nullable for backfill)
ALTER TABLE "sb_matches" ADD COLUMN "slug" TEXT;

-- Base slugs from home/away team slugs
UPDATE "sb_matches" m
SET "slug" = ht."slug" || '-vs-' || at."slug"
FROM "sb_teams" ht, "sb_teams" at
WHERE m."home_team_id" = ht."id" AND m."away_team_id" = at."id";

-- Disambiguate duplicate slugs (kickoff order, then created_at)
WITH ranked AS (
  SELECT
    m."id",
    m."slug",
    m."meta",
    ROW_NUMBER() OVER (
      PARTITION BY m."slug"
      ORDER BY m."kickoff_at" NULLS LAST, m."created_at"
    ) AS rn
  FROM "sb_matches" m
)
UPDATE "sb_matches" m
SET "slug" = CASE
  WHEN r.rn = 1 THEN r."slug"
  WHEN r."meta"->>'leg' = 'second_leg' THEN r."slug" || '-leg-2'
  ELSE r."slug" || '-' || r.rn::text
END
FROM ranked r
WHERE m."id" = r."id" AND r.rn > 1;

-- Resolve any remaining collisions after leg suffix (e.g. two second legs)
WITH ranked AS (
  SELECT
    m."id",
    m."slug",
    ROW_NUMBER() OVER (
      PARTITION BY m."slug"
      ORDER BY m."kickoff_at" NULLS LAST, m."created_at"
    ) AS rn
  FROM "sb_matches" m
)
UPDATE "sb_matches" m
SET "slug" = r."slug" || '-' || r.rn::text
FROM ranked r
WHERE m."id" = r."id" AND r.rn > 1;

ALTER TABLE "sb_matches" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "sb_matches_slug_key" ON "sb_matches"("slug");
