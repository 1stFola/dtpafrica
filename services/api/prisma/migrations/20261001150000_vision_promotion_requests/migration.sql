-- A request to move a model version one stage up, and what became of it. The
-- two-person rule lives in requested_by and decided_by, which are never the same.

-- CreateTable
CREATE TABLE "vision_promotion_requests" (
    "id" TEXT NOT NULL,
    "model_version_id" TEXT NOT NULL,
    "benchmark_run_id" TEXT,
    "from_stage" TEXT NOT NULL,
    "to_stage" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "checks" JSONB NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requested_by_email" TEXT,
    "decided_by" TEXT,
    "decided_by_email" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "replaced_version_ids" JSONB,
    "rolled_back_at" TIMESTAMP(3),
    "rolled_back_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vision_promotion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vision_promotion_requests_model_version_id_state_idx" ON "vision_promotion_requests"("model_version_id", "state");

-- AddForeignKey
ALTER TABLE "vision_promotion_requests" ADD CONSTRAINT "vision_promotion_requests_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "vision_model_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vision_promotion_requests" ADD CONSTRAINT "vision_promotion_requests_benchmark_run_id_fkey" FOREIGN KEY ("benchmark_run_id") REFERENCES "vision_benchmark_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
