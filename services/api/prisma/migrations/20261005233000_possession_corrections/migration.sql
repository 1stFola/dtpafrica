CREATE TABLE "vision_possession_corrections" (
 "id" TEXT NOT NULL PRIMARY KEY, "segment_id" TEXT NOT NULL,
 "parent_key" TEXT NOT NULL UNIQUE, "version" INTEGER NOT NULL, "start_ms" INTEGER NOT NULL,
 "end_ms" INTEGER NOT NULL, "state" TEXT NOT NULL,
 "actor_track_id" TEXT, "local_track_id" INTEGER, "reason" TEXT NOT NULL,
 "proposed_by" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "vision_possession_corrections_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "vision_possession_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "possession_correction_bounds" CHECK ("start_ms" >= 0 AND "end_ms" > "start_ms"),
 CONSTRAINT "possession_correction_version" CHECK ("version" BETWEEN 1 AND 20),
 CONSTRAINT "possession_correction_reason" CHECK (length(btrim("reason")) BETWEEN 1 AND 1000),
 CONSTRAINT "possession_correction_actor" CHECK (("state" = 'unknown' AND "actor_track_id" IS NULL AND "local_track_id" IS NULL) OR ("state" = 'candidate' AND "actor_track_id" IS NOT NULL AND "local_track_id" IS NOT NULL AND "local_track_id" >= 0))
);
CREATE INDEX "vision_possession_corrections_segment_id_created_at_idx" ON "vision_possession_corrections"("segment_id", "created_at");
CREATE UNIQUE INDEX "vision_possession_corrections_segment_id_version_key" ON "vision_possession_corrections"("segment_id", "version");
CREATE TABLE "vision_possession_correction_decisions" (
 "id" TEXT NOT NULL PRIMARY KEY, "correction_id" TEXT NOT NULL UNIQUE,
 "decision" TEXT NOT NULL, "reason" TEXT, "reviewed_by" TEXT NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "vision_possession_correction_decisions_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "vision_possession_corrections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "possession_correction_decision_kind" CHECK ("decision" IN ('accepted', 'rejected')),
 CONSTRAINT "possession_correction_rejection_reason" CHECK ("decision" <> 'rejected' OR ("reason" IS NOT NULL AND length(btrim("reason")) BETWEEN 1 AND 1000))
);
