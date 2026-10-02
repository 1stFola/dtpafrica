-- The side a kit was nearest to, kept even when the margin was too small to name it.

-- AlterTable
ALTER TABLE "vision_team_assignments" ADD COLUMN     "nearest_team" TEXT;
